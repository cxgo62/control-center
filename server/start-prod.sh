#!/usr/bin/env bash
# launchd 守护进程启动脚本
# 直接使用源码运行，无需构建产物

# launchd 环境里 PATH 很窄，手动补全
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | sort -V | tail -1)/bin:$PATH"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$ROOT/logs"

# 启动服务端（tsx 直接跑源码，无 watch）
cd "$ROOT/server"
"$ROOT/server/node_modules/.bin/tsx" src/index.ts &
SERVER_PID=$!

# 启动前端 Vite dev server
cd "$ROOT/client"
"$ROOT/client/node_modules/.bin/vite" &
CLIENT_PID=$!

# 等待任一进程退出，KeepAlive 会让 launchd 重启整个脚本
wait $SERVER_PID $CLIENT_PID
