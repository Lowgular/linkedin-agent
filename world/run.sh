#!/usr/bin/env bash
# world/run.sh — run the world image on this machine without compose: the recorded LinkedIn behind the
# dev-browser MCP, at http://127.0.0.1:9333/mcp. `docker compose up -d world` in the repository root does the
# same; this is the one-container form. Nothing here is live LinkedIn.
#
#   ./run.sh            start (or restart) the world and wait for the MCP
#   ./run.sh stop       remove the container
#   ./run.sh clicks     the fake's click log — what the agent clicked, by accessible name
#
# The image is the one world.toml names (WORLD_IMAGE overrides), pulled if it is not here. The host port is
# 9333 and only 9333: the service inside accepts the Host header 127.0.0.1:9333 and no other.
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
field() { awk -v k="$1" '/^\[world\]/{s=1;next} /^\[/{s=0} s && $1==k {gsub(/^[^"]*"|"[^"]*$/,""); print; exit}' "$here/world.toml"; }
image="${WORLD_IMAGE:-$(field image):$(field version)}"
name="linkedin-world"
case "${1:-up}" in
  up)
    docker rm -f "$name" >/dev/null 2>&1 || true
    docker run -d --name "$name" -p 127.0.0.1:9333:9333 "$image" >/dev/null
    for _ in $(seq 1 60); do curl -sf http://127.0.0.1:9333/health >/dev/null 2>&1 && { echo "world up: dev-browser MCP at http://127.0.0.1:9333/mcp ($image)"; exit 0; }; sleep 1; done
    echo "the MCP did not answer on 127.0.0.1:9333: docker logs $name" >&2; exit 1;;
  stop) docker rm -f "$name" >/dev/null 2>&1 && echo "world stopped" || echo "no world running";;
  clicks) docker exec "$name" cat /logs/agent/faker-clicks.jsonl 2>/dev/null || echo "no clicks yet";;
  *) echo "Usage: ./run.sh [up|stop|clicks]" >&2; exit 2;;
esac
