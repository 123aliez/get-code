# Code (验证码获取服务) 项目文档

> **Outlook 邮箱验证码自动获取工具**：通过 IMAP + OAuth2 协议连接 Outlook 邮箱，自动轮询并提取邮件中的验证码，提供 Web 界面和 HTTP API 两种使用方式。

---

## 一、项目总览

本项目将 Outlook 邮箱验证码获取功能封装为 **HTTP API 服务 + Web 前端页面**，用于自动获取邮件中的各类验证码（OTP / 安全码 / 登录码等）。

### 核心能力

- ✅ 使用 IMAP + OAuth2 协议安全连接 Outlook 邮箱
- ✅ 智能识别验证码（支持多种关键词匹配、HTML 解析、多策略提取）
- ✅ 同时搜索收件箱 (INBOX) 和垃圾邮件 (Junk)
- ✅ 支持 SSE 流式日志实时返回
- ✅ 支持发件人 / 主题 / 验证码位数等高级过滤
- ✅ 提供简洁的 Web 前端页面

---

## 二、项目结构

```
code/
├── server.js           # HTTP 服务主程序 (端口 8003)
├── get-code.js         # 验证码获取核心脚本
├── package.json        # Node.js 依赖
├── package-lock.json   # 锁定依赖版本
├── 获取验证码.bat       # Windows 快捷启动脚本 (命令行模式)
├── public/
│   └── index.html      # Web 前端页面
└── node_modules/       # 依赖模块
    └── imapflow/       # IMAP 客户端库
```

---

## 三、环境要求

| 项目 | 版本要求 |
|------|---------|
| Node.js | >= 18.0 (需支持原生 `fetch`) |
| npm 包 | `imapflow` |
| 操作系统 | Linux / macOS / Windows |

---

## 四、安装步骤

### 1. 安装 Node.js

```bash
# 验证 Node.js 版本
node --version   # 需要 >= 18.0
```

### 2. 安装依赖

```bash
cd /home/ccweb/workspace/code
npm install
```

依赖列表 (`package.json`)：
```json
{
  "dependencies": {
    "imapflow": "^1.2.18"
  }
}
```

---

## 五、配置说明

本项目无配置文件，所有参数通过 API 请求时传入。

### 账号信息格式

```
邮箱----密码----clientId----refreshToken
```

| # | 字段 | 说明 |
|---|------|------|
| 1 | 邮箱 | Outlook / Hotmail 邮箱地址 |
| 2 | 密码 | Outlook 邮箱密码 (此脚本中未使用，仅占位) |
| 3 | OAuth 客户端 ID | 微软 Azure 应用的 `client_id`，用于刷新 OAuth Token |
| 4 | Refresh Token | 微软 OAuth 的 `refresh_token`，用于获取 IMAP 访问令牌 |

> **client_id 推荐使用 Thunderbird 公共 ID：** `9e5f94bc-e8a4-4e73-b8be-63364c29d753`

### 可选过滤参数

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| `sender` | string | 发件人地址过滤 (逗号分隔多个) | 不过滤 |
| `subject` | string | 邮件主题关键字过滤 (逗号分隔多个) | 不过滤 |
| `digits` | string | 验证码位数范围，如 `6` 或 `4-8` | `4-8` |
| `searchMinutes` | number | 搜索最近多少分钟内的邮件 | `30` |
| `timeoutSeconds` | number | 轮询超时时长（秒） | `150` |
| `scanLimitPerFolder` | number | 每个文件夹每轮最多扫描多少封最新邮件 | `120` |

---

## 六、启动与使用

### 6.1 启动 HTTP 服务

```bash
cd /home/ccweb/workspace/code
node server.js
```

启动成功后：
- **Web 页面：** `http://127.0.0.1:8003`
- **API 地址：** `http://127.0.0.1:8003/api/get-code`

### 6.2 Web 页面使用

1. 浏览器打开 `http://127.0.0.1:8003`
2. 在"账号信息"输入框粘贴：`邮箱----密码----clientId----refreshToken`
3. （可选）展开"高级选项"设置发件人过滤、主题过滤、验证码位数
4. 点击"获取验证码"
5. 页面实时显示日志，获取成功后验证码将以大字体显示，点击可复制

### 6.3 命令行直接使用

```bash
cd /home/ccweb/workspace/code
node get-code.js "邮箱----密码----clientId----refreshToken"
```

也可以不带参数运行，程序会提示手动输入：

```bash
node get-code.js
```

### 6.4 Windows 用户

双击 `获取验证码.bat` 即可启动命令行模式。

---

