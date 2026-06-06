#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Colors
G="\033[0;32m"; Y="\033[0;33m"; R="\033[0;31m"; B="\033[0;34m"; N="\033[0m"

cleanup() {
  echo -e "\n${Y}正在停止服务…${N}"
  kill "$SERVER_PID" "$CLIENT_PID" 2>/dev/null
  wait "$SERVER_PID" "$CLIENT_PID" 2>/dev/null
  echo -e "${G}已退出${N}"
}
trap cleanup EXIT INT TERM

echo -e "${B}▶ 服务控制中心${N}"

# Start server
cd "$ROOT/server"
npm run dev >/tmp/cc-server.log 2>&1 &
SERVER_PID=$!

# Wait for server to be ready
printf "${Y}等待后端启动${N}"
for i in $(seq 1 20); do
  if curl -sf http://localhost:9000/api/services >/dev/null 2>&1; then
    echo -e " ${G}✓${N}"
    break
  fi
  printf "."
  sleep 0.5
  if [ "$i" -eq 20 ]; then
    echo -e " ${R}✗ 后端启动超时，查看日志：/tmp/cc-server.log${N}"
    exit 1
  fi
done

# Start client
cd "$ROOT/client"
npm run dev >/tmp/cc-client.log 2>&1 &
CLIENT_PID=$!

# Wait for client to be ready
printf "${Y}等待前端启动${N}"
for i in $(seq 1 20); do
  if curl -sf http://localhost:5173 >/dev/null 2>&1; then
    echo -e " ${G}✓${N}"
    break
  fi
  printf "."
  sleep 0.5
  if [ "$i" -eq 20 ]; then
    echo -e " ${R}✗ 前端启动超时，查看日志：/tmp/cc-client.log${N}"
    exit 1
  fi
done

echo ""
echo -e "  ${G}后端${N}  http://localhost:9000"
echo -e "  ${G}前端${N}  http://localhost:5173"
echo ""
echo -e "${Y}Ctrl-C 退出${N}"

# Tail both logs to stdout, prefixed
tail -f /tmp/cc-server.log | sed "s/^/$(printf "${B}[server]${N}") /" &
tail -f /tmp/cc-client.log | sed "s/^/$(printf "${G}[client]${N}") /" &

wait "$SERVER_PID" "$CLIENT_PID"
