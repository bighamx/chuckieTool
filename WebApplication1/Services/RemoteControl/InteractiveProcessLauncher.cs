using System.Diagnostics;
using System.Runtime.InteropServices;

namespace ChuckieHelper.WebApi.Services.RemoteControl;

/// <summary>
/// 提供在交互式桌面会话中启动进程的能力，用于绕过 IIS/Windows Service 的 Session 0 隔离。
/// 要求应用程序池以 LocalSystem 身份运行。
/// </summary>
public static class InteractiveProcessLauncher
{
    #region Win32 API 声明

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentProcessId();

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool ProcessIdToSessionId(uint dwProcessId, out uint pSessionId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WTSGetActiveConsoleSessionId();

    [DllImport("wtsapi32.dll", SetLastError = true)]
    private static extern bool WTSQueryUserToken(uint sessionId, out IntPtr phToken);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    private static extern bool DuplicateTokenEx(
        IntPtr hExistingToken,
        uint dwDesiredAccess,
        IntPtr lpTokenAttributes,
        int impersonationLevel,
        int tokenType,
        out IntPtr phNewToken);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcessAsUser(
        IntPtr hToken,
        string? lpApplicationName,
        string lpCommandLine,
        IntPtr lpProcessAttributes,
        IntPtr lpThreadAttributes,
        bool bInheritHandles,
        uint dwCreationFlags,
        IntPtr lpEnvironment,
        string? lpCurrentDirectory,
        ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("userenv.dll", SetLastError = true)]
    private static extern bool CreateEnvironmentBlock(out IntPtr lpEnvironment, IntPtr hToken, bool bInherit);

    [DllImport("userenv.dll", SetLastError = true)]
    private static extern bool DestroyEnvironmentBlock(IntPtr lpEnvironment);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint processAccess, bool bInheritHandle, int processId);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr processHandle, uint desiredAccess, out IntPtr tokenHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr tokenHandle, int tokenInformationClass,
        IntPtr tokenInformation, uint tokenInformationLength, out uint returnLength);

    [DllImport("advapi32.dll")]
    private static extern IntPtr GetSidSubAuthority(IntPtr pSid, uint n);

    [DllImport("advapi32.dll")]
    private static extern IntPtr GetSidSubAuthorityCount(IntPtr pSid);

    private const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
    private const uint TOKEN_QUERY = 0x0008;
    private const uint TOKEN_DUPLICATE = 0x0002;
    private const int TokenIntegrityLevel = 25;
    private const uint SECURITY_MANDATORY_HIGH_RID = 0x3000;

    [StructLayout(LayoutKind.Sequential)]
    private struct SID_AND_ATTRIBUTES
    {
        public IntPtr Sid;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TOKEN_MANDATORY_LABEL
    {
        public SID_AND_ATTRIBUTES Label;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }

    private const uint TOKEN_ALL_ACCESS = 0x000F01FF;
    private const int SecurityImpersonation = 2;
    private const int TokenPrimary = 1;
    private const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint CREATE_NEW_CONSOLE = 0x00000010;

    #endregion

    private static bool? _isSession0;
    private static readonly object _lock = new();

    /// <summary>
    /// 在指定会话中查找高完整性进程并复制其主令牌，用于以“管理员身份”创建子进程。调用方须 CloseHandle 返回的令牌。
    /// 若该会话中没有任何以管理员运行的进程（如未打开过任务管理器），则返回 IntPtr.Zero。
    /// </summary>
    private static IntPtr TryGetElevatedTokenForSession(uint targetSessionId)
    {
        const uint TOKEN_QUERY_DUPLICATE = TOKEN_QUERY | TOKEN_DUPLICATE;
        foreach (var proc in Process.GetProcesses())
        {
            IntPtr hProcess = IntPtr.Zero;
            IntPtr hToken = IntPtr.Zero;
            try
            {
                if (!ProcessIdToSessionId((uint)proc.Id, out uint sid) || sid != targetSessionId)
                    continue;

                hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, proc.Id);
                if (hProcess == IntPtr.Zero)
                    continue;

                if (!OpenProcessToken(hProcess, TOKEN_QUERY_DUPLICATE, out hToken) || hToken == IntPtr.Zero)
                    continue;

                uint len = 0;
                GetTokenInformation(hToken, TokenIntegrityLevel, IntPtr.Zero, 0, out _);
                len = 256;
                var buf = Marshal.AllocHGlobal((int)len);
                try
                {
                    if (!GetTokenInformation(hToken, TokenIntegrityLevel, buf, len, out len))
                        continue;

                    var label = Marshal.PtrToStructure<TOKEN_MANDATORY_LABEL>(buf);
                    IntPtr pSid = label.Label.Sid;
                    if (pSid == IntPtr.Zero)
                        continue;

                    int count = Marshal.ReadByte(GetSidSubAuthorityCount(pSid));
                    if (count <= 0)
                        continue;

                    int level = Marshal.ReadInt32(GetSidSubAuthority(pSid, (uint)(count - 1)));
                    if (level < SECURITY_MANDATORY_HIGH_RID)
                        continue;

                    if (!DuplicateTokenEx(hToken, TOKEN_ALL_ACCESS, IntPtr.Zero, SecurityImpersonation, TokenPrimary, out IntPtr dupToken))
                        continue;

                    return dupToken;
                }
                finally
                {
                    Marshal.FreeHGlobal(buf);
                }
            }
            finally
            {
                if (hToken != IntPtr.Zero) CloseHandle(hToken);
                if (hProcess != IntPtr.Zero) CloseHandle(hProcess);
                proc.Dispose();
            }
        }

        return IntPtr.Zero;
    }

    /// <summary>
    /// 判断当前进程是否运行在 Session 0（非交互式会话，如 IIS / Windows Service）
    /// </summary>
    public static bool IsRunningInSession0
    {
        get
        {
            if (_isSession0.HasValue) return _isSession0.Value;
            lock (_lock)
            {
                if (_isSession0.HasValue) return _isSession0.Value;
                if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                {
                    _isSession0 = false;
                    return false;
                }
                if (ProcessIdToSessionId(GetCurrentProcessId(), out uint sessionId))
                {
                    _isSession0 = sessionId == 0;
                    Console.WriteLine($"[InteractiveProcessLauncher] 当前会话 ID: {sessionId}, 是否 Session 0: {_isSession0}");
                }
                else
                {
                    _isSession0 = false;
                }
                return _isSession0.Value;
            }
        }
    }

    /// <summary>
    /// 在交互式桌面会话中启动进程。成功时返回 (true, processId)，失败返回 (false, 0)。
    /// 要求调用进程以 LocalSystem 身份运行（IIS 应用程序池需配置为 LocalSystem）。
    /// 当 useElevatedTokenIfAvailable 为 true 时，采用两种方式争取以管理员身份启动（可同时保留）：
    /// 1）优先在本会话中查找已存在的高完整性进程并复制其令牌（无需密码，仅当用户曾以管理员运行过某进程时有效）；
    /// 2）若配置了 RemoteControl:ElevatedAgent 凭据，应用启动时会创建“登录时以最高权限运行”的计划任务，用户注销并重新登录后代理将以管理员身份启动。
    /// 若未取得高完整性令牌则回退到普通用户令牌启动。
    /// </summary>
    /// <param name="useElevatedTokenIfAvailable">为 true 时先尝试用本会话内高完整性令牌启动，若无则用普通用户令牌。</param>
    public static (bool Success, int ProcessId) LaunchInInteractiveSession(string commandLine, string? workingDirectory = null, bool useElevatedTokenIfAvailable = false)
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            Console.WriteLine("[InteractiveProcessLauncher] 仅支持 Windows 平台");
            return (false, 0);
        }

        var sessionId = WTSGetActiveConsoleSessionId();
        if (sessionId == 0xFFFFFFFF)
        {
            Console.WriteLine("[InteractiveProcessLauncher] 无法获取活动控制台会话 ID（可能没有用户登录）");
            return (false, 0);
        }

        Console.WriteLine($"[InteractiveProcessLauncher] 目标会话 ID: {sessionId}");

        IntPtr userToken = IntPtr.Zero;
        IntPtr duplicateToken = IntPtr.Zero;
        IntPtr environment = IntPtr.Zero;

        try
        {
            if (useElevatedTokenIfAvailable)
            {
                userToken = TryGetElevatedTokenForSession(sessionId);
                if (userToken != IntPtr.Zero)
                    Console.WriteLine("[InteractiveProcessLauncher] 使用该会话中的高完整性令牌（管理员身份）启动");
                else
                    Console.WriteLine("[InteractiveProcessLauncher] 未找到高完整性进程令牌，将使用普通用户令牌；可配置 RemoteControl:ElevatedAgent 凭据并在登录时以管理员运行");
            }

            if (userToken == IntPtr.Zero)
            {
                if (!WTSQueryUserToken(sessionId, out userToken))
                {
                    var error = Marshal.GetLastWin32Error();
                    Console.WriteLine($"[InteractiveProcessLauncher] WTSQueryUserToken 失败，错误码: {error}。" +
                        "请确保 IIS 应用程序池以 LocalSystem 身份运行。");
                    return (false, 0);
                }
            }

            if (!DuplicateTokenEx(userToken, TOKEN_ALL_ACCESS, IntPtr.Zero,
                SecurityImpersonation, TokenPrimary, out duplicateToken))
            {
                var error = Marshal.GetLastWin32Error();
                Console.WriteLine($"[InteractiveProcessLauncher] DuplicateTokenEx 失败，错误码: {error}");
                return (false, 0);
            }

            if (!CreateEnvironmentBlock(out environment, duplicateToken, false))
                environment = IntPtr.Zero;

            var si = new STARTUPINFO();
            si.cb = Marshal.SizeOf(si);
            si.lpDesktop = @"winsta0\default"; // 指向交互式桌面

            var creationFlags = CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW;

            if (!CreateProcessAsUser(duplicateToken, null, commandLine,
                IntPtr.Zero, IntPtr.Zero, false, creationFlags,
                environment, workingDirectory, ref si, out var pi))
            {
                var error = Marshal.GetLastWin32Error();
                Console.WriteLine($"[InteractiveProcessLauncher] CreateProcessAsUser 失败，错误码: {error}");
                return (false, 0);
            }

            var processId = pi.dwProcessId;
            CloseHandle(pi.hProcess);
            CloseHandle(pi.hThread);

            Console.WriteLine($"[InteractiveProcessLauncher] 成功在会话 {sessionId} 中启动进程 (PID: {processId}): {commandLine}");
            return (true, processId);
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[InteractiveProcessLauncher] 异常: {ex.Message}");
            return (false, 0);
        }
        finally
        {
            if (environment != IntPtr.Zero) DestroyEnvironmentBlock(environment);
            if (duplicateToken != IntPtr.Zero) CloseHandle(duplicateToken);
            if (userToken != IntPtr.Zero) CloseHandle(userToken);
        }
    }

    /// <summary>
    /// 获取当前应用程序 DLL 的完整路径（用于启动桌面代理）。
    /// 使用 AppContext.BaseDirectory 而非 Assembly.Location，
    /// 以避免 IIS 影子复制（Shadow Copy）导致路径指向临时目录。
    /// </summary>
    public static string GetApplicationDllPath()
    {
        var baseDir = AppContext.BaseDirectory;
        var assemblyName = typeof(InteractiveProcessLauncher).Assembly.GetName().Name + ".dll";
        var dllPath = Path.Combine(baseDir, assemblyName);

        // 验证路径存在
        if (File.Exists(dllPath))
        {
            Console.WriteLine($"[InteractiveProcessLauncher] 应用 DLL 路径: {dllPath}");
            return dllPath;
        }

        // 回退到 Assembly.Location
        var fallback = typeof(InteractiveProcessLauncher).Assembly.Location;
        Console.WriteLine($"[InteractiveProcessLauncher] 回退 DLL 路径: {fallback}");
        return fallback;
    }

    /// <summary>
    /// 获取 dotnet 可执行文件的路径
    /// </summary>
    public static string GetDotnetPath()
    {
        // 优先使用环境变量
        var dotnetPath = Environment.GetEnvironmentVariable("DOTNET_HOST_PATH");
        if (!string.IsNullOrEmpty(dotnetPath) && File.Exists(dotnetPath))
            return dotnetPath;

        // 常见安装路径
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var defaultPath = Path.Combine(programFiles, "dotnet", "dotnet.exe");
        if (File.Exists(defaultPath))
            return defaultPath;

        // 回退到 PATH 中的 dotnet
        return "dotnet";
    }

    /// <summary>
    /// 计划任务名称：登录时以最高权限启动桌面代理（需配置管理员凭据）。
    /// </summary>
    public const string ElevatedAgentTaskName = "ChuckieHelper_DesktopAgent_Elevated";

    /// <summary>
    /// 使用管理员凭据创建“登录时以最高权限运行”的计划任务，使桌面代理在用户下次登录时以管理员身份自动启动。
    /// 调用方须以 LocalSystem 运行；创建后用户需注销并重新登录一次方可生效。
    /// </summary>
    /// <param name="userName">管理员用户名（可为 .\用户名 或 域\用户名）</param>
    /// <param name="password">管理员密码</param>
    /// <param name="domain">域（本地账户可传 null 或空）</param>
    /// <returns>创建成功返回 true</returns>
    public static bool CreateElevatedAgentLogonTask(string userName, string password, string? domain)
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows) || string.IsNullOrWhiteSpace(userName) || string.IsNullOrWhiteSpace(password))
        {
            Console.WriteLine("[InteractiveProcessLauncher] 创建高权限代理任务：需要 Windows 且提供用户名和密码");
            return false;
        }

        var dotnetPath = GetDotnetPath();
        var dllPath = GetApplicationDllPath();
        var cmd = $"\"{dotnetPath}\" \"{dllPath}\" --desktop-agent";
        var ru = string.IsNullOrWhiteSpace(domain) ? userName : $"{domain}\\{userName}";

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "schtasks",
                ArgumentList =
                {
                    "/create",
                    "/tn", ElevatedAgentTaskName,
                    "/tr", cmd,
                    "/sc", "onlogon",
                    "/ru", ru,
                    "/rp", password,
                    "/rl", "HIGHEST",
                    "/f"
                },
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            };

            using var p = Process.Start(psi);
            if (p == null)
            {
                Console.WriteLine("[InteractiveProcessLauncher] schtasks 启动失败");
                return false;
            }

            var outText = p.StandardOutput.ReadToEnd();
            var errText = p.StandardError.ReadToEnd();
            p.WaitForExit(15000);

            if (p.ExitCode == 0)
            {
                Console.WriteLine($"[InteractiveProcessLauncher] 已创建登录时高权限代理任务: {ElevatedAgentTaskName}。请注销并重新登录一次使代理以管理员身份运行。");
                return true;
            }

            Console.WriteLine($"[InteractiveProcessLauncher] schtasks /create 失败，退出码: {p.ExitCode}, 错误: {errText?.Trim()}");
            return false;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[InteractiveProcessLauncher] 创建高权限代理任务异常: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// 立即运行已创建的高权限代理计划任务（若存在）。任务由服务触发时可能在 Session 0 运行，若需在交互会话中高权限运行请依赖“登录时”触发。
    /// </summary>
    /// <returns>已发起运行返回 true</returns>
    public static bool RunElevatedAgentTaskNow()
    {
        if (!RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            return false;

        try
        {
            using var p = Process.Start(new ProcessStartInfo
            {
                FileName = "schtasks",
                ArgumentList = { "/run", "/tn", ElevatedAgentTaskName },
                UseShellExecute = false,
                CreateNoWindow = true
            });
            if (p != null)
            {
                p.WaitForExit(5000);
                if (p.ExitCode == 0)
                {
                    Console.WriteLine("[InteractiveProcessLauncher] 已触发高权限代理任务运行");
                    return true;
                }
            }
        }
        catch (Exception ex)
        {
            Console.WriteLine($"[InteractiveProcessLauncher] 运行高权限任务失败: {ex.Message}");
        }

        return false;
    }
}
