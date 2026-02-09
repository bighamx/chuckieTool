using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using Microsoft.Win32;

namespace ChuckieHelper.WebApi.Services.RemoteControl;

public enum TerminalType
{
    PowerShell,
    Cmd
}

public class TerminalService
{
    private readonly Dictionary<string, TerminalSession> _sessions = new();

    public async Task HandleWebSocketAsync(WebSocket webSocket, TerminalType terminalType = TerminalType.PowerShell)
    {
        var sessionId = Guid.NewGuid().ToString();
        var session = new TerminalSession(webSocket, terminalType);
        _sessions[sessionId] = session;

        try
        {
            await session.StartAsync();
            await session.ReceiveLoopAsync();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Terminal session error: {ex.Message}");
        }
        finally
        {
            session.Dispose();
            _sessions.Remove(sessionId);
        }
    }
}

public class TerminalSession : IDisposable
{
    private readonly WebSocket _webSocket;
    private readonly TerminalType _terminalType;
    private Process? _process;
    private bool _disposed;
    private readonly bool _useUtf8;  // 是否使用 UTF-8 编码

    public TerminalSession(WebSocket webSocket, TerminalType terminalType)
    {
        _webSocket = webSocket;
        _terminalType = terminalType;
        _useUtf8 = IsSystemUtf8Enabled();
    }

    /// <summary>
    /// 检测系统是否启用了 "Beta版: 使用 Unicode UTF-8 提供全球语言支持"
    /// </summary>
    private static bool IsSystemUtf8Enabled()
    {
        try
        {
            // 检查注册表：HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\Nls\CodePage
            // ACP = 65001 表示启用了 UTF-8 全局支持
            using var key = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Nls\CodePage");
            if (key != null)
            {
                var acp = key.GetValue("ACP") as string;
                return acp == "65001";
            }
        }
        catch
        {
            // 无法读取注册表，默认使用 GBK
        }
        return false;
    }

    public async Task StartAsync()
    {
        _process = new Process
        {
            StartInfo = CreateStartInfo(),
            EnableRaisingEvents = true
        };

        _process.Exited += async (sender, e) =>
        {
            await SendMessageAsync("\r\n[Process exited]\r\n");
        };

        _process.Start();

        // 统一初始设置
        if (_terminalType == TerminalType.PowerShell)
        {
            // PowerShell: 使用 GBK 编码以匹配中文输出
            await _process.StandardInput.WriteLineAsync("[Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding(936)");
            await _process.StandardInput.WriteLineAsync("[Console]::InputEncoding = [System.Text.Encoding]::GetEncoding(936)");
            await _process.StandardInput.WriteLineAsync("$OutputEncoding = [System.Text.Encoding]::GetEncoding(936)");
            await _process.StandardInput.WriteLineAsync("cls");
        }
        else
        {
            // CMD 模式：根据系统设置选择代码页
            if (_useUtf8)
            {
                // 系统已启用 UTF-8 全局支持，使用 65001
                await _process.StandardInput.WriteLineAsync("chcp 65001 > nul");
            }
            else
            {
                // 传统中文系统，使用 GBK (936)
                await _process.StandardInput.WriteLineAsync("chcp 936 > nul");
            }
            await _process.StandardInput.FlushAsync();
            await Task.Delay(100);
            await _process.StandardInput.WriteLineAsync("cls");
            await _process.StandardInput.FlushAsync();
        }

        // Start background tasks to read output streams
        _ = ReadStreamAsync(_process.StandardOutput);
        _ = ReadStreamAsync(_process.StandardError);
    }

    private ProcessStartInfo CreateStartInfo()
    {
        var startInfo = new ProcessStartInfo
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
        };

        if (_terminalType == TerminalType.PowerShell)
        {
            var gbkEncoding = Encoding.GetEncoding("GBK");
            startInfo.FileName = "powershell.exe";
            startInfo.Arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass";
            startInfo.StandardInputEncoding = gbkEncoding;
            startInfo.StandardOutputEncoding = gbkEncoding;
            startInfo.StandardErrorEncoding = gbkEncoding;
        }
        else // CMD
        {
            startInfo.FileName = "cmd.exe";
            startInfo.Arguments = "/Q"; // /Q 关闭回显

            if (_useUtf8)
            {
                // 系统已启用 UTF-8 全局支持
                var utf8NoBom = new UTF8Encoding(false);
                startInfo.StandardInputEncoding = utf8NoBom;
                startInfo.StandardOutputEncoding = utf8NoBom;
                startInfo.StandardErrorEncoding = utf8NoBom;
            }
            else
            {
                // 传统中文系统，使用 GBK (936) 编码
                var gbkEncoding = Encoding.GetEncoding("GBK");
                startInfo.StandardInputEncoding = gbkEncoding;
                startInfo.StandardOutputEncoding = gbkEncoding;
                startInfo.StandardErrorEncoding = gbkEncoding;
            }
        }

        return startInfo;
    }

    private async Task ReadStreamAsync(StreamReader reader)
    {
        try
        {
            while (!_disposed && _process != null && !_process.HasExited)
            {
                var line = await reader.ReadLineAsync();
                if (line == null) break;

                await SendMessageAsync(line + "\r\n");
            }
        }
        catch (Exception)
        {
            // Stream closed or process exited
        }
    }

    public async Task ReceiveLoopAsync()
    {
        var buffer = new byte[4096];

        while (_webSocket.State == WebSocketState.Open && !_disposed)
        {
            try
            {
                var result = await _webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);

                if (result.MessageType == WebSocketMessageType.Close)
                {
                    await _webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
                    break;
                }

                if (result.MessageType == WebSocketMessageType.Text && _process != null && !_process.HasExited)
                {
                    var command = Encoding.UTF8.GetString(buffer, 0, result.Count);

                    if (_terminalType == TerminalType.Cmd && !_useUtf8)
                    {
                        // 传统中文系统 CMD：需要将 UTF-8 字符串转换为 GBK 字节写入
                        var gbkEncoding = Encoding.GetEncoding("GBK");
                        var gbkBytes = gbkEncoding.GetBytes(command + "\r\n");
                        await _process.StandardInput.BaseStream.WriteAsync(gbkBytes, 0, gbkBytes.Length);
                        await _process.StandardInput.BaseStream.FlushAsync();
                    }
                    else if (_terminalType == TerminalType.PowerShell)
                    {
                        // PowerShell：按 GBK 写入
                        var gbkEncoding = Encoding.GetEncoding("GBK");
                        var gbkBytes = gbkEncoding.GetBytes(command + "\r\n");
                        await _process.StandardInput.BaseStream.WriteAsync(gbkBytes, 0, gbkBytes.Length);
                        await _process.StandardInput.BaseStream.FlushAsync();
                    }
                    else
                    {
                        await _process.StandardInput.WriteLineAsync(command);
                        await _process.StandardInput.FlushAsync();
                    }
                }
            }
            catch (WebSocketException)
            {
                break;
            }
        }
    }

    private async Task SendMessageAsync(string message)
    {
        if (_webSocket.State == WebSocketState.Open)
        {
            try
            {
                var bytes = Encoding.UTF8.GetBytes(message);
                await _webSocket.SendAsync(new ArraySegment<byte>(bytes), WebSocketMessageType.Text, true, CancellationToken.None);
            }
            catch (WebSocketException)
            {
                // Connection closed
            }
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;

        try
        {
            if (_process != null && !_process.HasExited)
            {
                _process.Kill(true);
            }
            _process?.Dispose();
        }
        catch { }
    }
}
