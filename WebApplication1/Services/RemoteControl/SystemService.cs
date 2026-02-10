using System.Collections.Concurrent;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Management;
using System.Runtime.InteropServices;
using System.Threading;

namespace ChuckieHelper.WebApi.Services.RemoteControl;

/// <summary>
/// 系统操作服务：提供截图、鼠标键盘控制、锁屏、关机等功能。
/// 自动检测 Session 0 环境（IIS），通过桌面代理委派需要桌面访问的操作。
/// </summary>
public class SystemService
{
    [DllImport("user32.dll")]
    private static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    private static extern bool SetProcessDpiAwarenessContext(IntPtr dpiContext);

    [DllImport("shcore.dll")]
    private static extern int SetProcessDpiAwareness(PROCESS_DPI_AWARENESS awareness);

    [DllImport("user32.dll")]
    private static extern int GetSystemMetrics(int nIndex);

    private const int SM_CXSCREEN = 0;
    private const int SM_CYSCREEN = 1;

    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    private static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    private const int MOUSEEVENTF_LEFTDOWN = 0x02;
    private const int MOUSEEVENTF_LEFTUP = 0x04;
    private const int MOUSEEVENTF_RIGHTDOWN = 0x08;
    private const int MOUSEEVENTF_RIGHTUP = 0x10;
    private const int MOUSEEVENTF_MIDDLEDOWN = 0x20;
    private const int MOUSEEVENTF_MIDDLEUP = 0x40;
    private const int MOUSEEVENTF_WHEEL = 0x0800;

    private const uint KEYEVENTF_KEYDOWN = 0;
    private const uint KEYEVENTF_KEYUP = 2;

    private static readonly IntPtr DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 = new(-4);
    private static int _dpiAwarenessInitialized;
    private static bool _dpiAware;

    private enum PROCESS_DPI_AWARENESS
    {
        Process_DPI_Unaware = 0,
        Process_System_DPI_Aware = 1,
        Process_Per_Monitor_DPI_Aware = 2
    }

    /// <summary>
    /// 是否运行在 Session 0（IIS / Windows Service 环境）
    /// </summary>
    private static bool IsSession0 => InteractiveProcessLauncher.IsRunningInSession0;

    #region 进程列表缓存

    /// <summary>模块信息缓存（进程名 → 描述 + 文件路径），避免重复访问 MainModule</summary>
    private static readonly ConcurrentDictionary<string, (string Description, string FilePath)> _moduleInfoCache = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>CPU 采样缓存（PID → 上次采样时间 + CPU 时间）</summary>
    private static readonly ConcurrentDictionary<int, (DateTime SampleTime, TimeSpan CpuTime)> _cpuSamples = new();

    /// <summary>窗口映射缓存</summary>
    private static Dictionary<int, string>? _windowMapCache;
    private static DateTime _windowMapCacheTime = DateTime.MinValue;
    private static readonly TimeSpan WindowMapCacheDuration = TimeSpan.FromSeconds(5);

    /// <summary>CPU 核心数（用于计算 CPU 百分比）</summary>
    private static readonly int ProcessorCount = Environment.ProcessorCount;

    #endregion

