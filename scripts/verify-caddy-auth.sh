#!/usr/bin/env bash
# Deploy verification for issue #360: confirm the client token reaches the API
# THROUGH Caddy's basic-auth, not just directly against 127.0.0.1:8910/8900.
# A direct curl to the API port always looks fine even when Caddy's
# basic_auth and the client's X-API-Token collide on the same request.
#
# Caddy's basic-auth password only exists as a bcrypt hash in the Caddyfile,
# so it can't be read back — run this by hand after each deploy with the
# real credentials:
#
#   BASIC_AUTH_USER=... BASIC_AUTH_PASS=... API_TOKEN=... \
#     ./scripts/verify-caddy-auth.sh [https://trainer.borovikvv.ru]
set -euo pipefail

URL="${1:-https://trainer.borovikvv.ru}"

: "${BASIC_AUTH_USER:?Set BASIC_AUTH_USER (Caddy basic-auth username)}"
: "${BASIC_AUTH_PASS:?Set BASIC_AUTH_PASS (Caddy basic-auth password)}"
: "${API_TOKEN:?Set API_TOKEN (API_AUTH_TOKEN value, sent as X-API-Token)}"

CODE=$(curl -s -o /dev/null -w '%{http_code}' \
  -u "$BASIC_AUTH_USER:$BASIC_AUTH_PASS" \
  -H "X-API-Token: $API_TOKEN" \
  "$URL/api/program-data")

if [ "$CODE" = "200" ]; then
  echo "OK: $URL/api/program-data -> 200 through Caddy basic-auth"
else
  echo "FAIL: $URL/api/program-data -> $CODE (expected 200)" >&2
  exit 1
fi
