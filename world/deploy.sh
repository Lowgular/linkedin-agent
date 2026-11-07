#!/usr/bin/env bash
# world/deploy.sh — publish world/ as a static site on Firebase Hosting: browser-use-faker's static export (the
# recorder and fake the world was made with, in the marek checkout beside this one; FAKER_DIR names another)
# writes it into site/ (ignored by git), then the Firebase CLI deploys it to the site world.toml names. For
# whoever maintains the world; the agent, the eval and the participants only read the site.
#
#   ./deploy.sh             export and deploy
#   ./deploy.sh --dry-run   export only: site/public is what would be deployed
#
# Needs Node, and a Firebase login once: npx firebase-tools login.
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
faker="${FAKER_DIR:-$here/../../marek/browser-use-faker}"
[[ -f "$faker/static.mjs" ]] || { echo "No browser-use-faker at $faker: set FAKER_DIR." >&2; exit 2; }
get() { awk -v s="[$1]" -v k="$2" '$0==s{f=1;next} /^\[/{f=0} f && $1==k {sub(/^[^"]*"/,""); sub(/".*$/,""); print; exit}' "$here/world.toml"; }
project="$(get site project)"; site="$(get site site)"; url="$(get site url)"

FAKER_WORLD="$here/world" FAKER_HOST=www.linkedin.com node "$faker/static.mjs" "$here/site" --site "$site"
[[ "${1:-}" == "--dry-run" ]] && { echo "▸ dry run: $here/site/public, not deployed"; exit 0; }
(cd "$here/site" && npx -y firebase-tools deploy --only hosting --project "$project")
echo "▸ the world is at $url; dev-browser's proxy fetches it from there"
