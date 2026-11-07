#!/bin/bash
# dev-browser/start.sh — the container's entrypoint: the proxy to the world (when WORLD_URL names it) and the
# browser start in the background, then whatever was asked for runs (Harbor's commands, or nothing). Logs land
# in /logs/agent, which Harbor keeps with each trial.
#
#   WORLD_URL    the site the world is published at; unset, the browser opens the real internet as it is
#   WORLD_HOSTS  the hosts the world answers for, the first at the site's root, the others under /__h/<host>
set -euo pipefail
mkdir -p /logs/agent
hosts="${WORLD_HOSTS:-www.linkedin.com,linkedin.com,static.licdn.com,media.licdn.com}"
rules=()
if [ -n "${WORLD_URL:-}" ]; then
  # The proxy speaks HTTPS under the hosts' own names, with a self-signed certificate the browser is told to accept.
  mkdir -p /opt/tls
  san="$(echo "$hosts" | sed 's/[^,]*/DNS:&/g')"
  [ -f /opt/tls/cert.pem ] || openssl req -x509 -newkey rsa:2048 -nodes -days 365 -keyout /opt/tls/key.pem -out /opt/tls/cert.pem \
    -subj "/CN=${hosts%%,*}" -addext "subjectAltName=$san" >/dev/null 2>&1
  WORLD_HOSTS="$hosts" node /opt/dev-browser/proxy.mjs > /logs/agent/world-proxy.log 2>&1 &
  map="$(echo "$hosts" | sed 's/\([^,]*\)/MAP \1 127.0.0.1:4443/g; s/,/, /g')"
  rules=(--ignore-certificate-errors "--host-resolver-rules=$map")
fi
chrome="$(find /ms-playwright -type f -name chrome -path '*chrome-linux*' | sort | head -1)"
"$chrome" --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --disable-crash-reporter \
  --remote-debugging-port=9222 --remote-allow-origins='*' --user-data-dir=/tmp/profile --window-size=1440,900 \
  ${rules[@]+"${rules[@]}"} about:blank > /logs/agent/chromium.log 2>&1 &
for _ in $(seq 1 40); do curl -sf http://127.0.0.1:9222/json/version >/dev/null 2>&1 && break; sleep 0.5; done
# CDP and the proxy bind loopback, where the agent container, sharing this one's network, reaches them; a relay
# on the container's other interfaces makes them reachable from the host too (compose maps 9224 → 9222 and 4443).
node -e 'const os=require("os"),net=require("net");for(const p of [9222,4443])for(const a of Object.values(os.networkInterfaces()).flat().filter(a=>a.family==="IPv4"&&!a.internal))net.createServer(c=>{const u=net.connect(p,"127.0.0.1");c.pipe(u).pipe(c);c.on("error",()=>u.destroy());u.on("error",()=>c.destroy())}).listen(p,a.address)' > /logs/agent/relay.log 2>&1 &
exec "$@"
