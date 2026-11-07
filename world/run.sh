#!/usr/bin/env bash
# world/run.sh — run the world image on this machine, for an agent on this machine: the recorded LinkedIn
# served as a fake behind the real dev-browser MCP, in one container, the MCP at http://127.0.0.1:9333/mcp.
# Nothing here is live LinkedIn.
#
#   ./run.sh            start (or restart) the world and wait for the MCP
#   ./run.sh stop       remove the container
#   ./run.sh clicks     the fake's click log — what the agent clicked, by accessible name
#
# The image is the one world.toml names (WORLD_IMAGE overrides), pulled if it is not here. The dev-browser
# inside listens on loopback only and accepts Host 127.0.0.1:9333 or localhost:9333, so a forwarder started
# in the container relays 0.0.0.0:9335 to it and the host's port (WORLD_PORT, 9333) is mapped onto 9335.
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
field() { awk -v k="$1" '/^\[world\]/{s=1;next} /^\[/{s=0} s && $1==k {gsub(/^[^"]*"|"[^"]*$/,""); print; exit}' "$here/world.toml"; }
image="${WORLD_IMAGE:-$(field image):$(field version)}"
name="linkedin-world"
port="${WORLD_PORT:-9333}"
probe() { curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$port/mcp" \
  -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"run.sh","version":"0"}}}'; }
case "${1:-up}" in
  up)
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker run -d --name "$name" -p "127.0.0.1:$port:9335" "$image" >/dev/null
    for _ in $(seq 1 30); do docker exec "$name" sh -c 'exec 3<>/dev/tcp/127.0.0.1/9333' 2>/dev/null && break; sleep 1; done
    docker exec -d "$name" node -e 'const net=require("net");net.createServer(c=>{const u=net.connect(9333,"127.0.0.1");c.pipe(u).pipe(c);c.on("error",()=>u.destroy());u.on("error",()=>c.destroy())}).listen(9335,"0.0.0.0")'
    for _ in $(seq 1 30); do [[ "$(probe)" == 200 ]] && { echo "world up: dev-browser MCP at http://127.0.0.1:$port/mcp ($image)"; exit 0; }; sleep 1; done
    echo "the MCP did not answer on 127.0.0.1:$port: docker logs $name" >&2; exit 1;;
  stop) docker rm -f "$name" >/dev/null 2>&1 && echo "world stopped" || echo "no world running";;
  clicks) docker exec "$name" cat /logs/agent/faker-clicks.jsonl 2>/dev/null || echo "no clicks yet";;
  *) echo "Usage: ./run.sh [up|stop|clicks]" >&2; exit 2;;
esac
