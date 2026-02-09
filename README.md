## ChuckieHelper WebApi 项目说明与部署文档

### 项目作用与整体原理

`ChuckieHelper WebApi` 是一个基于 **.NET 8** 的 Web 后台管理与远程控制服务，主要功能包括：

- **任务调度**：通过 Hangfire 定时执行各种后台任务（例如示例任务、qBittorrent 相关任务、DDNS 更新等）。
- **远程系统操作**：提供系统信息查询、文件操作、终端命令执行（WebSocket 远程终端）等能力。
- **远程输入控制**：通过 WebSocket 通道远程控制目标机器的键鼠输入，用于远程桌面辅助操作。

整体运行原理简要说明：

- Web 端通过 HTTP API 和 WebSocket 与服务端交互（例如 `/ws/terminal`、`/ws/input`）。
- 服务端启动后：
  - 使用 Kestrel（自宿主）或通过 IIS 反向代理对外提供 HTTP/HTTPS 服务。
  - 挂载 Hangfire Server 并注册定时任务，暴露 `/hangfire` 控制面板。
  - 对终端命令、键鼠输入等敏感操作通过后台服务（如 `SystemService`、`TerminalService`）在本机执行。
- 远程控制与后台任务的访问，都通过 JWT 鉴权和 Web 登录入口（如 `/Account/Login`）进行保护。

#### 为何需要高权限（LocalSystem / 管理员）

由于本项目涉及对本机系统的深度控制，为实现以下能力，需要较高权限：

- 在 Session 0 或后台服务环境中启动、管理桌面代理进程（例如使用计划任务在用户登录时以高权限运行桌面代理）。
- 在系统层面执行某些需要管理员权限的操作（如部分远程控制命令、访问受保护的系统资源等）。
- 在多会话/远程桌面环境中正确切换或访问当前交互式会话。

因此在 **IIS 部署场景** 下，通常需要：

- 使用 LocalSystem 或具备等效权限的服务账号运行应用程序池，以便能够在 Session 0 中正确检测环境、创建计划任务并启动高权限桌面代理。
- 结合配置项 `RemoteControl:ElevatedAgent`，将真正执行桌面操作的代理进程以指定管理员账户运行，从而在保证功能的同时，将权限集中到少数受控账户中管理。

在 **自宿主运行场景** 下，如果你只在当前登录用户会话中使用部分功能，可以用普通用户运行；若需要完整远程控制能力（尤其是跨会话、跨桌面操作），建议以管理员身份（或通过“以管理员身份运行”/计划任务方式）启动自宿主进程。

---

### 一、运行前准备