    /// <summary>
    /// 关机
    /// </summary>
    public void Shutdown()
    {
        if (IsSession0)
        {
            // shutdown.exe 可以从 Session 0 直接执行
            InteractiveProcessLauncher.LaunchInInteractiveSession(
                "shutdown /s /t 5 /c \"Remote Control: System will shutdown in 5 seconds\"");
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = "shutdown",
            Arguments = "/s /t 5 /c \"Remote Control: System will shutdown in 5 seconds\"",
            CreateNoWindow = true,
            UseShellExecute = false
        });
    }

    /// <summary>
    /// 取消关机
    /// </summary>
    public void CancelShutdown()
    {
        if (IsSession0)
        {
            InteractiveProcessLauncher.LaunchInInteractiveSession("shutdown /a");
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = "shutdown",
            Arguments = "/a",
            CreateNoWindow = true,
            UseShellExecute = false
        });
    }

    /// <summary>
    /// 睡眠（挂起到内存）
    /// </summary>
    public void Sleep()
    {
        if (IsSession0)
        {
            InteractiveProcessLauncher.LaunchInInteractiveSession(
                "rundll32.exe powrprof.dll,SetSuspendState 0,1,0");
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = "rundll32.exe",
            Arguments = "powrprof.dll,SetSuspendState 0,1,0",
            CreateNoWindow = true,
            UseShellExecute = false
        });
    }

    /// <summary>
    /// 休眠
    /// </summary>
    public void Hibernate()
    {
        if (IsSession0)
        {
            InteractiveProcessLauncher.LaunchInInteractiveSession("shutdown /h");
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = "shutdown",
            Arguments = "/h",
            CreateNoWindow = true,
            UseShellExecute = false
        });
    }

    /// <summary>
    /// 获取进程列表（有窗口的进程排在前面，类似 Windows 任务管理器）。
    /// Windows 使用 Process + 窗口缓存；Linux 使用 /proc 枚举。
    /// </summary>
    public async Task<List<ProcessInfo>> GetProcessListAsync()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            return await GetProcessListLinuxAsync();

        var now = DateTime.UtcNow;

        // 1. 获取窗口映射（Session 0 通过 DesktopAgent，带缓存）
        var windowMap = await GetWindowMapAsync(now);

        // 2. 快速枚举进程，使用缓存获取慢速属性
        var processes = new List<ProcessInfo>();
        var alivePids = new HashSet<int>();

        try
        {
            foreach (var proc in Process.GetProcesses())
            {
                try
                {
                    var pid = proc.Id;
                    var name = proc.ProcessName;
                    alivePids.Add(pid);

                    // 窗口信息
                    bool hasWindow;
                    string windowTitle;
                    if (windowMap != null)
                    {
                        hasWindow = windowMap.ContainsKey(pid);
                        windowTitle = hasWindow ? windowMap[pid] : "";
                    }
                    else
                    {
                        hasWindow = proc.MainWindowHandle != IntPtr.Zero;
                        windowTitle = hasWindow ? (proc.MainWindowTitle ?? "") : "";
                    }

                    // 模块信息（从缓存获取，避免重复访问 MainModule）
                    var (description, filePath) = GetCachedModuleInfo(proc);

                    // CPU 使用率（增量计算）
                    var cpuPercent = CalculateCpuPercent(proc, pid, now);

                    processes.Add(new ProcessInfo
                    {
                        Id = pid,
                        Name = name,
                        MemoryMB = Math.Round(proc.WorkingSet64 / 1024.0 / 1024.0, 1),
                        Threads = proc.Threads.Count,
                        StartTime = GetProcessStartTime(proc),
                        HasWindow = hasWindow,
                        WindowTitle = windowTitle,
                        Description = description,
                        FilePath = filePath,
                        CpuPercent = cpuPercent
                    });
                }
                catch
                {
                    // 跳过无权限访问的进程
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"GetProcessList error: {ex.Message}");
        }

        // 3. 清理已退出进程的 CPU 采样
        foreach (var pid in _cpuSamples.Keys)
        {
            if (!alivePids.Contains(pid))
                _cpuSamples.TryRemove(pid, out _);
        }

        // 有窗口的进程排前面，同组内按内存降序
        return processes
            .OrderByDescending(p => p.HasWindow)
            .ThenByDescending(p => p.MemoryMB)
            .ToList();
    }

    /// <summary>
    /// Linux 进程列表：从 /proc 读取 PID、名称、内存、启动时间等。
    /// </summary>
    private static async Task<List<ProcessInfo>> GetProcessListLinuxAsync()
    {
        var list = new List<ProcessInfo>();
        try
        {
            var procDir = new DirectoryInfo("/proc");
            if (!procDir.Exists) return list;

            foreach (var dir in procDir.GetDirectories())
            {
                if (!int.TryParse(dir.Name, out var pid)) continue;
                try
                {
                    var (name, cmdline, exePath) = GetLinuxProcessNameAndPath(pid);
                    var (memoryMb, startTime, cpuPercent) = GetLinuxProcessStats(pid);
                    list.Add(new ProcessInfo
                    {
                        Id = pid,
                        Name = name,
                        MemoryMB = memoryMb,
                        Threads = 0,
                        StartTime = startTime,
                        HasWindow = false,
                        WindowTitle = "",
                        Description = string.IsNullOrEmpty(cmdline) ? "" : cmdline.Length > 80 ? cmdline[..80] + "…" : cmdline,
                        FilePath = exePath ?? "",
                        CpuPercent = cpuPercent
                    });
                }
                catch { /* 忽略无权限或已退出的进程 */ }
            }

            list = list.OrderByDescending(p => p.MemoryMB).ToList();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"GetProcessListLinux error: {ex.Message}");
        }

        return await Task.FromResult(list);
    }

    private static (string name, string cmdline, string? exePath) GetLinuxProcessNameAndPath(int pid)
    {
        var name = "";
        var cmdline = "";
        string? exePath = null;
        try
        {
            var commPath = $"/proc/{pid}/comm";
            if (File.Exists(commPath))
                name = File.ReadAllText(commPath).Trim().TrimEnd('\n');
            var cmdPath = $"/proc/{pid}/cmdline";
            if (File.Exists(cmdPath))
            {
                var raw = File.ReadAllBytes(cmdPath);
                cmdline = raw.Length == 0 ? "" : System.Text.Encoding.UTF8.GetString(raw).Replace('\0', ' ').Trim();
                if (string.IsNullOrEmpty(name) && cmdline.Length > 0)
                    name = cmdline.Split(' ')[0].Split('/').LastOrDefault() ?? "";
            }
            var exeLink = $"/proc/{pid}/exe";
            if (File.Exists(exeLink))
            {
                try
                {
                    exePath = System.IO.File.ResolveLinkTarget(exeLink, false)?.FullName;
                }
                catch { }
            }
        }
        catch { }
        if (string.IsNullOrEmpty(name))
            name = pid.ToString();
        return (name, cmdline, exePath);
    }

    private static (double memoryMb, string startTime, double cpuPercent) GetLinuxProcessStats(int pid)
    {
        double memoryMb = 0;
        string startTime = "-";
        double cpuPercent = 0;
        try
        {
            var statPath = $"/proc/{pid}/stat";
            if (!File.Exists(statPath)) return (0, "-", 0);
            var stat = File.ReadAllText(statPath);
            // format: pid (comm) state ppid ... starttime(20th) vsize rss(22nd) ...
            var closeParen = stat.IndexOf(')');
            if (closeParen < 0) return (0, "-", 0);
            var afterComm = stat[(closeParen + 1)..].TrimStart().Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (afterComm.Length > 21)
            {
                if (long.TryParse(afterComm[21], out var rss))
                    memoryMb = Math.Round(rss * 4096.0 / 1024.0 / 1024.0, 1); // page size 4KB
                if (long.TryParse(afterComm[19], out var startTicks))
                {
                    try
                    {
                        var boot = GetLinuxBootTime();
                        var startSec = boot + startTicks / 100.0;
                        var startDate = DateTimeOffset.FromUnixTimeSeconds((long)startSec);
                        startTime = startDate.LocalDateTime.ToString("yyyy-MM-dd HH:mm:ss");
                    }
                    catch { }
                }
            }
        }
        catch { }
        return (memoryMb, startTime, cpuPercent);
    }

    private static long GetLinuxBootTime()
    {
        try
        {
            var line = File.ReadAllText("/proc/uptime").Trim().Split(' ')[0];
            var uptimeSec = double.Parse(line, System.Globalization.CultureInfo.InvariantCulture);
            return (long)(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - uptimeSec);
        }
        catch { }
        return 0;
    }

    /// <summary>
    /// 获取窗口映射（带缓存）
    /// </summary>
    private async Task<Dictionary<int, string>?> GetWindowMapAsync(DateTime now)
    {
        if (!IsSession0) return null;

        // 使用缓存，避免每次都调用 DesktopAgent
        if (_windowMapCache != null && now - _windowMapCacheTime < WindowMapCacheDuration)
            return _windowMapCache;

        try
        {
            _windowMapCache = await DesktopAgent.EnumWindowsAsync();
            _windowMapCacheTime = now;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"GetProcessList: 获取窗口信息失败: {ex.Message}");
        }

        return _windowMapCache;
    }

    /// <summary>
    /// 从缓存获取模块信息（描述 + 文件路径），未缓存时才访问 MainModule
    /// </summary>
    private (string Description, string FilePath) GetCachedModuleInfo(Process proc)
    {
        var name = proc.ProcessName;

        if (_moduleInfoCache.TryGetValue(name, out var cached))
            return cached;

        // 首次遇到此进程名，访问 MainModule（慢操作）
        var description = "";
        var filePath = "";
        try
        {
            var module = proc.MainModule;
            if (module != null)
            {
                filePath = module.FileName ?? "";
                if (module.FileVersionInfo != null)
                {
                    var desc = module.FileVersionInfo.FileDescription;
                    if (!string.IsNullOrWhiteSpace(desc))
                        description = desc;
                    else
                    {
                        var product = module.FileVersionInfo.ProductName;
                        if (!string.IsNullOrWhiteSpace(product))
                            description = product;
                    }
                }
            }
        }
        catch
        {
            // 无权限访问 MainModule
        }

        _moduleInfoCache[name] = (description, filePath);
        return (description, filePath);
    }

    /// <summary>
    /// 计算进程 CPU 使用百分比（基于两次采样的增量）
    /// </summary>
    private double CalculateCpuPercent(Process proc, int pid, DateTime now)
    {
        TimeSpan currentCpuTime;
        try
        {
            currentCpuTime = proc.TotalProcessorTime;
        }
        catch
        {
            return 0;
        }

        double cpuPercent = 0;
        if (_cpuSamples.TryGetValue(pid, out var prev))
        {
            var elapsed = (now - prev.SampleTime).TotalMilliseconds;
            if (elapsed > 0)
            {
                var cpuDelta = (currentCpuTime - prev.CpuTime).TotalMilliseconds;
                cpuPercent = Math.Round(cpuDelta / elapsed / ProcessorCount * 100, 1);
                if (cpuPercent < 0) cpuPercent = 0;
                if (cpuPercent > 100) cpuPercent = 100;
            }
        }

        _cpuSamples[pid] = (now, currentCpuTime);
        return cpuPercent;
    }

    /// <summary>
    /// 获取进程启动时间
    /// </summary>
    private string GetProcessStartTime(Process proc)
    {
        try
        {
            return proc.StartTime.ToString("yyyy-MM-dd HH:mm:ss");
        }
        catch
        {
            return "-";
        }
    }

    /// <summary>
    /// 终止进程
    /// </summary>
    public bool KillProcess(int processId)
    {
        try
        {
            var process = Process.GetProcessById(processId);
            process.Kill(true);
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"KillProcess error: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// 锁定工作站
    /// </summary>
    public void LockWorkstation()
    {
        if (IsSession0)
        {
            // 通过代理在交互式会话中执行锁定
            _ = DesktopAgent.LockWorkstationAsync();
            return;
        }

        Process.Start(new ProcessStartInfo
        {
            FileName = "rundll32.exe",
            Arguments = "user32.dll,LockWorkStation",
            CreateNoWindow = true,
            UseShellExecute = false
        });
    }

    /// <summary>
    /// 截取屏幕
    /// </summary>
    public byte[] CaptureScreen()
    {
        if (IsSession0)
        {
            // 通过代理在交互式会话中截图
            return DesktopAgent.CaptureScreenAsync().GetAwaiter().GetResult();
        }

        return CaptureScreenDirect();
    }

    /// <summary>
    /// 异步截取屏幕（Session 0 兼容）
    /// </summary>
    public async Task<byte[]> CaptureScreenAsync()
    {
        if (IsSession0)
        {
            return await DesktopAgent.CaptureScreenAsync();
        }

        return CaptureScreenDirect();
    }

    /// <summary>
    /// 直接截图（在交互式会话中调用）
    /// </summary>
    internal byte[] CaptureScreenDirect()
    {
        try
        {
            EnsureDpiAwareness();
            // 使用 System.Windows.Forms.Screen 获取完整屏幕信息（包括多屏幕）
            // 如果无法使用 Windows Forms，使用 WinAPI 获取屏幕尺寸
            var screenBounds = GetVirtualScreenBounds();
            int width = screenBounds.Width;
            int height = screenBounds.Height;
            int offsetX = screenBounds.X;
            int offsetY = screenBounds.Y;

            if (width <= 0 || height <= 0)
            {
                width = 1920;
                height = 1080;
                offsetX = 0;
                offsetY = 0;
            }

            using var bitmap = new Bitmap(width, height);
            using var graphics = Graphics.FromImage(bitmap);

            // 若未成功设置 DPI 感知，尝试按系统缩放比例修正尺寸，避免截图被裁剪
            if (!_dpiAware)
            {
                var scaleX = graphics.DpiX / 96f;
                var scaleY = graphics.DpiY / 96f;
                if (scaleX > 1.01f || scaleY > 1.01f)
                {
                    width = (int)Math.Round(width * scaleX);
                    height = (int)Math.Round(height * scaleY);
                    offsetX = (int)Math.Round(offsetX * scaleX);
                    offsetY = (int)Math.Round(offsetY * scaleY);
                }
            }

            if (bitmap.Width != width || bitmap.Height != height)
            {
                using var resizedBitmap = new Bitmap(width, height);
                using var resizedGraphics = Graphics.FromImage(resizedBitmap);
                resizedGraphics.CopyFromScreen(offsetX, offsetY, 0, 0, new Size(width, height));
                // 压缩到最大 2K 分辨率（2560x1440）
                return CompressScreenshot(resizedBitmap);
            }

            // 从虚拟屏幕坐标捕获，支持多屏幕
            graphics.CopyFromScreen(offsetX, offsetY, 0, 0, new Size(width, height));

            // 压缩到最大 2K 分辨率（2560x1440）
            return CompressScreenshot(bitmap);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Screenshot error: {ex.Message}");
            return Array.Empty<byte>();
        }
    }

    /// <summary>
    /// 压缩截图到最大 2K 分辨率（2560x1440）以减少网络传输和浏览器渲染压力
    /// </summary>
    private byte[] CompressScreenshot(Bitmap originalBitmap)
    {
        try
        {
            const int maxWidth = 2560;  // 2K 分辨率最大宽度
            const int maxHeight = 1440; // 2K 分辨率最大高度

            // 如果原始图片不超过 2K，直接保存
            if (originalBitmap.Width <= maxWidth && originalBitmap.Height <= maxHeight)
            {
                using var memoryStream = new MemoryStream();
                originalBitmap.Save(memoryStream, ImageFormat.Jpeg);
                return memoryStream.ToArray();
            }

            // 计算缩放比例，保持宽高比
            float scaleRatio = Math.Min((float)maxWidth / originalBitmap.Width,
                                        (float)maxHeight / originalBitmap.Height);

            int newWidth = (int)(originalBitmap.Width * scaleRatio);
            int newHeight = (int)(originalBitmap.Height * scaleRatio);

            Console.WriteLine($"Compressing screenshot from {originalBitmap.Width}x{originalBitmap.Height} to {newWidth}x{newHeight}");

            // 创建压缩后的图片
            using var compressedBitmap = new Bitmap(newWidth, newHeight);
            using var graphics = Graphics.FromImage(compressedBitmap);

            // 设置高质量的缩放参数
            graphics.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
            graphics.CompositingQuality = System.Drawing.Drawing2D.CompositingQuality.HighQuality;

            graphics.DrawImage(originalBitmap, 0, 0, newWidth, newHeight);

            // 以高质量 JPEG 格式保存
            using var compressedMemoryStream = new MemoryStream();

            // 设置 JPEG 质量编码器参数
            var encoderParameters = new EncoderParameters(1);
            encoderParameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, 85L);

            var jpegCodec = ImageCodecInfo.GetImageEncoders()
                .FirstOrDefault(codec => codec.MimeType == "image/jpeg");

            if (jpegCodec != null)
            {
                compressedBitmap.Save(compressedMemoryStream, jpegCodec, encoderParameters);
            }
            else
            {
                compressedBitmap.Save(compressedMemoryStream, ImageFormat.Jpeg);
            }

            return compressedMemoryStream.ToArray();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"CompressScreenshot error: {ex.Message}");
            // 降级处理：直接保存原始图片
            using var memoryStream = new MemoryStream();
            originalBitmap.Save(memoryStream, ImageFormat.Jpeg);
            return memoryStream.ToArray();
        }
    }

    /// <summary>
    /// 获取虚拟屏幕边界（支持多屏幕）
    /// </summary>
    internal Rectangle GetVirtualScreenBounds()
    {
        try
        {
            // 尝试使用 Windows.Forms.Screen
            var assembly = System.Reflection.Assembly.Load("System.Windows.Forms");
            var screenType = assembly.GetType("System.Windows.Forms.Screen");
            if (screenType != null)
            {
                var allScreensProperty = screenType.GetProperty("AllScreens");
                if (allScreensProperty != null)
                {
                    var allScreens = (Array)allScreensProperty.GetValue(null);
                    if (allScreens != null && allScreens.Length > 0)
                    {
                        int minX = int.MaxValue, minY = int.MaxValue;
                        int maxX = int.MinValue, maxY = int.MinValue;

                        foreach (var screen in allScreens)
                        {
                            var boundsProperty = screenType.GetProperty("Bounds");
                            if (boundsProperty != null)
                            {
                                var bounds = (Rectangle)boundsProperty.GetValue(screen);
                                minX = Math.Min(minX, bounds.X);
                                minY = Math.Min(minY, bounds.Y);
                                maxX = Math.Max(maxX, bounds.Right);
                                maxY = Math.Max(maxY, bounds.Bottom);
                            }
                        }

                        return new Rectangle(minX, minY, maxX - minX, maxY - minY);
                    }
                }
            }
        }
        catch
        {
            // 如果 Windows.Forms 不可用，使用备用方案
        }

        // 备用方案：使用 WinAPI 获取虚拟屏幕尺寸
        const int SM_XVIRTUALSCREEN = 76;
        const int SM_YVIRTUALSCREEN = 77;
        const int SM_CXVIRTUALSCREEN = 78;
        const int SM_CYVIRTUALSCREEN = 79;

        int x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        int y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        int width = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        int height = GetSystemMetrics(SM_CYVIRTUALSCREEN);

        if (width <= 0 || height <= 0)
        {
            width = GetSystemMetrics(SM_CXSCREEN);
            height = GetSystemMetrics(SM_CYSCREEN);
            x = 0;
            y = 0;
        }

        return new Rectangle(x, y, width, height);
    }

    private static void EnsureDpiAwareness()
    {
        if (Interlocked.Exchange(ref _dpiAwarenessInitialized, 1) == 1)
        {
            return;
        }

        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return;
        }

        try
        {
            if (SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2))
            {
                _dpiAware = true;
                return;
            }
        }
        catch
        {
        }

        try
        {
            if (SetProcessDpiAwareness(PROCESS_DPI_AWARENESS.Process_Per_Monitor_DPI_Aware) == 0)
            {
                _dpiAware = true;
                return;
            }
        }
        catch
        {
        }

        try
        {
            if (SetProcessDPIAware())
            {
                _dpiAware = true;
            }
        }
        catch
        {
        }
    }

    // 以下键鼠输入使用 mouse_event/keybd_event，受 UIPI 限制：
    // 当前景窗口为“高完整性”进程（如任务管理器、磁盘管理、以管理员运行的软件）时，
    // 普通权限的本进程发出的输入会被系统静默丢弃，表现为点击/按键无反应；视频流不受影响。
    // 若需控制这些窗口，请以管理员身份运行本应用（远程端 Agent）。

    /// <summary>
    /// 发送鼠标左键点击
    /// </summary>
    public void SendMouseClick(double normalizedX, double normalizedY)
    {
        if (IsSession0)
        {
            _ = DesktopAgent.SendMouseClickAsync(normalizedX, normalizedY);
            return;
        }

        try
        {
            var bounds = GetVirtualScreenBounds();
            int x = bounds.X + (int)(bounds.Width * normalizedX);
            int y = bounds.Y + (int)(bounds.Height * normalizedY);

            SetCursorPos(x, y);
            mouse_event(MOUSEEVENTF_LEFTDOWN, x, y, 0, 0);
            mouse_event(MOUSEEVENTF_LEFTUP, x, y, 0, 0);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"SendMouseClick error: {ex.Message}");
        }
    }

    /// <summary>
    /// 发送鼠标右键点击
    /// </summary>
    public void SendMouseRightClick(double normalizedX, double normalizedY)
    {
        if (IsSession0)
        {
            _ = DesktopAgent.SendMouseRightClickAsync(normalizedX, normalizedY);
            return;
        }

        try
        {
            var bounds = GetVirtualScreenBounds();
            int x = bounds.X + (int)(bounds.Width * normalizedX);
            int y = bounds.Y + (int)(bounds.Height * normalizedY);

            SetCursorPos(x, y);
            mouse_event(MOUSEEVENTF_RIGHTDOWN, x, y, 0, 0);
            mouse_event(MOUSEEVENTF_RIGHTUP, x, y, 0, 0);
            Console.WriteLine($"Right click sent at ({x}, {y})");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"SendMouseRightClick error: {ex.Message}");
        }
    }

    /// <summary>
    /// 发送鼠标中键点击
    /// </summary>
    public void SendMouseMiddleClick(double normalizedX, double normalizedY)
    {
        if (IsSession0)
        {
            _ = DesktopAgent.SendMouseMiddleClickAsync(normalizedX, normalizedY);
            return;
        }

        try
        {
            var bounds = GetVirtualScreenBounds();
            int x = bounds.X + (int)(bounds.Width * normalizedX);
            int y = bounds.Y + (int)(bounds.Height * normalizedY);

            SetCursorPos(x, y);
            mouse_event(MOUSEEVENTF_MIDDLEDOWN, x, y, 0, 0);
            mouse_event(MOUSEEVENTF_MIDDLEUP, x, y, 0, 0);
            Console.WriteLine($"Middle click sent at ({x}, {y})");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"SendMouseMiddleClick error: {ex.Message}");
        }
    }

    /// <summary>
    /// 鼠标按下（用于拖动操作）
    /// </summary>
    /// <param name="button">0=左键, 1=中键, 2=右键</param>
    public void SendMouseDown(double normalizedX, double normalizedY, int button = 0)
    {
        if (IsSession0)
        {
            _ = DesktopAgent.SendMouseDownAsync(normalizedX, normalizedY, button);
            return;
        }

        try
        {
            var bounds = GetVirtualScreenBounds();
            int x = bounds.X + (int)(bounds.Width * normalizedX);
            int y = bounds.Y + (int)(bounds.Height * normalizedY);

            SetCursorPos(x, y);
            int flag = button switch
            {
                1 => MOUSEEVENTF_MIDDLEDOWN,
                2 => MOUSEEVENTF_RIGHTDOWN,
                _ => MOUSEEVENTF_LEFTDOWN
            };
            mouse_event(flag, x, y, 0, 0);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"SendMouseDown error: {ex.Message}");
        }
    }

    /// <summary>
    /// 鼠标释放（用于拖动操作）
    /// </summary>
    /// <param name="button">0=左键, 1=中键, 2=右键</param>
    public void SendMouseUp(double normalizedX, double normalizedY, int button = 0)
    {
        if (IsSession0)
        {
            _ = DesktopAgent.SendMouseUpAsync(normalizedX, normalizedY, button);
            return;
        }

        try
        {
            var bounds = GetVirtualScreenBounds();
            int x = bounds.X + (int)(bounds.Width * normalizedX);
            int y = bounds.Y + (int)(bounds.Height * normalizedY);

            SetCursorPos(x, y);
            int flag = button switch
            {
                1 => MOUSEEVENTF_MIDDLEUP,
                2 => MOUSEEVENTF_RIGHTUP,
                _ => MOUSEEVENTF_LEFTUP
            };
            mouse_event(flag, x, y, 0, 0);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"SendMouseUp error: {ex.Message}");
        }
    }

    /// <summary>
    /// 鼠标移动（用于拖动操作）
    /// </summary>
    public void SendMouseMove(double normalizedX, double normalizedY)
    {
        if (IsSession0)
        {
            _ = DesktopAgent.SendMouseMoveAsync(normalizedX, normalizedY);
            return;
        }

        try
        {
            var bounds = GetVirtualScreenBounds();
            int x = bounds.X + (int)(bounds.Width * normalizedX);
            int y = bounds.Y + (int)(bounds.Height * normalizedY);

            SetCursorPos(x, y);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"SendMouseMove error: {ex.Message}");
        }
    }

    /// <summary>
    /// 发送鼠标滚轮（归一化坐标 + 滚动量，正=上滚，负=下滚）
    /// </summary>
    public void SendMouseWheel(double normalizedX, double normalizedY, int delta)
    {
        if (IsSession0)
        {
            _ = DesktopAgent.SendMouseWheelAsync(normalizedX, normalizedY, delta);
            return;
        }

        try
        {
            var bounds = GetVirtualScreenBounds();
            int x = bounds.X + (int)(bounds.Width * normalizedX);
            int y = bounds.Y + (int)(bounds.Height * normalizedY);

            SetCursorPos(x, y);
            mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, 0);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"SendMouseWheel error: {ex.Message}");
        }
    }

    /// <summary>
    /// 发送键盘事件
    /// </summary>
    public void SendKeyboardEvent(byte vkCode, bool isKeyDown)
    {
        if (IsSession0)
        {
            _ = DesktopAgent.SendKeyboardEventAsync(vkCode, isKeyDown);
            return;
        }

        try
        {
            uint dwFlags = isKeyDown ? KEYEVENTF_KEYDOWN : KEYEVENTF_KEYUP;
            keybd_event(vkCode, 0, dwFlags, UIntPtr.Zero);
            Console.WriteLine($"Key event sent: VK={vkCode}, IsDown={isKeyDown}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"SendKeyboardEvent error: {ex.Message}");
        }
    }

    /// <summary>
    /// 发送多个键盘事件（支持组合键）
    /// </summary>
    public void SendKeyboardEvents(byte[] vkCodes, bool isKeyDown)
    {
        if (IsSession0)
        {
            _ = DesktopAgent.SendKeyboardEventsAsync(vkCodes, isKeyDown);
            return;
        }

        try
        {
            uint dwFlags = isKeyDown ? KEYEVENTF_KEYDOWN : KEYEVENTF_KEYUP;
            foreach (var vkCode in vkCodes)
            {
                keybd_event(vkCode, 0, dwFlags, UIntPtr.Zero);
                System.Threading.Thread.Sleep(10); // 键之间的延迟
            }
            Console.WriteLine($"Multi-key event sent: {vkCodes.Length} keys, IsDown={isKeyDown}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"SendKeyboardEvents error: {ex.Message}");
        }
    }

    /// <summary>
    /// 内存状态结构体（用于 P/Invoke）
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    private struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

    /// <summary>
    /// 获取系统信息（包含 CPU/GPU/RAM/磁盘/温度等）。Windows 使用 WMI，Linux 使用 /proc、/sys 等。
    /// </summary>
    public SystemInfo GetSystemInfo()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
            return GetSystemInfoLinux();

        var info = new SystemInfo
        {
            Platform = "Windows",
            MachineName = Environment.MachineName,
            UserName = Environment.UserName,
            OSVersion = Environment.OSVersion.ToString(),
            ProcessorCount = Environment.ProcessorCount,
            Is64Bit = Environment.Is64BitOperatingSystem,
            SystemDirectory = Environment.SystemDirectory,
            UpTime = TimeSpan.FromMilliseconds(Environment.TickCount64).ToString(@"dd\.hh\:mm\:ss")
        };

        // 获取 CPU 详情（Windows WMI）
        try
        {
            using var cpuSearcher = new ManagementObjectSearcher("SELECT Name, LoadPercentage, NumberOfCores, NumberOfLogicalProcessors, MaxClockSpeed FROM Win32_Processor");
            foreach (ManagementObject obj in cpuSearcher.Get())
            {
                info.CpuName = obj["Name"]?.ToString()?.Trim() ?? "";
                info.CpuUsagePercent = Convert.ToInt32(obj["LoadPercentage"] ?? 0);
                info.CpuCores = Convert.ToInt32(obj["NumberOfCores"] ?? 0);
                info.CpuLogicalProcessors = Convert.ToInt32(obj["NumberOfLogicalProcessors"] ?? 0);
                info.CpuMaxClockSpeedMHz = Convert.ToInt32(obj["MaxClockSpeed"] ?? 0);
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"GetCpuInfo error: {ex.Message}");
        }

        // 获取 GPU 详情
        try
        {
            using var gpuSearcher = new ManagementObjectSearcher("SELECT Name, AdapterRAM, DriverVersion FROM Win32_VideoController");
            var gpuList = new List<GpuInfo>();
            foreach (ManagementObject obj in gpuSearcher.Get())
            {
                var gpuName = obj["Name"]?.ToString()?.Trim() ?? "";
                if (string.IsNullOrEmpty(gpuName)) continue;

                var adapterRam = Convert.ToInt64(obj["AdapterRAM"] ?? 0);
                gpuList.Add(new GpuInfo
                {
                    Name = gpuName,
                    MemoryMB = adapterRam > 0 ? adapterRam / 1024 / 1024 : 0,
                    DriverVersion = obj["DriverVersion"]?.ToString() ?? ""
                });
            }
            info.Gpus = gpuList;

            // 尝试通过 nvidia-smi 获取 NVIDIA GPU 温度和占用率
            TryGetNvidiaGpuStats(info.Gpus);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"GetGpuInfo error: {ex.Message}");
        }

        // 获取内存信息
        try
        {
            var memStatus = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };
            if (GlobalMemoryStatusEx(ref memStatus))
            {
                info.TotalMemoryMB = (long)(memStatus.ullTotalPhys / 1024 / 1024);
                info.AvailableMemoryMB = (long)(memStatus.ullAvailPhys / 1024 / 1024);
                info.UsedMemoryMB = info.TotalMemoryMB - info.AvailableMemoryMB;
                info.MemoryUsagePercent = (int)memStatus.dwMemoryLoad;
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"GetMemoryInfo error: {ex.Message}");
        }

        // 获取磁盘信息
        try
        {
            var driveList = new List<DriveInfoDto>();
            foreach (var drive in DriveInfo.GetDrives())
            {
                try
                {
                    if (drive.IsReady && (drive.DriveType == DriveType.Fixed || drive.DriveType == DriveType.Removable))
                    {
                        var totalGB = Math.Round(drive.TotalSize / 1024.0 / 1024.0 / 1024.0, 1);
                        var freeGB = Math.Round(drive.AvailableFreeSpace / 1024.0 / 1024.0 / 1024.0, 1);
                        var usedGB = Math.Round(totalGB - freeGB, 1);
                        driveList.Add(new DriveInfoDto
                        {
                            Name = $"{drive.Name.TrimEnd('\\')} {drive.VolumeLabel}".Trim(),
                            TotalGB = totalGB,
                            UsedGB = usedGB,
                            FreeGB = freeGB,
                            UsagePercent = totalGB > 0 ? (int)Math.Round(usedGB / totalGB * 100) : 0,
                            DriveFormat = drive.DriveFormat
                        });
                    }
                }
                catch
                {
                    // 跳过无法访问的驱动器
                }
            }
            info.Drives = driveList;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"GetDriveInfo error: {ex.Message}");
        }

        // 获取 CPU 温度（通过 WMI 热区传感器，需要管理员权限）
        try
        {
            using var tempSearcher = new ManagementObjectSearcher(@"root\WMI", "SELECT CurrentTemperature FROM MSAcpi_ThermalZoneTemperature");
            foreach (ManagementObject obj in tempSearcher.Get())
            {
                // WMI 温度单位为 0.1 开尔文，转换为摄氏度
                var tempKelvin = Convert.ToDouble(obj["CurrentTemperature"] ?? 0);
                var tempCelsius = (tempKelvin / 10.0) - 273.15;
                if (tempCelsius is > 0 and < 150)
                {
                    info.CpuTemperature = Math.Round(tempCelsius, 1);
                    break;
                }
            }
        }
        catch
        {
            // WMI 热区查询需要管理员权限，失败时忽略
        }

        // 获取网络适配器信息
        try
        {
            using var netSearcher = new ManagementObjectSearcher(
                "SELECT Name, Speed, MACAddress, NetConnectionStatus FROM Win32_NetworkAdapter WHERE NetConnectionStatus = 2");
            var networkList = new List<NetworkAdapterInfo>();
            foreach (ManagementObject obj in netSearcher.Get())
            {
                var speed = Convert.ToInt64(obj["Speed"] ?? 0);
                networkList.Add(new NetworkAdapterInfo
                {
                    Name = obj["Name"]?.ToString() ?? "",
                    SpeedMbps = speed > 0 ? speed / 1_000_000 : 0,
                    MacAddress = obj["MACAddress"]?.ToString() ?? ""
                });
            }
            info.NetworkAdapters = networkList;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"GetNetworkInfo error: {ex.Message}");
        }

        return info;
    }

    /// <summary>
    /// Linux 系统信息：从 /proc、/sys 及常用命令获取 CPU/内存/磁盘/网络/GPU。
    /// </summary>
    private static SystemInfo GetSystemInfoLinux()
    {
        var info = new SystemInfo
        {
            Platform = "Linux",
            MachineName = Environment.MachineName,
            UserName = Environment.UserName,
            OSVersion = GetLinuxOsVersion(),
            ProcessorCount = Environment.ProcessorCount,
            Is64Bit = Environment.Is64BitOperatingSystem,
            SystemDirectory = "",
            UpTime = GetLinuxUptime()
        };

        GetLinuxCpuInfo(info);
        GetLinuxMemoryInfo(info);
        GetLinuxGpuInfo(info);
        GetLinuxDriveInfo(info);
        GetLinuxNetworkInfo(info);
        GetLinuxCpuTemperature(info);

        return info;
    }

    private static string GetLinuxOsVersion()
    {
        try
        {
            if (File.Exists("/proc/version"))
                return File.ReadAllText("/proc/version").Trim().Replace("\n", " ");
        }
        catch { }
        return Environment.OSVersion.ToString();
    }

    private static string GetLinuxUptime()
    {
        try
        {
            var line = File.ReadAllText("/proc/uptime").Trim();
            var seconds = double.Parse(line.Split(' ', StringSplitOptions.RemoveEmptyEntries)[0], System.Globalization.CultureInfo.InvariantCulture);
            var ts = TimeSpan.FromSeconds(seconds);
            return $"{(int)ts.TotalDays}.{ts.Hours:D2}:{ts.Minutes:D2}:{ts.Seconds:D2}";
        }
        catch { }
        return "-";
    }

    private static void GetLinuxCpuInfo(SystemInfo info)
    {
        try
        {
            var cpuinfo = File.Exists("/proc/cpuinfo") ? File.ReadAllText("/proc/cpuinfo") : "";
            var lines = cpuinfo.Split('\n');
            foreach (var line in lines)
            {
                if (line.StartsWith("model name", StringComparison.OrdinalIgnoreCase))
                {
                    var colon = line.IndexOf(':');
                    if (colon >= 0)
                        info.CpuName = line[(colon + 1)..].Trim();
                    break;
                }
            }
            foreach (var line in lines)
            {
                if (line.StartsWith("cpu cores", StringComparison.OrdinalIgnoreCase))
                {
                    var colon = line.IndexOf(':');
                    if (colon >= 0 && int.TryParse(line[(colon + 1)..].Trim(), out var cores))
                        info.CpuCores = cores;
                    break;
                }
            }
            foreach (var line in lines)
            {
                if (line.StartsWith("cpu MHz", StringComparison.OrdinalIgnoreCase))
                {
                    var colon = line.IndexOf(':');
                    if (colon >= 0 && double.TryParse(line[(colon + 1)..].Trim(), System.Globalization.NumberStyles.Any, System.Globalization.CultureInfo.InvariantCulture, out var mhz))
                        info.CpuMaxClockSpeedMHz = (int)Math.Round(mhz);
                    break;
                }
            }
            if (info.CpuCores <= 0)
                info.CpuCores = info.ProcessorCount;
            info.CpuLogicalProcessors = info.ProcessorCount;
        }
        catch (Exception ex) { Console.WriteLine($"GetLinuxCpuInfo: {ex.Message}"); }

        try
        {
            var stat = File.Exists("/proc/stat") ? File.ReadAllText("/proc/stat") : "";
            var firstLine = stat.Split('\n').FirstOrDefault(l => l.StartsWith("cpu ", StringComparison.Ordinal));
            if (firstLine != null)
            {
                var parts = firstLine.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 8 && long.TryParse(parts[1], out var user) && long.TryParse(parts[2], out var nice) &&
                    long.TryParse(parts[3], out var sys) && long.TryParse(parts[4], out var idle) &&
                    long.TryParse(parts[5], out var iowait) && long.TryParse(parts[6], out var irq) &&
                    long.TryParse(parts[7], out var softirq))
                {
                    var total = user + nice + sys + idle + iowait + irq + softirq;
                    var used = total - idle;
                    if (total > 0)
                        info.CpuUsagePercent = (int)Math.Round(used * 100.0 / total);
                }
            }
        }
        catch (Exception ex) { Console.WriteLine($"GetLinuxCpuUsage: {ex.Message}"); }
    }

    private static void GetLinuxMemoryInfo(SystemInfo info)
    {
        try
        {
            var meminfo = File.Exists("/proc/meminfo") ? File.ReadAllText("/proc/meminfo") : "";
            long totalKb = 0, availableKb = 0;
            foreach (var line in meminfo.Split('\n'))
            {
                var parts = line.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 2) continue;
                if (line.StartsWith("MemTotal:"))
                    long.TryParse(parts[1], out totalKb);
                else if (line.StartsWith("MemAvailable:"))
                    long.TryParse(parts[1], out availableKb);
                else if (line.StartsWith("MemFree:") && availableKb == 0)
                    long.TryParse(parts[1], out availableKb);
            }
            if (totalKb > 0)
            {
                info.TotalMemoryMB = totalKb / 1024;
                info.AvailableMemoryMB = availableKb > 0 ? availableKb / 1024 : totalKb / 1024;
                info.UsedMemoryMB = info.TotalMemoryMB - info.AvailableMemoryMB;
                info.MemoryUsagePercent = (int)Math.Round(info.UsedMemoryMB * 100.0 / info.TotalMemoryMB);
            }
        }
        catch (Exception ex) { Console.WriteLine($"GetLinuxMemoryInfo: {ex.Message}"); }
    }

    private static void GetLinuxGpuInfo(SystemInfo info)
    {
        var gpus = new List<GpuInfo>();
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "lspci",
                Arguments = "-v -nn",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            using var proc = Process.Start(psi);
            if (proc != null)
            {
                var output = proc.StandardOutput.ReadToEnd();
                proc.WaitForExit(3000);
                foreach (var line in output.Split('\n'))
                {
                    if (line.Contains("VGA", StringComparison.OrdinalIgnoreCase) || line.Contains("3D", StringComparison.OrdinalIgnoreCase))
                    {
                        var name = line.Trim();
                        if (name.Length > 0 && !gpus.Any(g => g.Name == name))
                            gpus.Add(new GpuInfo { Name = name, MemoryMB = 0 });
                    }
                }
            }
        }
        catch { }
        if (gpus.Count == 0)
        {
            try
            {
                var drm = new DirectoryInfo("/sys/class/drm");
                if (drm.Exists)
                {
                    foreach (var card in drm.GetDirectories().Where(d => d.Name.StartsWith("card", StringComparison.Ordinal)))
                    {
                        var nameFile = Path.Combine(card.FullName, "device", "product_name");
                        var name = File.Exists(nameFile) ? File.ReadAllText(nameFile).Trim() : card.Name;
                        if (!string.IsNullOrEmpty(name) && !gpus.Any(g => g.Name == name))
                            gpus.Add(new GpuInfo { Name = name, MemoryMB = 0 });
                    }
                }
            }
            catch { }
        }
        info.Gpus = gpus;
        TryGetNvidiaGpuStats(info.Gpus);
    }

    private static void GetLinuxDriveInfo(SystemInfo info)
    {
        var drives = new List<DriveInfoDto>();
        try
        {
            var mounts = File.Exists("/proc/mounts") ? File.ReadAllLines("/proc/mounts") : Array.Empty<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            foreach (var line in mounts)
            {
                var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length < 4) continue;
                var mountPoint = parts[1];
                var fstype = parts[2];
                if (mountPoint.StartsWith("/sys") || mountPoint.StartsWith("/proc") || mountPoint.StartsWith("/dev"))
                    continue;
                if (seen.Contains(mountPoint)) continue;
                seen.Add(mountPoint);
                try
                {
                    var (totalGb, freeGb) = GetLinuxDiskSpace(mountPoint);
                    if (totalGb <= 0) continue;
                    var usedGb = Math.Round(totalGb - freeGb, 1);
                    drives.Add(new DriveInfoDto
                    {
                        Name = mountPoint,
                        TotalGB = totalGb,
                        UsedGB = usedGb,
                        FreeGB = Math.Round(freeGb, 1),
                        UsagePercent = totalGb > 0 ? (int)Math.Round(usedGb / totalGb * 100) : 0,
                        DriveFormat = fstype
                    });
                }
                catch { }
            }
            info.Drives = drives;
        }
        catch (Exception ex) { Console.WriteLine($"GetLinuxDriveInfo: {ex.Message}"); }
    }

    private static (double totalGb, double freeGb) GetLinuxDiskSpace(string path)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "df",
                Arguments = $"-B1 --output=size,avail \"{path}\"",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            using var proc = Process.Start(psi);
            if (proc != null)
            {
                var output = proc.StandardOutput.ReadToEnd().Trim();
                proc.WaitForExit(2000);
                var lines = output.Split('\n');
                if (lines.Length >= 2)
                {
                    var parts = lines[1].Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length >= 2 && long.TryParse(parts[0], out var total) && long.TryParse(parts[1], out var avail))
                        return (total / 1024.0 / 1024.0 / 1024.0, avail / 1024.0 / 1024.0 / 1024.0);
                }
            }
        }
        catch { }
        return (0, 0);
    }

    private static void GetLinuxNetworkInfo(SystemInfo info)
    {
        var list = new List<NetworkAdapterInfo>();
        try
        {
            var net = new DirectoryInfo("/sys/class/net");
            if (!net.Exists) return;
            foreach (var dir in net.GetDirectories())
            {
                if (dir.Name == "lo") continue;
                var addrPath = Path.Combine(dir.FullName, "address");
                var addr = File.Exists(addrPath) ? File.ReadAllText(addrPath).Trim() : "";
                var speedPath = Path.Combine(dir.FullName, "speed");
                var speedMbps = 0L;
                if (File.Exists(speedPath) && int.TryParse(File.ReadAllText(speedPath).Trim(), out var sp))
                    speedMbps = sp;
                list.Add(new NetworkAdapterInfo { Name = dir.Name, SpeedMbps = speedMbps, MacAddress = addr });
            }
            info.NetworkAdapters = list;
        }
        catch (Exception ex) { Console.WriteLine($"GetLinuxNetworkInfo: {ex.Message}"); }
    }

    private static void GetLinuxCpuTemperature(SystemInfo info)
    {
        try
        {
            var thermal = new DirectoryInfo("/sys/class/thermal");
            if (!thermal.Exists) return;
            foreach (var zone in thermal.GetDirectories().Where(d => d.Name.StartsWith("thermal_zone")))
            {
                var tempPath = Path.Combine(zone.FullName, "temp");
                if (!File.Exists(tempPath)) continue;
                var raw = File.ReadAllText(tempPath).Trim();
                if (int.TryParse(raw, out var millideg) && millideg > 0 && millideg < 150000)
                {
                    info.CpuTemperature = Math.Round(millideg / 1000.0, 1);
                    break;
                }
            }
        }
        catch { }
    }

    /// <summary>
    /// 尝试通过 nvidia-smi 获取 NVIDIA GPU 温度和占用率
    /// </summary>
    private static void TryGetNvidiaGpuStats(List<GpuInfo> gpus)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "nvidia-smi",
                Arguments = "--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits",
                RedirectStandardOutput = true,
                UseShellExecute = false,
                CreateNoWindow = true
            };

            using var proc = Process.Start(psi);
            if (proc == null) return;

            var output = proc.StandardOutput.ReadToEnd();
            proc.WaitForExit(3000);

            var lines = output.Trim().Split('\n', StringSplitOptions.RemoveEmptyEntries);
            foreach (var line in lines)
            {
                var parts = line.Split(',', StringSplitOptions.TrimEntries);
                if (parts.Length < 5) continue;

                var nvidiaName = parts[0];
                // 匹配到对应的 GPU
                var matchedGpu = gpus.FirstOrDefault(g =>
                    g.Name.Contains("NVIDIA", StringComparison.OrdinalIgnoreCase) &&
                    (g.Name.Contains(nvidiaName, StringComparison.OrdinalIgnoreCase) ||
                     nvidiaName.Contains(g.Name.Replace("NVIDIA ", ""), StringComparison.OrdinalIgnoreCase)));

                if (matchedGpu == null && gpus.Any(g => g.Name.Contains("NVIDIA", StringComparison.OrdinalIgnoreCase)))
                {
                    matchedGpu = gpus.First(g => g.Name.Contains("NVIDIA", StringComparison.OrdinalIgnoreCase));
                }

                if (matchedGpu != null)
                {
                    if (int.TryParse(parts[1], out var temp)) matchedGpu.Temperature = temp;
                    if (int.TryParse(parts[2], out var usage)) matchedGpu.UsagePercent = usage;
                    if (long.TryParse(parts[3], out var memUsed)) matchedGpu.MemoryUsedMB = memUsed;
                    if (long.TryParse(parts[4], out var memTotal) && memTotal > 0) matchedGpu.MemoryMB = memTotal;
                }
            }
        }
        catch
        {
            // nvidia-smi 不可用（非 NVIDIA GPU 或未安装驱动）
        }
    }
}

