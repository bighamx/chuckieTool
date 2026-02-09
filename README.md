# ChuckieHelper

<div align="center">

**基于 .NET 8 的 Web 后台管理与远程控制服务**

[![.NET](https://img.shields.io/badge/.NET-8.0-512BD4?style=flat-square&logo=dotnet)](https://dotnet.microsoft.com/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows-0078D6?style=flat-square&logo=windows)](https://www.microsoft.com/windows)

</div>

---

## ✨ 功能特性

- 🖥️ **系统控制** - 实时监控 CPU、内存、磁盘、显卡等硬件信息，支持锁定、睡眠、休眠、关机操作
- 📊 **进程管理** - 查看和管理系统进程，支持按类型筛选和终止进程
- 🎮 **远程控制** - 实时远程桌面控制，支持 H.264 编码，可调节分辨率和画质
- 💻 **命令终端** - WebSocket 远程终端，支持 PowerShell/CMD
- 🐳 **容器管理** - Docker 容器的启动、停止、删除和日志查看
- 📝 **Compose 编辑** - Docker Compose 文件的在线编辑、验证和一键部署
- 📁 **文件管理** - 远程文件浏览、上传、下载和删除
- ⏰ **任务调度** - 基于 Hangfire 的定时任务管理（qBittorrent、DDNS 更新等）
- 🔐 **安全认证** - JWT 认证保护所有敏感操作

---

## 📸 界面预览

### 系统控制

实时监控系统硬件信息，一键执行电源操作。

![系统控制界面](screenshots/QQ20260209-151205.png)

### 进程管理

查看所有运行中的进程，支持筛选和终止操作。

![进程管理界面](screenshots/QQ20260209-151239.png)

### 远程控制

实时远程桌面，支持 H.264 视频流，低延迟高画质。

![远程控制界面](screenshots/QQ20260209-151344.png)

### 命令终端

WebSocket 远程终端，支持 PowerShell 和 CMD。

![命令终端界面](screenshots/QQ20260209-151405.png)

### 容器管理

管理 Docker 容器的完整生命周期。

![容器管理界面](screenshots/QQ20260209-151413.png)

### Docker Compose

在线编辑和部署 Docker Compose 项目。

![Compose 编辑器](screenshots/QQ20260209-151449.png)

### 文件管理

远程浏览和管理服务器文件。

![文件管理界面](screenshots/QQ20260209-151459.png)

---

## 🚀 快速开始

### 环境要求

- Windows 10/11 或 Windows Server
- [.NET 8 SDK/Runtime](https://dotnet.microsoft.com/download/dotnet/8.0)
- （可选）IIS + ASP.NET Core Hosting Bundle

### 安装步骤

1. **克隆仓库**

```bash
git clone https://github.com/bighamx/chuckieTool.git
cd chuckieTool
```

2. **配置应用**

```bash
# 复制示例配置文件
copy WebApplication1\appsettings.example.json WebApplication1\appsettings.json
```

编辑 `appsettings.json`，配置必要的参数：

```json
{
  "Auth": {
    "Username": "你的用户名",
    "Password": "你的密码",
    "JwtSecret": "至少32位的随机密钥"
  }
}
```

3. **运行应用**

```bash
cd WebApplication1
dotnet run
```

4. **访问服务**

- 主页：`http://localhost:5104/`
- Hangfire 面板：`http://localhost:5104/hangfire`

---

## ⚙️ 配置说明

### 基础配置

| 配置项 | 说明 | 示例 |
|--------|------|------|
| `Auth:Username` | 登录用户名 | `admin` |
| `Auth:Password` | 登录密码（必填） | `YourSecurePassword` |
| `Auth:JwtSecret` | JWT 签名密钥（必填，≥32位） | `YourSecretKey...` |

### 可选配置

<details>
<summary><b>qBittorrent 设置</b></summary>

```json
{
  "QbSettings": {
    "DefaultDockerUrl": "http://user:pass@host:port",
    "DefaultHomeUrl": "http://user:pass@host:port"
  }
}
```

</details>

<details>
<summary><b>Cloudflare DDNS 设置</b></summary>

```json
{
  "CloudflareSettings": {
    "ApiToken": "YOUR_API_TOKEN",
    "ZoneId": "YOUR_ZONE_ID",
    "RecordName": "your.domain.com",
    "Proxied": false,
    "Ttl": 1800
  }
}
```

</details>

<details>
<summary><b>远程控制提权代理</b></summary>

用于在 IIS/Session 0 环境下执行需要桌面交互的操作：

```json
{
  "RemoteControl": {
    "ElevatedAgent": {
      "UserName": "管理员用户名",
      "Password": "管理员密码",
      "Domain": "可选，域名"
    }
  }
}
```

或使用环境变量：`REMOTECONTROL_ELEVATEDAGENT_PASSWORD`

</details>

---

## 🖥️ 部署方式

### 方式一：自宿主运行（开发/测试）

```bash
# 开发模式
dotnet run --project WebApplication1/ChuckieHelper.WebApi.csproj

# 发布后运行
dotnet publish -c Release -o publish
cd publish
ChuckieHelper.WebApi.exe
```

### 方式二：IIS 部署（生产环境）

#### 步骤 1：安装必要组件

1. **启用 IIS**
   - 打开「控制面板」→「程序」→「启用或关闭 Windows 功能」
   - 勾选以下项目：
     - ✅ **Internet Information Services**
     - ✅ **Web 管理工具** → **IIS 管理控制台**
     - ✅ **万维网服务** → **应用程序开发功能** → **ASP.NET 4.8**
     - ✅ **万维网服务** → **常见 HTTP 功能**（全部勾选）

2. **安装 ASP.NET Core Hosting Bundle**
   - 下载 [.NET 8 Hosting Bundle](https://dotnet.microsoft.com/download/dotnet/8.0)
   - 运行安装程序，安装完成后**重启 IIS**（或重启电脑）

#### 步骤 2：发布应用

```bash
dotnet publish WebApplication1/ChuckieHelper.WebApi.csproj -c Release -o C:\inetpub\ChuckieHelper
```

> 📁 发布后，将你的 `appsettings.json` 复制到 `C:\inetpub\ChuckieHelper` 目录

#### 步骤 3：创建应用程序池

1. 打开「IIS 管理器」（运行 `inetmgr`）
2. 右键「应用程序池」→「添加应用程序池」
   - **名称**：`ChuckieHelperPool`
   - **.NET CLR 版本**：`无托管代码`
   - **托管管道模式**：`集成`
3. 点击「确定」创建

#### 步骤 4：配置 LocalSystem 身份（重要！）

> ⚠️ **仅在需要远程控制功能时配置**。LocalSystem 具有最高权限，请谨慎使用。

1. 在「应用程序池」中找到 `ChuckieHelperPool`
2. 右键 →「高级设置」
3. 找到「进程模型」→「标识」，点击右侧的 `...` 按钮
4. 选择「内置帐户」→ 下拉选择 **LocalSystem**
5. 点击「确定」保存



#### 步骤 5：创建网站

1. 在 IIS 管理器中，右键「网站」→「添加网站」
2. 配置如下：
   - **站点名称**：`ChuckieHelper`
   - **应用程序池**：选择 `ChuckieHelperPool`
   - **物理路径**：`C:\inetpub\ChuckieHelper`
   - **绑定**：
     - 类型：`http`（或 `https`）
     - IP 地址：`全部未分配`
     - 端口：`5104`（或你希望的端口）
3. 点击「确定」创建

#### 步骤 6：验证部署

1. 启动网站（右键网站 →「管理网站」→「启动」）
2. 浏览器访问：`http://localhost:5104/`
3. 使用 `appsettings.json` 中配置的账号密码登录

#### 常见问题排查

| 问题 | 解决方案 |
|------|----------|
| 502.5 错误 | 检查 Hosting Bundle 是否正确安装，尝试重启 IIS |
| 500 错误 | 检查 `appsettings.json` 是否存在且格式正确 |
| 权限不足 | 确认应用程序池使用 LocalSystem 身份运行 |
| 端口被占用 | 更换端口或停止占用端口的服务 |

> ⚠️ **安全提示**：`appsettings.json` 包含敏感信息，请勿提交到公开仓库！

---

## 🔧 桌面代理

在 IIS/Session 0 环境下，远程控制功能需要桌面代理的支持：

- 当应用检测到运行在 Session 0 时，会根据 `RemoteControl:ElevatedAgent` 配置自动创建计划任务
- 计划任务在用户登录时启动桌面代理进程
- 代理通过命名管道与 WebApi 通信，执行键鼠输入等桌面操作

手工调试：

```bash
ChuckieHelper.WebApi.exe --desktop-agent
```

---

## ❓ 常见问题

<details>
<summary><b>Q: 访问出现 500/502 错误？</b></summary>

- 检查 `appsettings.json` 是否存在且格式正确
- 确认已安装 .NET 8 Hosting Bundle
- 查看 Windows 事件查看器中的错误日志

</details>

<details>
<summary><b>Q: Hangfire 面板无法访问？</b></summary>

- 确认已使用正确的账号密码登录
- 检查浏览器是否阻止了 Cookie

</details>

<details>
<summary><b>Q: 远程控制功能无法使用？</b></summary>

- 确认应用以管理员权限运行
- 在 IIS 部署时，检查应用池是否配置为 `LocalSystem`
- 验证 `RemoteControl:ElevatedAgent` 配置是否正确

</details>

---

## 📝 开源协议

本项目采用 [MIT 协议](LICENSE) 开源。

---

## 🙏 致谢

- [ASP.NET Core](https://github.com/dotnet/aspnetcore)
- [Hangfire](https://github.com/HangfireIO/Hangfire)
