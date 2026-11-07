#!/usr/bin/env bash
# dataset/build.sh — assemble the dataset the way Harbor runs and publishes it,
# into dist/: dataset.toml with digests, every task self-contained. dist/ holds one build, the
# latest; publish.sh ships it.
#
# tasks/<case>/ holds only what differs per case: the question (instruction.md) and the facts
# (tests/expected.json). The world every case plays against is one, ../world, published as a site that
# the image shared/environment/Dockerfile is FROM — the browser runtime — fetches it from; the build checks
# that image exists, built here or pushed. shared/ holds everything else, in the case's own layout —
# task.toml, environment/Dockerfile, tests/test.sh, tests/correctness.mjs, tests/shapes.json — and the
# build lays it over every case. Every shared file is a template: {{name}} is replaced from the build
# context, which holds the dataset's name and version and, while a case is assembled, currentFolder,
# that case's folder name; a token with no value fails the build. The instruction is the case's question
# alone: the browser comes from task.toml's MCP server, the rest is the agent's own. The version is the one in dataset.toml, managed by hand: bump it there when a
# change can move a score. Prints the build folder on stdout; dist/ is ignored by git.
set -euo pipefail

here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
shared="$here/shared"
out="$here/dist"

# The build context: name=value pairs, the values that {{name}} tokens in shared files render to.
context=()
set_context() {
  local key="$1" value="$2" entry kept=()
  for entry in ${context[@]+"${context[@]}"}; do [[ "$entry" == "$key="* ]] || kept+=("$entry"); done
  context=(${kept[@]+"${kept[@]}"} "$key=$value")
}

# render FILE: FILE's content with every {{name}} replaced from the context.
render() {
  local script="" entry key value
  for entry in ${context[@]+"${context[@]}"}; do
    key="${entry%%=*}"; value="${entry#*=}"
    value="${value//\\/\\\\}"; value="${value//|/\\|}"; value="${value//&/\\&}"
    script+="s|{{$key}}|$value|g;"
  done
  sed -e "$script" "$1"
}

# rendered FILE LABEL: fail if FILE still holds a token, naming LABEL and the token.
rendered() {
  local left
  if left="$(grep -o '{{[^}]*}}' "$1" | sort -u)"; then
    echo "$2: no value in the build context for ${left//$'\n'/, }" >&2
    exit 2
  fi
}

# spread DEST: every file of shared/, rendered, at the same path under DEST.
spread() {
  local dest="$1" src rel dst
  while IFS= read -r src; do
    rel="${src#"$shared/"}"
    dst="$dest/$rel"
    mkdir -p "$(dirname "$dst")"
    render "$src" > "$dst"
    if [[ -x "$src" ]]; then chmod +x "$dst"; fi
    rendered "$dst" "shared/$rel"
  done < <(find "$shared" -type f ! -name .DS_Store | sort)
}

# The image every task is built FROM, as shared/environment/Dockerfile names it. It must exist —
# built on this machine (linkedin-agent/world/image.sh) or pushed — before a task can.
world_image="$(awk '/^FROM /{print $2; exit}' "$shared/environment/Dockerfile")"
[[ -n "$world_image" ]] || { echo "shared/environment/Dockerfile must be FROM the browser runtime image." >&2; exit 2; }
docker image inspect "$world_image" >/dev/null 2>&1 || docker manifest inspect "$world_image" >/dev/null 2>&1 \
  || { echo "The image $world_image is not built or pushed: pull it, or build it with npm run image in browser-use-faker" >&2; exit 2; }

# The dataset's name and version, from the [dataset] section of dataset.toml.
read -r name version < <(awk '/^\[dataset\]/{s=1;next} /^\[/{s=0} s && /^name *=/{n=$0} s && /^version *=/{v=$0} END{gsub(/^[^"]*"|"[^"]*$/,"",n);gsub(/^[^"]*"|"[^"]*$/,"",v);print n, v}' "$here/dataset.toml")
[[ -n "$name" && -n "$version" ]] || { echo "dataset.toml must give the dataset's name and version." >&2; exit 2; }
set_context datasetName "$name"
set_context datasetVersion "$version"

rm -rf "$out"
mkdir -p "$out"
# The manifest's [dataset] section; the task entries are regenerated below from the assembled tasks.
awk '/^\[\[tasks\]\]/{exit} {print}' "$here/dataset.toml" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}' > "$out/dataset.toml"

count=0
skipped=0
for task in "$here"/tasks/*/; do
  task="${task%/}"
  folder="$(basename "$task")"
  [[ -f "$task/instruction.md" ]] || continue
  # A case still on the retired mock (environment/mock) has facts taken from authored snapshots, not from
  # the world: it is skipped until its question and facts are rewritten against world/.
  if [[ -d "$task/environment/mock" ]]; then
    echo "▸ skipped $folder: still on the retired mock" >&2
    skipped=$((skipped + 1))
    continue
  fi
  if [[ ! -f "$task/tests/expected.json" ]]; then
    echo "▸ skipped $folder: no tests/expected.json" >&2
    skipped=$((skipped + 1))
    continue
  fi
  dest="$out/$folder"
  rsync -a --exclude .DS_Store "$task/" "$dest/"
  set_context currentFolder "$folder"
  spread "$dest"
  cp "$dest/instruction.md" "$dest/tests/instruction.md"   # the question, for the grader's extractor
  count=$((count + 1))
done
(( count )) || { echo "No case under $here/tasks has a question and facts." >&2; exit 2; }

# The task entries, with the digests of the assembled tasks.
harbor dataset add "$out"/*/ --to "$out" >/dev/null
harbor sync "$out" >/dev/null
summary="$count tasks assembled in ${out#"$here"/}"
(( skipped )) && summary+=", $skipped skipped"
echo "▸ $name $version: $summary" >&2
echo "$out"