/// <summary>
/// 进程信息
/// </summary>
public class ProcessInfo
{
    /// <summary>进程 ID</summary>
    public int Id { get; set; }

    /// <summary>进程名称</summary>
    public string Name { get; set; } = "";

    /// <summary>内存占用 (MB)</summary>
    public double MemoryMB { get; set; }

    /// <summary>线程数</summary>
    public int Threads { get; set; }

    /// <summary>启动时间</summary>
    public string StartTime { get; set; } = "";


    /// <summary>是否有主窗口</summary>
    public bool HasWindow { get; set; }

    /// <summary>主窗口标题</summary>
    public string WindowTitle { get; set; } = "";

    /// <summary>文件描述（产品名称或文件说明）</summary>
    public string Description { get; set; } = "";

    /// <summary>进程文件路径</summary>
    public string FilePath { get; set; } = "";

    /// <summary>CPU 使用百分比</summary>
    public double CpuPercent { get; set; }
}

/// <summary>
/// 系统信息
/// </summary>
public class SystemInfo
{
    /// <summary>运行平台，如 Windows / Linux，供前端区分功能</summary>
    public string Platform { get; set; } = "";

    // 基本信息
    public string MachineName { get; set; } = "";
    public string UserName { get; set; } = "";
    public string OSVersion { get; set; } = "";
    public int ProcessorCount { get; set; }
    public bool Is64Bit { get; set; }
    public string SystemDirectory { get; set; } = "";
    public string UpTime { get; set; } = "";

