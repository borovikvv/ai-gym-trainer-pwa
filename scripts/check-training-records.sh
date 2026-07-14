#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/root/ai-gym-trainer-pwa"
ENV_FILE="$APP_DIR/.env.local"
OUT_DIR="/root/training-record-checks"
mkdir -p "$OUT_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

DATE=$(date +%Y-%m-%d)
OUT_FILE="$OUT_DIR/check-$DATE.txt"

{
  echo "=== Training record check: $DATE ==="
  echo
  echo "--- Count by type ---"
  psql "$DATABASE_URL" -c "
    SELECT recommendation_type, count(*)
    FROM recommendations
    GROUP BY recommendation_type
    ORDER BY recommendation_type;"
  echo
  echo "--- Last 3 training_record (created_at + body) ---"
  psql "$DATABASE_URL" -c "
    SELECT created_at, body
    FROM recommendations
    WHERE recommendation_type = 'training_record'
    ORDER BY created_at DESC
    LIMIT 3;"
  echo
  echo "--- Summary ---"
  COUNT=$(psql "$DATABASE_URL" -t -A -c "
    SELECT count(*) FROM recommendations
    WHERE recommendation_type = 'training_record';")
  echo "Total training_record: $COUNT"
  if [[ "$COUNT" -eq 0 ]]; then
    echo "WARNING: still 0 records — Phase 1 not triggered yet"
  fi
} > "$OUT_FILE" 2>&1

echo "Saved: $OUT_FILE"
