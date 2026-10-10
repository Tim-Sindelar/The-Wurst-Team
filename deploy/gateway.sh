#!/usr/bin/env bash
# Sourced by deployment/cleanup scripts while holding the shared deployment lock.
root=${root:?Deployment root required}
release=${release:?Release directory required}
pr=${pr:-}
gateway_project=${GATEWAY_PROJECT:-wurst-gateway}
export EDGE_NETWORK=${EDGE_NETWORK:-wurst-edge}
export PRODUCTION_WEB_ALIAS=${PRODUCTION_WEB_ALIAS:-wurst-production-web}
export GATEWAY_CONFIG_DIR="$root/shared/gateway"
gateway_image=caddy:2.11.2-alpine@sha256:834468128c7696cec0ceea6172f7d692daf645ae51983ca76e39da54a97c570d

gateway_compose() {
  docker compose -p "$gateway_project" -f "$release/gateway.compose.yaml" "$@"
}
gateway_init() {
  if ! docker network inspect "$EDGE_NETWORK" >/dev/null 2>&1; then
    docker network create "$EDGE_NETWORK" >/dev/null
  fi
  mkdir -p "$GATEWAY_CONFIG_DIR/previews"
  if [[ ! -f "$GATEWAY_CONFIG_DIR/Caddyfile" ]]; then
    cp "$release/GatewayCaddyfile" "$GATEWAY_CONFIG_DIR/Caddyfile"
  fi
}
gateway_reload() {
  docker run --rm --entrypoint caddy \
    -e "PRODUCTION_WEB_ALIAS=$PRODUCTION_WEB_ALIAS" \
    -v "$GATEWAY_CONFIG_DIR:/etc/caddy:ro" "$gateway_image" \
    validate --config /etc/caddy/Caddyfile || return 1
  gateway_compose up -d --wait --wait-timeout 60 || return 1
  gateway_compose exec -T gateway caddy reload --config /etc/caddy/Caddyfile
}
set_preview_route() {
  local route="$GATEWAY_CONFIG_DIR/previews/pr-$pr.caddy"
  if [[ -f "$route" ]]; then cp "$route" "$route.previous"; fi
  cat > "$route.next" <<EOF
redir /pr/$pr /pr/$pr/ 308
handle_path /pr/$pr/* {
    reverse_proxy $WEB_ALIAS:8080
}
EOF
  mv "$route.next" "$route"
  if gateway_reload; then
    rm -f "$route.previous"
  else
    if [[ -f "$route.previous" ]]; then mv "$route.previous" "$route"; else rm -f "$route"; fi
    gateway_reload || true
    return 1
  fi
}
