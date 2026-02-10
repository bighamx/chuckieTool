
using ChuckieHelper.WebApi.Models;
using Hangfire;
using Hangfire.Storage.SQLite;
using ChuckieHelper.WebApi.Jobs;
using Hangfire.Console; // 添加 Logs 支持
using ChuckieHelper.WebApi.Services.RemoteControl;
using ChuckieHelper.WebApi.Services; // Add global services namespace
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
using System.Text;


namespace WebApplication1
{
    public class Program
    {
        public static async Task Main(string[] args)
        {
            // 桌面代理模式：当以 --desktop-agent 参数启动时，
            // 不启动 Web 服务器，而是运行命名管道服务器处理桌面操作。
            // 此模式由 IIS 进程在检测到 Session 0 时自动启动。
            if (args.Contains("--desktop-agent"))
            {
                Console.WriteLine("[DesktopAgent] 以桌面代理模式启动");
                Console.WriteLine($"[DesktopAgent] 进程 ID: {Environment.ProcessId}");
                Console.WriteLine($"[DesktopAgent] 用户: {Environment.UserName}");

                using var cts = new CancellationTokenSource();
                Console.CancelKeyPress += (_, e) =>
                {
                    e.Cancel = true;
                    cts.Cancel();
                };

                try
                {
                    await DesktopAgent.RunServerAsync(cts.Token);
                }
                catch (OperationCanceledException)
                {
                    Console.WriteLine("[DesktopAgent] 代理已停止");
                }
                return;
            }

            var builder = WebApplication.CreateBuilder(args);

            // Add services to the container.
            builder.Services.AddControllersWithViews().AddRazorRuntimeCompilation();

            // 注册编码提供程序以支持 GBK (需 NuGet 安装 System.Text.Encoding.CodePages)
            System.Text.Encoding.RegisterProvider(System.Text.CodePagesEncodingProvider.Instance);

            // Remote Control Services
            builder.Services.AddSingleton<AuthService>();
            builder.Services.AddSingleton<SystemService>();
            builder.Services.AddSingleton<TerminalService>();
            builder.Services.AddSingleton<DockerService>();
            builder.Services.AddSingleton<FileService>();

            // Configure JWT Authentication
            var jwtSecret = builder.Configuration["Auth:JwtSecret"] ?? "DefaultSecretKey123456789012345678901234";
            var key = Encoding.UTF8.GetBytes(jwtSecret);

            builder.Services.AddAuthentication(options =>
            {
                options.DefaultAuthenticateScheme = JwtBearerDefaults.AuthenticationScheme;
                options.DefaultChallengeScheme = JwtBearerDefaults.AuthenticationScheme;
            })
            .AddJwtBearer(options =>
            {
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidateIssuer = false,
                    ValidateAudience = false,
                    ValidateLifetime = true,
                    ValidateIssuerSigningKey = true,
                    IssuerSigningKey = new SymmetricSecurityKey(key)
                };

                // Allow token from query string for WebSocket and Stream endpoints
                options.Events = new JwtBearerEvents
                {
                    OnMessageReceived = context =>
                    {
                        var accessToken = context.Request.Query["access_token"];

                        // Also check for cookie
                        if (string.IsNullOrEmpty(accessToken))
                        {
                            if (context.Request.Cookies.TryGetValue("access_token", out var cookieToken))
                            {
                                accessToken = cookieToken;
                            }
                        }

                        var path = context.HttpContext.Request.Path;
                        if (!string.IsNullOrEmpty(accessToken))
                        {
                            context.Token = accessToken;
                        }
                        return Task.CompletedTask;
                    },
                    OnChallenge = context =>
                    {
                        // Check if it's a browser request (not an API call) or Hangfire Dashboard
                        if (!context.Response.HasStarted && (context.Request.Path.StartsWithSegments("/api") == false || context.Request.Path.StartsWithSegments("/hangfire")))
                        {
                            context.HandleResponse(); // Suppress the default 401 response
                            context.Response.Redirect("/Account/Login?ReturnUrl=" + System.Net.WebUtility.UrlEncode(context.Request.Path + context.Request.QueryString));
                        }
                        return Task.CompletedTask;
                    }
                };
            });




            // Hangfire Client
            builder.Services.AddHangfire(configuration => configuration
                .SetDataCompatibilityLevel(Hangfire.CompatibilityLevel.Version_180)
                .UseSimpleAssemblyNameTypeSerializer()
                .UseRecommendedSerializerSettings()
                .UseConsole() // 添加 Hangfire.Console 支持
                .UseSQLiteStorage("hangfire.db"));

