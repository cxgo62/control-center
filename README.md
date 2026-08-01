# 服务控制中心

家用 homelab 综合管理面板，提供服务监控、一键重启、网络连通性探测。

## 快速启动

```bash
./start.sh
```

浏览器打开 **http://localhost:5173**

> 后端 API 运行在 `localhost:9000`，前端 dev server 运行在 `localhost:5173`，通过 Vite proxy 转发 `/api` 请求。

---

## 配置服务列表

编辑 `server/src/config.ts` 中的 `SERVICES` 数组，每个服务的字段说明：

```typescript
{
  id: 'budget',             // 唯一 ID，用于 API 路由
  name: '预算系统',          // 显示名称
  group: 'app',             // 'infra'（网络基建）或 'app'（个人应用）
  tech: 'Next.js',          // 技术栈描述，显示在卡片副标题
  checkUrl: 'http://localhost:3001/api/health',  // 健康探测 URL（HTTP GET）
  port: ':3001',            // 仅用于展示
  addr: 'budget.local',     // 仅用于展示
  url: 'http://localhost:3001',  // "打开"按钮跳转地址（可选）

  // 服务管理方式（按平台自动选择，至少填一种）：
  brewService: 'budget',    // macOS：brew services 管理的服务名
  systemd: 'budget',        // Linux：systemd unit 名
  launchAgent: 'top.example.budget', // macOS：LaunchAgent label
  startScript: 'cd /opt/budget && npm start',  // 通用：启动命令
  stopScript: 'pkill -f "node /opt/budget"',   // 通用：停止命令
  logFile: '/opt/budget/logs/app.log',         // 日志文件路径（可选）

  // 可选：严格校验健康接口的 HTTP 状态和嵌套 JSON 字段
  health: {
    timeoutMs: 5000,
    expect: {
      httpStatus: 200,
      json: {
        runtimeRole: 'backup',
        readOnly: true,
        codex: { provider: 'local', status: 'available' },
      },
    },
  },
}
```

配置了 `health` 的服务只有在进程管理器状态正常、HTTP 状态码匹配且所有列出的 JSON 字段递归匹配时才显示为“运行中”。接口超时、连接失败、非预期状态码、无效 JSON 或字段不匹配都会显示为“异常”；未配置 `health` 的旧服务保持原有进程管理器语义。JSON 断言只校验配置中列出的字段，响应可以包含额外字段。

**服务管理优先级**（代码自动判断，无需手动配置）：

| 平台 | 优先级 |
|---|---|
| macOS | `brewService` → `startScript/stopScript` |
| Linux | `systemd` → `startScript/stopScript` |

---

## 配置网络探测目标

编辑 `server/src/config.ts` 中的 `NET_TARGETS` 数组：

```typescript
export const NET_TARGETS: NetTarget[] = [
  { id: 'google',  name: 'Google',         host: 'google.com',  url: 'https://www.google.com' },
  { id: 'chatgpt', name: 'ChatGPT',        host: 'chatgpt.com', url: 'https://chatgpt.com' },
  { id: 'cfdns',   name: 'Cloudflare DNS', host: '1.1.1.1',     url: 'https://1.1.1.1' },
  { id: 'baidu',   name: 'Baidu',          host: 'baidu.com',   url: 'https://www.baidu.com' },
];
```

---

## 配置 VPN / 代理路径

网络面板会分两条路径探测同一批目标：**直连** 和 **经代理**，对比延迟和可用率。

启动时设置环境变量：

```bash
PROXY_URL=http://127.0.0.1:7890 ./start.sh
```

`PROXY_URL` 留空时，两条路径都走直连（图表仍可用，只是数值相同）。

---

## 探测频率

| 类型 | 频率 | 存储时长 |
|---|---|---|
| 服务健康检查 | 每 30 秒 | 30 天 |
| 网络连通性探测 | 每 5 分钟 | 30 天 |

数据存储在项目根目录的 `data.db`（SQLite）。

---

## 服务管理操作

控制面板支持对每个服务执行以下操作：

- **重启** — 调用 `brew services restart` / `systemctl restart`
- **启动 / 停止** — 同上
- **探测** — 立即触发一次健康检查，刷新状态
- **日志** — 读取日志文件或 journald，在右侧抽屉展示
- **打开** — 在新标签跳转到 `url` 字段配置的地址

macOS LaunchAgent 的状态通过 `launchctl print gui/<uid>/<label>` 查询；重启使用 `launchctl kickstart -k gui/<uid>/<label>`，启动和停止分别使用对应 plist 的 `launchctl bootstrap` 与 `launchctl bootout`。

> **macOS 权限说明**：`brew services` 管理用户级服务无需 sudo。若需管理系统级服务（监听 80/443 端口的 nginx），在安装时执行过 `sudo brew services start nginx` 的话，重启也需要 sudo 权限。可在 `/etc/sudoers.d/control-center` 中为当前用户开放指定命令的无密码 sudo：
> ```
> youruser ALL=(root) NOPASSWD: /opt/homebrew/bin/brew services restart nginx
> ```

---

## 关于 Systemd（Linux 部署时的建议）

若将控制中心部署到 Linux 服务器，**强烈建议将所有 App 注册为 systemd 服务**，而不是脚本手动启动。

原因：
- `systemctl restart` 可从控制中心直接调用
- 崩溃后自动重拉（`Restart=on-failure`）
- 日志统一走 journald，`journalctl -u myapp -f` 可查
- 开机自动启动

注册示例：

```ini
# /etc/systemd/system/myapp.service
[Unit]
Description=My App
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/myapp/server.js
WorkingDirectory=/opt/myapp
Restart=on-failure
User=deploy

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now myapp
```

然后在 `config.ts` 中填写 `systemd: 'myapp'`，控制中心的所有按钮即可正常使用。

---

## 项目结构

```
control-center/
├── start.sh                  # 一键启动脚本
├── data.db                   # SQLite 数据库（自动创建）
├── server/
│   └── src/
│       ├── config.ts         # ← 主要配置文件（服务列表、探测目标、代理）
│       ├── checker.ts        # 服务健康检查 + 管理操作
│       ├── prober.ts         # 网络连通性探测
│       ├── db.ts             # SQLite 读写
│       └── routes/
│           ├── services.ts   # GET /api/services, POST /api/services/:id/action
│           └── network.ts    # GET /api/network/data, POST /api/network/probe
└── client/
    └── src/
        ├── App.tsx           # 顶栏 + 页面切换，每 10s 轮询
        └── components/
            ├── ServicesPage.tsx  # 服务监控页（健康环 + 卡片网格）
            ├── NetworkPage.tsx   # 网络探测页（折线图 + 连通性时间轴）
            └── Shared.tsx        # 公共组件（状态点、操作按钮、sparkline 等）
```

## API 速查

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/services` | 所有服务的当前状态 |
| POST | `/api/services/:id/action` | `{ action: "start"\|"stop"\|"restart"\|"probe" }` |
| GET | `/api/services/:id/logs` | `?lines=40`，返回日志行 |
| GET | `/api/events` | 最近 10 条操作事件 |
| GET | `/api/network/data` | `?range=1h\|6h\|24h\|7d`，返回探测数据 |
| POST | `/api/network/probe` | 立即触发一次全量网络探测 |
