#!/usr/bin/env bash
# launchd 守护进程启动脚本
# 监督前后端进程；任一子进程退出时结束整组，让 launchd 重启。

# launchd 环境里 PATH 很窄，手动补全
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | sort -V | tail -1)/bin:$PATH"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$ROOT/logs"
exec node "$ROOT/server/supervisor.mjs"
