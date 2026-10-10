#!/usr/bin/env bash
set -Eeuo pipefail

base_url=${1:-http://127.0.0.1:8081}
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT

curl --fail --silent --show-error --max-time 3 --retry 10 --retry-all-errors \
  --retry-max-time 20 --retry-delay 1 -o "$scratch/ready" "$base_url/api/v1/ready"
python3 -c 'import json,sys; r=json.load(sys.stdin); assert r == {"status":"ok","database":"connected"}, r' < "$scratch/ready"

for path in / /profile /map; do
  curl --fail --silent --show-error --max-time 10 "$base_url$path" -o "$scratch/page"
  grep -qi '<html' "$scratch/page"
done

for check in '/api/v1/me:401' '/api/deployment-nonexistent:404'; do
  path=${check%:*}
  expected=${check##*:}
  actual=$(curl --silent --show-error --max-time 10 -o /dev/null -w '%{http_code}' "$base_url$path")
  if [[ "$actual" != "$expected" ]]; then
    echo "Smoke check failed: $path returned $actual, expected $expected" >&2
    exit 1
  fi
done

# Local-only test: these headers must pass through Caddy, not be synthesized.
curl --fail --silent --show-error --max-time 10 \
  -H 'X-User-Id: deployment-smoke@example.invalid' \
  -H 'X-User-Name: Deployment%20smoke' "$base_url/api/v1/me" |
  python3 -c 'import json,sys; r=json.load(sys.stdin); assert r["email"] == "deployment-smoke@example.invalid" and r["name"] == "Deployment smoke", r'

# The campus map must have seeded data and the floor plans built into the image.
for path in /api/v1/map/style /api/v1/map/navigation /api/v1/map/floors/index.json; do
  curl --fail --silent --show-error --max-time 10 "$base_url$path" |
    python3 -c 'import json,sys; data=json.load(sys.stdin); assert isinstance(data, dict) and data'
done

echo "Smoke checks passed: $base_url"
