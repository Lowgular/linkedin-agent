#!/usr/bin/env bash
# dataset/publish.sh — publish the build in dist/ to Harbor Hub, private, tagged
# with the version its dataset.toml carries. Fails when dist/ holds no build, and when a case
# under tasks/ is not in it — a skipped case, or a build older than the case. Publishes are
# permanent and content-addressed: a changed task is a new revision, tags move, nothing is
# deleted; the version is managed by hand in dataset.toml, so bump it and rebuild before
# publishing a change that can move a score.
set -euo pipefail

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
dist="$here/dist"

[[ -f "$dist/dataset.toml" ]] || { echo "Nothing to publish: no build in ${dist#"$here"/}. Run ./build.sh first." >&2; exit 2; }
read -r name version < <(awk '/^\[dataset\]/{s=1;next} /^\[/{s=0} s && /^name *=/{n=$0} s && /^version *=/{v=$0} END{gsub(/^[^"]*"|"[^"]*$/,"",n);gsub(/^[^"]*"|"[^"]*$/,"",v);print n, v}' "$dist/dataset.toml")
[[ -n "$name" && -n "$version" ]] || { echo "${dist#"$here"/}/dataset.toml must give the dataset's name and version." >&2; exit 2; }

missing=()
for task in "$here"/tasks/*/; do
  task="${task%/}"
  [[ -f "$task/instruction.md" ]] || continue
  [[ -d "$dist/$(basename "$task")" ]] || missing+=("$(basename "$task")")
done
if (( ${#missing[@]} )); then
  echo "Not publishing: ${missing[*]} under tasks/ not in ${dist#"$here"/}. Complete or remove them, then ./build.sh." >&2
  exit 2
fi

count=$(find "$dist" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')
echo "▸ publishing $name $version: $count tasks from ${dist#"$here"/}" >&2
harbor publish "$dist" --tag "$version" --private
