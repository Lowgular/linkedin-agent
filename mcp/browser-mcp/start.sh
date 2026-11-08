#!/bin/sh
# mcp/browser-mcp/start.sh — start the agent's browser tools in the background, unless they already answer, and
# wait until they do: the agent container's entrypoint runs it before Gemini CLI, the eval's harness in each
# trial before the CLI. Dependencies are installed beside it on first use. BROWSER_MCP_LOG: where it logs.
dir="$(cd "$(dirname "$0")" && pwd)"
port="${BROWSER_MCP_PORT:-9333}"
health="http://127.0.0.1:$port/health"
curl -sf "$health" >/dev/null 2>&1 && exit 0
[ -d "$dir/node_modules" ] || (cd "$dir" && npm ci --omit=dev --silent --no-audit --no-fund) || exit 1
log="${BROWSER_MCP_LOG:-/tmp/browser-mcp.log}"
mkdir -p "$(dirname "$log")"
nohup node "$dir/server.mjs" > "$log" 2>&1 &
for _ in $(seq 1 60); do curl -sf "$health" >/dev/null 2>&1 && exit 0; sleep 0.25; done
echo "browser-mcp did not start: $log" >&2
cat "$log" >&2
exit 1
