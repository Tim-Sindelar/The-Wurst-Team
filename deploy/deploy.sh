#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

sha=${1:?Usage: deploy.sh COMMIT_SHA [PR_NUMBER]}
pr=${2:-}
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo 'Invalid commit SHA' >&2; exit 1; }
[[ -z "$pr" || "$pr" =~ ^[1-9][0-9]*$ ]] || exit 1

release=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
environment_root=$(dirname "$(dirname "$release")")
root=$environment_root
project=${DEPLOY_PROJECT:-wurst-production}
export WEB_ALIAS=${PRODUCTION_WEB_ALIAS:-wurst-production-web}
if [[ -n "$pr" ]]; then
  root=$(dirname "$(dirname "$environment_root")")
  project="${PREVIEW_PROJECT_PREFIX:-wurst-pr}-$pr"
  export WEB_ALIAS="$project-web"
  export POSTGRES_VOLUME_NAME="$project-postgres"
  export SOCIAL_ENABLED=true
fi
app_port=${APP_PORT:-8081}
preview_port=${PREVIEW_PORT:-18080}
[[ "$project" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || exit 1
[[ "$app_port" =~ ^[0-9]+$ && "$preview_port" =~ ^[0-9]+$ ]] || exit 1
[[ "$(cat "$release/SHA")" == "$sha" ]] || { echo 'Release SHA mismatch' >&2; exit 1; }

mkdir -p "$root/shared" "$environment_root/shared" "$environment_root/backups"
exec 9>"$root/shared/deploy.lock"
flock -w 600 9

env_file="$environment_root/shared/production.env"
if [[ ! -f "$env_file" ]]; then
  password=$(openssl rand -hex 32)
  printf 'POSTGRES_PASSWORD=%s\n' "$password" > "$env_file"
  unset password
  echo 'Created VM-only database credentials.'
fi
chmod 600 "$env_file"
# The password is embedded in DATABASE_URL. Reject placeholders and unsafe URL characters.
if ! grep -Eq '^POSTGRES_PASSWORD=[a-zA-Z0-9]{32,}$' "$env_file"; then
  echo 'POSTGRES_PASSWORD must contain at least 32 alphanumeric characters.' >&2
  exit 1
fi

compose() {
  IMAGE_TAG="$sha" docker compose --project-name "$project" --env-file "$env_file" \
    -f "$release/compose.yaml" "$@"
}
previous=""
if [[ -L "$environment_root/current" ]]; then
  previous=$(readlink -f "$environment_root/current")
  [[ -f "$previous/SHA" ]] || { echo 'Previous release is missing.' >&2; exit 1; }
fi
apps_changed=false
preview="${project}-preview"
# shellcheck source=gateway.sh
source "$release/gateway.sh"
public_url="http://127.0.0.1:$app_port"
if [[ -n "$pr" ]]; then public_url="$public_url/pr/$pr"; fi

cleanup() {
  docker rm -fv "$preview" >/dev/null 2>&1 || true
}
rollback() {
  status=$?
  trap - ERR
  set +e
  echo 'Deployment failed. Keeping the database and attempting application rollback.' >&2
  compose logs --tail 60 backend caddy
  cleanup
  if [[ "$apps_changed" == true ]]; then
    if [[ -n "$previous" && -f "$previous/SHA" ]]; then
      old_sha=$(cat "$previous/SHA")
      if IMAGE_TAG="$old_sha" docker compose --project-name "$project" --env-file "$env_file" \
        -f "$previous/compose.yaml" up -d --wait --wait-timeout 120 backend caddy; then
        bash "$previous/smoke.sh" "$public_url" || echo 'Rollback smoke checks failed.' >&2
      else
        echo 'Application rollback failed; inspect the VM before retrying.' >&2
      fi
    else
      compose stop caddy backend
    fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap rollback ERR
trap 'false' TERM INT

# Fail before migrations if another app owns the production port.
while read -r name ports; do
  [[ "$ports" == *":${app_port}->"* ]] || continue
  owner=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$name")
  [[ "$owner" == "$gateway_project" ]] && continue
  echo "Port $app_port is owned by $name. Free that port before deploying." >&2
  exit 1
done < <(docker ps --format '{{.Names}} {{.Ports}}')

cd "$release"
sha256sum --check SHA256SUMS
compose config --quiet
gzip -dc images.tar.gz | docker load
docker run --rm --entrypoint caddy "wurst-web:$sha" validate --config /etc/caddy/Caddyfile
gateway_init
compose up -d --wait --wait-timeout 120 db

# Every migration attempt gets a backup; schema rollback is deliberately not automatic.
backup="$environment_root/backups/$(date -u +%Y%m%dT%H%M%SZ)-$(basename "$release").dump"
compose exec -T db pg_dump -U hackathon -d hackathon --format=custom > "$backup.partial"
compose exec -T db pg_restore --list < "$backup.partial" > /dev/null
mv "$backup.partial" "$backup"
compose run --rm --no-deps backend alembic upgrade head
compose run --rm --no-deps backend python -m app.features.campus_map.importer --if-empty
if [[ -n "$pr" ]]; then
  echo 'Seeding demo study spaces for the PR preview.'
  compose run --rm --no-deps backend python -m app.features.reservations.seed > /dev/null
fi

apps_changed=true
compose up -d --wait --wait-timeout 120 backend
cleanup
docker run -d --name "$preview" --network "${project}_app" \
  -p "127.0.0.1:${preview_port}:8080" "wurst-web:$sha" > /dev/null
bash "$release/smoke.sh" "http://127.0.0.1:$preview_port"
cleanup

compose up -d --wait --wait-timeout 120 caddy
if [[ -n "$pr" ]]; then set_preview_route; else gateway_reload; fi
bash "$release/smoke.sh" "$public_url"

# Advance the success pointer only after all checks; retain previous releases/images.
ln -sfn "$release" "$environment_root/current.next"
mv -Tf "$environment_root/current.next" "$environment_root/current"
trap - ERR
rm "$release/images.tar.gz"
echo "Deployed $sha. Database backup: $backup"
