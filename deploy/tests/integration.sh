#!/usr/bin/env bash
# Run after building wurst-backend:SHA and wurst-web:SHA. Uses disposable local data.
set -Eeuo pipefail
sha=${1:?Usage: integration.sh COMMIT_SHA [APP_BASE_PATH]}
base=${2:-/}
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || exit 1
pr=123
if [[ "$base" != / ]]; then
  [[ "$base" =~ ^/pr/([1-9][0-9]*)/$ ]] || exit 1
  pr=${BASH_REMATCH[1]}
fi
scripts=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
scratch=$(mktemp -d)
export DEPLOY_PROJECT="wurst-test-$$"
export GATEWAY_PROJECT="$DEPLOY_PROJECT-gateway"
export EDGE_NETWORK="$DEPLOY_PROJECT-edge"
export PRODUCTION_WEB_ALIAS="$DEPLOY_PROJECT-web"
export PREVIEW_PROJECT_PREFIX="$DEPLOY_PROJECT-pr"
export POSTGRES_VOLUME_NAME="$DEPLOY_PROJECT-postgres"
export APP_BIND=127.0.0.1 APP_PORT=18081 PREVIEW_PORT=18082
preview_project="$PREVIEW_PROJECT_PREFIX-$pr"
prod_sha=$(printf '%s-prod' "$DEPLOY_PROJECT" | sha256sum | cut -c1-40)
next_sha=$(printf '%s-next' "$DEPLOY_PROJECT" | sha256sum | cut -c1-40)
pr_sha=$(printf '%s-pr' "$DEPLOY_PROJECT" | sha256sum | cut -c1-40)
bad_sha=$(printf '%s-broken' "$DEPLOY_PROJECT" | sha256sum | cut -c1-40)
foreign="$DEPLOY_PROJECT-foreign"
router="$DEPLOY_PROJECT-router"
url="http://127.0.0.1:$APP_PORT"
cleanup() {
  set +e
  docker rm -fv "$foreign" "$router" "$DEPLOY_PROJECT-preview" "$preview_project-preview" >/dev/null 2>&1
  for project in "$DEPLOY_PROJECT" "$GATEWAY_PROJECT" "$preview_project"; do
    containers=$(docker ps -aq --filter "label=com.docker.compose.project=$project")
    if [[ -n "$containers" ]]; then
      # shellcheck disable=SC2086
      docker rm -fv $containers >/dev/null
    fi
    docker network rm "${project}_app" "${project}_data" >/dev/null 2>&1
  done
  docker network rm "$EDGE_NETWORK" >/dev/null 2>&1
  docker volume rm "$POSTGRES_VOLUME_NAME" "$preview_project-postgres" >/dev/null 2>&1
  for tag in "$prod_sha" "$next_sha" "$pr_sha" "$bad_sha"; do
    docker image rm "wurst-backend:$tag" "wurst-web:$tag" >/dev/null 2>&1
  done
  rm -rf "$scratch"
}
trap cleanup EXIT
package() {
  local tag=$1 destination=$2
  mkdir -p "$destination"
  cp "$scripts/"*.yaml "$scripts/"*.sh "$scripts/GatewayCaddyfile" "$destination/"
  printf '%s\n' "$tag" > "$destination/SHA"
  docker save "wurst-backend:$tag" "wurst-web:$tag" | gzip -1 > "$destination/images.tar.gz"
  (cd "$destination" && sha256sum ./*.yaml ./*.sh GatewayCaddyfile SHA images.tar.gz > SHA256SUMS)
}
check_name() {
  curl --fail --silent --show-error --max-time 10 \
    -H 'X-User-Id: persistence-test@example.invalid' "$1/api/v1/me" |
    python3 -c 'import json,sys; assert json.load(sys.stdin)["name"] == sys.argv[1]' "$2"
}
save_name() {
  curl --fail --silent --show-error --max-time 10 -X PATCH \
    -H 'X-User-Id: persistence-test@example.invalid' -F "name=$2" "$1/api/v1/me" >/dev/null
}
check_spaces() {
  curl --fail --silent --show-error --max-time 10 \
    -H 'X-User-Id: persistence-test@example.invalid' "$1/api/v1/spaces" |
    python3 -c '
import json, sys
spaces = json.load(sys.stdin)["spaces"]
assert len(spaces) == int(sys.argv[1]), spaces
for space in spaces:
    assert space["name"].startswith("Demo:"), space
    assert space["total_seats"] == space["free_seats"] == 4, space
    assert space["is_open"], space
' "$2"
}
# Test both frontend prefixes regardless of whether CI is a push or PR run.
if [[ "$base" == / ]]; then
  docker tag "wurst-web:$sha" "wurst-web:$prod_sha"
  docker build --build-arg "APP_BASE_PATH=/pr/$pr/" -f frontend/Dockerfile -t "wurst-web:$pr_sha" .
else
  docker tag "wurst-web:$sha" "wurst-web:$pr_sha"
  docker build --build-arg APP_BASE_PATH=/ -f frontend/Dockerfile -t "wurst-web:$prod_sha" .
fi
for tag in "$prod_sha" "$next_sha" "$pr_sha" "$bad_sha"; do
  docker tag "wurst-backend:$sha" "wurst-backend:$tag"
done
docker tag "wurst-web:$prod_sha" "wurst-web:$next_sha"
first="$scratch/releases/first"
second="$scratch/releases/second"
broken="$scratch/releases/broken"
preview="$scratch/previews/pr-$pr/releases/first"
package "$prod_sha" "$first"
# Refuse an unrelated app's port without stopping it or starting a database.
docker run -d --name "$foreign" -p "127.0.0.1:$APP_PORT:8080" "wurst-web:$prod_sha" >/dev/null
if bash "$first/deploy.sh" "$prod_sha"; then echo 'Expected port conflict.' >&2; exit 1; fi
[[ "$(docker inspect --format '{{.State.Running}}' "$foreign")" == true ]]
[[ -z "$(docker ps -aq --filter "label=com.docker.compose.project=$DEPLOY_PROJECT")" ]]
docker rm -fv "$foreign" >/dev/null
bash "$first/deploy.sh" "$prod_sha"
[[ "$(readlink -f "$scratch/current")" == "$first" ]]
[[ "$(stat -c '%a' "$scratch/shared/production.env")" == 600 ]]
# Simulate the independently managed router: /ar stays there, the app gets everything else.
cat > "$scratch/RouterCaddyfile" <<ROUTER
:18083 {
    bind 127.0.0.1
    redir /ar /ar/ 308
    handle_path /ar/* {
        respond "AR service" 200
    }
    handle {
        reverse_proxy localhost:$APP_PORT
    }
}
ROUTER
docker run -d --name "$router" --network host -v "$scratch/RouterCaddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.11.2-alpine@sha256:834468128c7696cec0ceea6172f7d692daf645ae51983ca76e39da54a97c570d >/dev/null
url=http://127.0.0.1:18083
curl --fail --silent --show-error --retry 10 --retry-all-errors --retry-delay 1 "$url/ar/" > "$scratch/ar-response"
[[ "$(cat "$scratch/ar-response")" == 'AR service' ]]
save_name "$url" 'Persists across releases'
package "$next_sha" "$second"
bash "$second/deploy.sh" "$next_sha"
check_name "$url" 'Persists across releases'
package "$pr_sha" "$preview"
bash "$preview/deploy.sh" "$pr_sha" "$pr"
[[ "$(readlink -f "$scratch/previews/pr-$pr/current")" == "$preview" ]]
check_spaces "$url/pr/$pr" 2
check_spaces "$url" 0
save_name "$url/pr/$pr" 'Isolated preview profile'
check_name "$url/pr/$pr" 'Isolated preview profile'
check_name "$url" 'Persists across releases'
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$url/pr/$pr")" == 308 ]]
asset=$(curl -fsS "$url/pr/$pr/" | python3 -c 'import re,sys; print(re.search(r"src=\"(/pr/[0-9]+/assets/[^\"]+\.js)\"",sys.stdin.read())[1])')
curl -fsS "$url$asset" > "$scratch/preview.js"
[[ -s "$scratch/preview.js" ]]
if grep -qi '<!doctype html>' "$scratch/preview.js"; then echo 'Asset returned HTML.' >&2; exit 1; fi
# Candidate with valid Caddy configuration and deliberately broken responses.
mkdir -p "$scratch/broken-image"
printf ':8080 {\n\trespond "Broken release" 503\n}\n' > "$scratch/broken-image/Caddyfile"
printf 'FROM wurst-web:%s\nCOPY Caddyfile /etc/caddy/Caddyfile\n' "$prod_sha" > "$scratch/broken-image/Dockerfile"
docker build -q -t "wurst-web:$bad_sha" "$scratch/broken-image" >/dev/null
package "$bad_sha" "$broken"
if bash "$broken/deploy.sh" "$bad_sha"; then echo 'Expected broken release failure.' >&2; exit 1; fi
[[ "$(readlink -f "$scratch/current")" == "$second" ]]
backend=$(docker ps -q --filter "label=com.docker.compose.project=$DEPLOY_PROJECT" --filter 'label=com.docker.compose.service=backend')
[[ "$(docker inspect --format '{{.Config.Image}}' "$backend")" == "wurst-backend:$next_sha" ]]
bash "$scripts/smoke.sh" "$url"
check_name "$url" 'Persists across releases'
check_name "$url/pr/$pr" 'Isolated preview profile'
[[ "$(find "$scratch/backups" -name '*.dump' | wc -l)" -eq 3 ]]
bash "$scripts/cleanup-preview.sh" "$scratch" "$pr"
bash "$scripts/cleanup-preview.sh" "$scratch" "$pr"
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$url/pr/$pr/")" == 404 ]]
if docker volume inspect "$preview_project-postgres" >/dev/null 2>&1; then echo 'Preview volume remains.' >&2; exit 1; fi
[[ ! -d "$scratch/previews/pr-$pr" ]]
check_name "$url" 'Persists across releases'
[[ "$(curl -fsS "$url/ar/")" == 'AR service' ]]
echo 'Integration passed: port conflict, production update/persistence, backups/rollback, shared /ar router, PR routing/assets, preview-only demo seeding, isolated data, and idempotent preview cleanup.'
