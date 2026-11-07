#!/usr/bin/env bash
# world/image.sh — build the world image world.toml names: the runtime image it names (browser-use-faker's,
# the fake, a Chromium and the dev-browser service) with world/ at /opt/world. Every task of the dataset is
# FROM it, so it is pulled once per machine and rebuilt only when world/ changes (bump world.toml first).
#
#   ./image.sh            build it, for Docker on this machine
#   ./image.sh --push     build and push it, so the published dataset runs anywhere
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
field() { awk -v k="$1" '/^\[world\]/{s=1;next} /^\[/{s=0} s && $1==k {gsub(/^[^"]*"|"[^"]*$/,""); print; exit}' "$here/world.toml"; }
name="$(field image)"; version="$(field version)"; runtime="$(field runtime)"
[[ -n "$name" && -n "$version" && -n "$runtime" ]] || { echo "world.toml must give the image's name, version and runtime." >&2; exit 2; }
image="$name:$version"
docker image inspect "$runtime" >/dev/null 2>&1 || docker manifest inspect "$runtime" >/dev/null 2>&1 \
  || { echo "The runtime image $runtime is neither built here nor pushed (browser-use-faker: npm run image)." >&2; exit 2; }
printf 'FROM %s\nCOPY world/ /opt/world/\n' "$runtime" | docker build -t "$image" -f - "$here"
if [[ "${1:-}" == "--push" ]]; then docker push "$image"; fi
echo "$image"
