#!/usr/bin/env bash
# world/image.sh — build the world image world.toml names, from the Dockerfile here, on the runtime it names.
# Every task of the dataset is FROM it and compose.yaml runs it, so it is pulled once per machine and rebuilt
# only when world/ changes (bump world.toml first).
#
#   ./image.sh            build it for this machine's architecture, into Docker here
#   ./image.sh --push     build it for linux/amd64 and linux/arm64 and push both under one tag, so it runs on
#                         any machine; needs docker login ghcr.io with a token that can write packages
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
field() { awk -v k="$1" '/^\[world\]/{s=1;next} /^\[/{s=0} s && $1==k {gsub(/^[^"]*"|"[^"]*$/,""); print; exit}' "$here/world.toml"; }
name="$(field image)"; version="$(field version)"; runtime="$(field runtime)"
[[ -n "$name" && -n "$version" && -n "$runtime" ]] || { echo "world.toml must give the image's name, version and runtime." >&2; exit 2; }
image="$name:$version"
if [[ "${1:-}" == "--push" ]]; then
  # A multi-platform image cannot be loaded into the local Docker: a container builder builds it and pushes it.
  docker buildx inspect multiarch >/dev/null 2>&1 || docker buildx create --name multiarch --driver docker-container >/dev/null
  docker buildx build --builder multiarch --platform linux/amd64,linux/arm64 --push --build-arg "RUNTIME=$runtime" -t "$image" "$here"
else
  docker image inspect "$runtime" >/dev/null 2>&1 || docker manifest inspect "$runtime" >/dev/null 2>&1 \
    || { echo "The runtime image $runtime is neither built here nor pushed (browser-use-faker: npm run image)." >&2; exit 2; }
  docker build --build-arg "RUNTIME=$runtime" -t "$image" "$here"
fi
echo "$image"