    // CPU 信息
    public string CpuName { get; set; } = "";
    public int CpuCores { get; set; }
    public int CpuLogicalProcessors { get; set; }
    public int CpuMaxClockSpeedMHz { get; set; }
    public int CpuUsagePercent { get; set; }
    public double CpuTemperature { get; set; } = -1;

    // GPU 信息
    public List<GpuInfo> Gpus { get; set; } = new();

    // 内存信息
    public long TotalMemoryMB { get; set; }
    public long UsedMemoryMB { get; set; }
    public long AvailableMemoryMB { get; set; }
    public int MemoryUsagePercent { get; set; }

    // 磁盘信息
    public List<DriveInfoDto> Drives { get; set; } = new();

    // 网络适配器
    public List<NetworkAdapterInfo> NetworkAdapters { get; set; } = new();
}

/// <summary>
/// GPU 信息
/// </summary>
public class GpuInfo
{
    public string Name { get; set; } = "";
    public long MemoryMB { get; set; }
    public long MemoryUsedMB { get; set; }
    public string DriverVersion { get; set; } = "";
    public int Temperature { get; set; } = -1;
    public int UsagePercent { get; set; } = -1;
}

/// <summary>
/// 磁盘信息
/// </summary>
public class DriveInfoDto
{
    public string Name { get; set; } = "";
    public double TotalGB { get; set; }
    public double UsedGB { get; set; }
    public double FreeGB { get; set; }
    public int UsagePercent { get; set; }
    public string DriveFormat { get; set; } = "";
}

/// <summary>
/// 网络适配器信息
/// </summary>
public class NetworkAdapterInfo
{
    public string Name { get; set; } = "";
    public long SpeedMbps { get; set; }
    public string MacAddress { get; set; } = "";
}