- **安装环境**
  - 安装 [.NET 8 Runtime / SDK](https://dotnet.microsoft.com/)（推荐安装 SDK，便于本机调试）。
  - Windows 10/11 或 Windows Server，具备管理员权限。
- **获取源码**
  - 从本地 `e:\GIT\chuckieTool` 打开，或使用你自己的 Git 仓库管理（如需要）。

- **配置应用设置（含网站登录账号）**
  - 复制 `WebApplication1\appsettings.example.json` 为 `WebApplication1\appsettings.json`。
  - 在 `Auth` 节点中配置网站登录用的用户名、密码和 JWT 密钥，例如：

```json
{
  "Auth": {
    "Username": "你的登录用户名",
    "Password": "一个足够复杂的登录密码",
    "JwtSecret": "YOUR_JWT_SECRET_HERE_MUST_BE_LONG_ENOUGH"
  },
  "QbSettings": {
    "DefaultDockerUrl": "http://username:password@hostname:port",
    "DefaultHomeUrl": "http://username:password@hostname:port"
  },
  "CloudflareSettings": {
    "ApiToken": "YOUR_CLOUDFLARE_API_TOKEN",
    "ZoneId": "YOUR_ZONE_ID_HERE",
    "RecordName": "your.domain.com",
    "Proxied": false,
    "Ttl": 1800
  }
}
```

  - **登录方式说明**：
    - Web 登录页面（如 `/Account/Login`）和 Hangfire 面板访问，会使用 `Auth:Username` / `Auth:Password` 进行登录验证。
    - 登录成功后，服务端会根据 `Auth:JwtSecret` 生成 JWT，用于后续访问受保护接口和 WebSocket（如 `/ws/input`）。
    - 如果你更改了 `Username` 或 `Password`，需要使用新的账号密码重新登录。

- **可选：配置远程控制提权代理**
  - 在 `WebApplication1\appsettings.json` 中增加：

```json
"RemoteControl": {
  "ElevatedAgent": {
    "UserName": "本机管理员用户名",
    "Password": "管理员密码（或使用环境变量 REMOTECONTROL_ELEVATEDAGENT_PASSWORD）",
    "Domain": "可选，域/工作组"
  }
}
```

> 注意：`appsettings.json` 中通常包含敏感信息（密码、Token），**不要提交到公共 Git 仓库**。可仅提交 `appsettings.example.json`。

---

### 二、自宿主方式运行（Kestrel）

此方式适合本机开发调试或简单部署，直接使用 `dotnet run` 或编译后的 `exe` 运行。

#### 1. 使用 `dotnet run` 运行

在命令行中进入 `WebApplication1` 目录：

```bash
cd WebApplication1
dotnet run --project ChuckieHelper.WebApi.csproj
```

- 默认会使用 `launchSettings.json` 中的配置，例如 `http://localhost:5104`。
- 浏览器访问：
  - `http://localhost:5104/` 主页
  - `http://localhost:5104/hangfire` Hangfire 面板（需登录）

#### 2. 使用发布后的可执行文件运行

在解决方案根目录执行：

```bash
dotnet publish WebApplication1/ChuckieHelper.WebApi.csproj -c Release -o publish
```

发布完成后，在 `publish` 目录下运行：

```bash
cd publish
ChuckieHelper.WebApi.exe
```

如需修改监听地址/端口，可在启动前设置环境变量或使用命令行参数，例如：

```bash
set ASPNETCORE_URLS=http://0.0.0.0:5104
ChuckieHelper.WebApi.exe
```

或在 `appsettings.json` / `appsettings.Production.json` 中添加 `Kestrel` 相关配置（根据需要自行扩展）。

---

### 三、IIS 承载运行（含 LocalSystem 配置）

此方式适合在服务器上长期运行，并通过 IIS 管理站点、SSL 证书等。

#### 1. 安装 IIS 和 ASP.NET Core Hosting Bundle

- 在 Windows「启用或关闭 Windows 功能」中勾选：
  - **Web 服务器 (IIS)**
  - **IIS 管理控制台**
  - 静态内容、默认文档等基础组件。
- 从微软官网下载并安装 **ASP.NET Core Runtime Hosting Bundle（.NET 8 对应版本）**。

#### 2. 发布 Web 应用

在仓库根目录执行：

```bash
dotnet publish WebApplication1/ChuckieHelper.WebApi.csproj -c Release -o C:\inetpub\ChuckieHelper.WebApi
```

（你也可以选择其他路径，但需与后续 IIS 物理路径一致）

#### 3. 在 IIS 中创建网站

1. 打开「IIS 管理器」。
2. 右键「网站」→「添加网站」：
   - **站点名称**：`ChuckieHelper.WebApi`
   - **物理路径**：`C:\inetpub\ChuckieHelper.WebApi`（或你发布的目录）
   - **绑定**：选择端口（如 `5104` 或 `80`），主机名根据需要填写。
3. 确认应用程序池：
   - 建议新建一个专用应用程序池，例如 `ChuckieHelperPool`。
   - .NET CLR 版本选择 `无托管代码`（ASP.NET Core 由 Hosting Bundle 托管）。

#### 4. 将应用程序池配置为 LocalSystem 账号运行

> 仅在你确实需要使用 LocalSystem 权限（例如访问 Session 0、开启桌面代理等高权限功能）时使用此方式。否则更推荐使用受限服务账号。

1. 在 IIS 管理器中打开「应用程序池」。
2. 找到 `ChuckieHelperPool` → 右键「高级设置」。
3. 在「进程模型」→「标识」：
   - 点击右侧按钮，选择「内置帐户」。
   - 选择 **LocalSystem**（本地系统）。
4. 保存后重启应用程序池和站点。

此时站点将以 LocalSystem 身份运行，当检测到运行在 Session 0 时，应用会尝试根据配置创建高权限的桌面代理计划任务（参见 `RemoteControl:ElevatedAgent` 设置）。

#### 5. 测试访问

- 在浏览器访问你配置的地址，例如：
  - `http://your-server:5104/`
  - `http://your-server/hangfire`
- 使用在 `appsettings.json` 中配置的账号密码登录。

---

### 四、桌面代理（配合 IIS 的辅助进程）

桌面代理并不是一个单独的运行模式供用户选择，而是 **在 IIS/服务场景下，为了解决 Session 0 无桌面的问题而设计的辅助进程**：

- 当站点在 IIS（通常为 LocalSystem）中运行且检测到自己处于 Session 0 时，会根据 `RemoteControl:ElevatedAgent` 配置自动创建计划任务。
- 该计划任务在真实的交互式桌面会话中，以指定管理员账号启动一个 **桌面代理进程**。
- 桌面代理进程负责实际执行需要交互式桌面的高权限操作（如键鼠输入、前台窗口操作等），WebApi 则通过命名管道与其通信。

程序内部支持通过命令行参数 `--desktop-agent` 启动桌面代理进程，本质上是给 **计划任务或高级用户手工调试** 使用：

- 此进程启动时：
  - **不再启动 Web 服务器**，只运行命名管道服务器处理桌面操作。
  - 通常由系统自动（计划任务）在用户登录时启动，而不是手工随便运行。

手工调试示例（在发布目录中）：

```bash
ChuckieHelper.WebApi.exe --desktop-agent
```

在正式环境中更推荐：

- 通过 IIS 以 LocalSystem 运行 WebApi。
- 在 `appsettings.json` 中配置 `RemoteControl:ElevatedAgent` 的账号和密码。
- 由应用在 Session 0 场景下自动创建/维护计划任务，以指定管理员身份、勾选「使用最高权限运行」的方式启动桌面代理进程。

---

### 五、常见问题（FAQ）

- **Q：发布后访问 500/502？**
  - 检查 `appsettings.json` 是否存在且格式正确。
  - 确认 .NET 8 Hosting Bundle 是否安装成功。
  - 查看 Windows 事件查看器或 `logs` 目录中日志（如有）。

- **Q：Hangfire 打不开或提示未授权？**
  - 确认已用正确账号密码登录。
  - 确认浏览器未拦截 Cookie / JWT。

- **Q：远程控制相关功能无法使用？**
  - 确认应用池账号或运行账号权限是否足够（如是否为 LocalSystem 或具有相应桌面访问权限）。
  - 检查 `RemoteControl:ElevatedAgent` 配置是否正确，以及计划任务是否创建成功。

如需进一步定制部署脚本或自动化（CI/CD、Docker 等），可以在此 README 的基础上新增章节。