## 七、API 接口文档

### 健康检查

```
GET /health
```

**响应：**
```json
{
  "status": "ok",
  "service": "get-code",
  "activeTasks": 0,
  "uptime": 123.45
}
```

### 获取验证码

```
POST /api/get-code
Content-Type: application/json
```

**请求 Body：**
```json
{
  "account": "邮箱----密码----clientId----refreshToken",
  "options": {
    "sender": "noreply@openai.com",
    "subject": "verification",
    "digits": "6",
    "searchMinutes": 60,
    "timeoutSeconds": 180,
    "scanLimitPerFolder": 200
  },
  "stream": true
}
```

**同步模式 (`stream: false` 或不传)：**

等待验证码获取完成后返回结果：
```json
{
  "taskId": 1,
  "code": "123456",
  "exitCode": 0,
  "logs": "...",
  "duration": 15234
}
```

**流式模式 (`stream: true`)：**

使用 SSE (Server-Sent Events) 实时推送日志和结果：
```
data: {"type":"start","taskId":1}
data: {"type":"log","text":"邮箱: alice@hotmail.com\n"}
data: {"type":"log","text":"收件箱 近3分钟 2 封\n"}
data: {"type":"done","code":"123456","exitCode":0,"taskId":1}
```

### 查询活跃任务

```
GET /api/tasks
```

**响应：**
```json
{
  "tasks": [
    {"id": 1, "running": 5234}
  ]
}
```

---

## 八、验证码提取策略

程序使用多层匹配策略从邮件中提取验证码：

| 优先级 | 策略 | 说明 |
|--------|------|------|
| 1 | 关键词 + 数字 | 匹配 "verification code: 123456" 等模式 |
| 2 | 纯数字行 | 邮件中有关键词时，匹配独占一行的数字 |
| 3 | HTML 标签内数字 | 匹配 `>123456<` 模式 |
| 4 | 兜底任意数字 | 取第一个符合位数的数字串 |

**支持的验证码关键词：**
- 英文：verification code, security code, login code, one-time code, otp, passcode, code
- 中文：验证码, 验证代码, 安全码, 动态码, 一次性密码

### 邮件搜索行为

- 同时搜索 **收件箱 (INBOX)** 和 **垃圾邮件 (Junk)**
- 默认搜索最近 **30 分钟内** 的邮件（可通过 `searchMinutes` 调整）
- 每轮在每个文件夹扫描最近 **120 封** 邮件（可通过 `scanLimitPerFolder` 调整）
- 按时间倒序排列，优先处理最新邮件
- 未找到时每 **5 秒** 重试，默认总超时 **150 秒**（可通过 `timeoutSeconds` 调整）

---

## 九、获取 Outlook OAuth 凭证

如需获取 `client_id` 和 `refresh_token`：

1. **使用公共 client_id：** `9e5f94bc-e8a4-4e73-b8be-63364c29d753` (Thunderbird 公共 client_id，可直接使用)
2. **或在 [Azure 应用注册](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) 创建应用：**
   - 选择"个人 Microsoft 帐户"
   - 重定向 URI 设为 `http://localhost`
   - API 权限添加 `IMAP.AccessAsUser.All` 和 `offline_access`
   - 通过 OAuth 授权码流程获取 `refresh_token`

---

## 十、常见问题

| 问题 | 解决方案 |
|------|---------|
| IMAP 连接失败 | 检查 `refresh_token` 是否过期，需重新获取 |
| 获取 token 失败 | 检查 `client_id` 和 `refresh_token` 是否匹配 |
| 验证码获取超时 | 确认邮件已发送；增大 `searchMinutes`、`timeoutSeconds`，并检查收件箱/垃圾箱是否有新邮件 |
| node 版本过低 | 需要 Node.js >= 18 (原生 `fetch` 支持) |
| 端口被占用 | 服务固定监听 `127.0.0.1:8003`，确保端口未被占用 |

---

## 十一、两个项目的关系

`code` 项目是一个**独立的验证码获取服务**，与 `team-accept` 项目互为补充但**可独立运行**：

| 特性 | team-accept | code |
|------|-------------|------|
| 功能 | 批量注册 + 接受邀请 + 取 Token (完整流程) | 单次获取邮箱验证码 |
| 验证码获取方式 | 内置 IMAP 模块 (Python) | 独立 IMAP 服务 (Node.js) |
| 使用场景 | 自动化批量操作 | 手动触发，单次获取验证码 |
| 端口 | 8089 | 8003 |
| 技术栈 | Python 3 + curl_cffi | Node.js + imapflow |