            // Hangfire Server
            builder.Services.AddHangfireServer();
            builder.Services.AddExampleTask();
            builder.Services.AddQBittorrentTask();
            builder.Services.AddDdnsTask();

            var app = builder.Build();

            // 若在 Session 0（IIS）且配置了管理员凭据，创建“登录时以最高权限运行桌面代理”的计划任务（密码可来自配置或环境变量 REMOTECONTROL_ELEVATEDAGENT_PASSWORD）
            if (InteractiveProcessLauncher.IsRunningInSession0)
            {
                var elevatedUser = app.Configuration["RemoteControl:ElevatedAgent:UserName"]?.Trim();
                var elevatedPass = app.Configuration["RemoteControl:ElevatedAgent:Password"]
                    ?? Environment.GetEnvironmentVariable("REMOTECONTROL_ELEVATEDAGENT_PASSWORD");
                var elevatedDomain = app.Configuration["RemoteControl:ElevatedAgent:Domain"]?.Trim();
                if (!string.IsNullOrEmpty(elevatedUser) && !string.IsNullOrEmpty(elevatedPass))
                {
                    InteractiveProcessLauncher.CreateElevatedAgentLogonTask(elevatedUser, elevatedPass, string.IsNullOrEmpty(elevatedDomain) ? null : elevatedDomain);
                }
            }

            // Configure the HTTP request pipeline.
            if (!app.Environment.IsDevelopment())
            {
                app.UseExceptionHandler("/Home/Error");
            }
            app.UseStaticFiles();

            app.UseRouting();

            app.UseWebSockets();
            app.UseAuthentication();
            app.UseAuthorization();


            // Custom Middleware to intercept Hangfire 401 and redirect to Login
            app.Use(async (context, next) =>
            {
                await next();

                if (context.Response.StatusCode == 401 && context.Request.Path.StartsWithSegments("/hangfire"))
                {
                    context.Response.Redirect("/Account/Login?ReturnUrl=" + System.Net.WebUtility.UrlEncode(context.Request.Path + context.Request.QueryString));
                }
            });

            // Hangfire Dashboard
            app.UseHangfireDashboard("/hangfire", new DashboardOptions
            {
                Authorization = new[] { new ChuckieHelper.WebApi.Filters.HangfireAuthorizationFilter() }
            });

            // 按实例名称注册 Hangfire 定时任务：Office 仅 DDNS，Home 注册全部
            var instanceName = (app.Configuration["InstanceName"] ?? "Home").Trim();
            if (string.Equals(instanceName, "Office", StringComparison.OrdinalIgnoreCase))
            {
                app.UseHangfireDdnsTask();
            }
            else
            {
                app.UseHangfireExampleTask();
                app.UseHangfireQBittorrentTask();
                app.UseHangfireDdnsTask();
            }

            app.MapControllerRoute(
                name: "default",
                pattern: "{controller=Home}/{action=Index}/{id?}");

            // WebSocket endpoint for terminal
            app.Map("/ws/terminal", async context =>
            {
                if (!context.WebSockets.IsWebSocketRequest)
                {
                    context.Response.StatusCode = 400;
                    return;
                }

                // 从查询参数获取终端类型
                var typeParam = context.Request.Query["type"].ToString().ToLower();
                var terminalType = typeParam == "cmd" ? TerminalType.Cmd : TerminalType.PowerShell;

                var terminalService = context.RequestServices.GetRequiredService<TerminalService>();
                var webSocket = await context.WebSockets.AcceptWebSocketAsync();
                await terminalService.HandleWebSocketAsync(webSocket, terminalType);
            });

            // WebSocket 端点：远程控制键鼠，建立后持续接收 JSON 命令，避免每个操作一次 HTTP 请求
            app.Map("/ws/input", async context =>
            {
                if (!context.WebSockets.IsWebSocketRequest)
                {
                    context.Response.StatusCode = 400;
                    return;
                }

                var token = context.Request.Query["access_token"].ToString();
                var authService = context.RequestServices.GetRequiredService<AuthService>();
                if (string.IsNullOrEmpty(token) || !authService.ValidateToken(token))
                {
                    context.Response.StatusCode = 401;
                    return;
                }

                var systemService = context.RequestServices.GetRequiredService<SystemService>();
                var webSocket = await context.WebSockets.AcceptWebSocketAsync();
                await InputWebSocketHandler.RunAsync(webSocket, systemService, context.RequestAborted);
            });

            app.Run();
        }
    }
}
