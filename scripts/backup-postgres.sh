#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/root/ai-gym-trainer-pwa"
ENV_FILE="$APP_DIR/.env.local"
BACKUP_DIR="/root/backups/ai-gym-trainer"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is not set in $ENV_FILE" >&2
  exit 1
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
out="$BACKUP_DIR/ai_gym_trainer_${timestamp}.dump"
latest="$BACKUP_DIR/latest.dump"

pg_dump --format=custom --no-owner --no-acl --file="$out" "$DATABASE_URL"
chmod 600 "$out"
ln -sfn "$out" "$latest"

find "$BACKUP_DIR" -type f -name 'ai_gym_trainer_*.dump' -mtime +"$RETENTION_DAYS" -delete

pg_restore --list "$out" >/dev/null
bytes="$(stat -c%s "$out")"
echo "Backup created: $out ($bytes bytes)"
