#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
root=${1:?Usage: cleanup-preview.sh DEPLOY_ROOT PR_NUMBER}
pr=${2:?PR_NUMBER required}
[[ "$root" == /* && "$root" != / && "$pr" =~ ^[1-9][0-9]*$ ]] || exit 1
release=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
project="${PREVIEW_PROJECT_PREFIX:-wurst-pr}-$pr"
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || exit 1
mkdir -p "$root/shared"
exec 9>"$root/shared/deploy.lock"
flock -w 600 9
# shellcheck source=gateway.sh
source "$release/gateway.sh"
route="$GATEWAY_CONFIG_DIR/previews/pr-$pr.caddy"
if [[ -f "$route" ]]; then
  mv "$route" "$route.removed"
  if gateway_reload; then
    rm "$route.removed"
  else
    mv "$route.removed" "$route"
    gateway_reload || true
    exit 1
  fi
fi
containers=$(docker ps -aq --filter "label=com.docker.compose.project=$project")
if [[ -n "$containers" ]]; then
  # IDs are whitespace-separated Docker IDs, not arbitrary input.
  # shellcheck disable=SC2086
  docker rm -fv $containers
fi
for network in "${project}_app" "${project}_data"; do
  if docker network inspect "$network" >/dev/null 2>&1; then docker network rm "$network"; fi
done
if docker volume inspect "$project-postgres" >/dev/null 2>&1; then docker volume rm "$project-postgres"; fi
rm -rf "$root/previews/pr-$pr"
echo "Removed preview PR $pr."
