# Deployment Guide

## Prerequisites

- Node.js 22+
- PostgreSQL 16+
- PM2 (or systemd) for process management
- Nginx/Caddy for HTTPS reverse proxy

## Environment

`.env` on the server:
```bash
DATABASE_URL=postgres://ai_gym_trainer:***@127.0.0.1:5432/ai_gym_trainer
API_PORT=8910
API_HOST=127.0.0.1
CORS_ORIGIN=https://trainer.borovikvv.ru
OPENAI_API_KEY=sk-...          # optional (falls back to rules)
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini       # base model for all tiers unless overridden below
# Optional per-tier model overrides (server/lib/llmClient.ts). Each falls back
# to OPENAI_MODEL, so a single-model setup keeps working without them.
# LLM_MODEL_FAST=...           # per-set advisor, narrator (latency-sensitive)
# LLM_MODEL_MID=...            # post-workout planning, memory reflection
# LLM_MODEL_SMART=...          # weekly program review, progress analysis
```

Every LLM call is logged to stdout as an `llm.call` activity event with
`{ caller, tier, model, promptTokens, completionTokens, latencyMs, ok }` —
use it to track real cost per tier.

## Deploy Steps

```bash
# 1. Pull latest code
cd /path/to/ai-gym-trainer-pwa
git pull origin main

# 2. Install dependencies
npm install

# 3a. Sync the DB schema — ALWAYS, every deploy (idempotent, see below)
node supabase/apply-migration.mjs supabase/schema.sql

# 3b. Apply pending data migrations — only new supabase/2026-*.sql files,
#     each tracked in schema_migrations
npm run migrate

# 4. Build frontend + type-check backend
npm run build

# 5. Restart the API server
pm2 restart ai-gym-trainer   # or: systemctl restart ai-gym-trainer

# 6. Regenerate planned workouts (if mesocycle/pattern logic changed)
node server/regeneratePlannedWorkouts.mjs --all-users

# 7. Verify the token reaches the API THROUGH Caddy (not just the direct port) — see below
```

## Headers reserved by infrastructure

Caddy (`:443`) sits in front of the app with HTTP Basic Auth and owns the
`Authorization` header — a request can carry only one Basic-auth credential,
so app code must never read or write `Authorization`. The API auth token
travels as `X-API-Token` instead (`server/auth.ts`, `src/data/apiAuth.ts`).
Issue #360: a client that reused `Authorization` for its own token collided
with Caddy's basic_auth and took prod down (401 on everything, including
static files) until rolled back. Any PR adding a client-side auth header must
check it against this list before merging.

## Verifying auth through Caddy (issue #360)

`curl 127.0.0.1:8910/...` only proves the API token works against the API
directly — it never proves the request survives Caddy's basic-auth in front
of it. Caddy's basic-auth password is only a bcrypt hash in the Caddyfile, so
this step can't be scripted into CI; run it by hand after every deploy that
touches auth headers or Caddy config:

```bash
BASIC_AUTH_USER=... BASIC_AUTH_PASS=... API_TOKEN=... \
  ./scripts/verify-caddy-auth.sh https://trainer.borovikvv.ru
```

Expects `OK` (HTTP 200 on `/api/program-data` through Caddy). A 401 here
means an app header is colliding with Caddy's basic-auth — see "Headers
reserved by infrastructure" above.

## Database schema

`supabase/schema.sql` is idempotent (`create table if not exists`,
`add column if not exists`, `drop trigger if exists` + recreate), so step 3a can
run on every deploy and is the mechanism that keeps prod columns in sync. It
carries DDL only — data migrations (exercise library seeds, backfills) live in
`supabase/2026-*.sql` and are applied by `npm run migrate`, once each.

Issue #194: three columns (`user_rating`, `pain_log`, `performed_at`) were added
to `schema.sql` without a delta file, prod never got them, and every workout
failed to save for two days. Running `schema.sql` on deploy is what prevents the
repeat — a delta file is a courtesy for review, not the sync mechanism.

`schema_migrations` is the bookkeeping table; `migrate.mjs` creates it on every
run. `npm run migrate` applies only new `supabase/2026-*.sql` files, in order,
each in its own transaction. On prod, where some files were applied by hand
before this mechanism existed, run `node supabase/migrate.mjs --baseline` once
(marks the current files as applied without running them), then deploy with
`npm run migrate`.

## When to regenerate planned workouts

After deploys that change workout generation logic:
- Mesocycle changes (issue #74, #77)
- Pattern rotation changes (issue #75)
- Light days feature (issue #78)
- Any change to `plannedWorkoutGenerator.ts` or `coachState.ts`

```bash
# Single user:
node server/regeneratePlannedWorkouts.mjs vyacheslav

# All users:
node server/regeneratePlannedWorkouts.mjs --all-users
```

## Automatic regeneration triggers

| Trigger | What happens |
|---------|-------------|
| `POST /api/workout-history` (save workout) | ALL future coach/auto workouts cascade-regenerated (Фаза 2Б, 14-day horizon) |
| `GET /api/planned-workouts` (app open) | Schedule reconciliation: overdue → `missed`, then cascade regeneration |
| `POST /api/planned-workouts/:id/generate` (manual "Обновить") | Single workout regenerated |
| `POST /api/planned-workouts/week` (replace calendar week) | All workouts in range regenerated |
| `PATCH /api/planned-workouts/:id` (move date) | Moved workout regenerated + cascade for the rest |
| Code deploy | Run `regeneratePlannedWorkouts.mjs` manually |

Notes (Фаза 2Б): user-composed workouts (`source='user'`) are never touched by
the cascade. A missed workout is not rescheduled — the future plan is rebuilt
around the actual gap instead.

## Backup

```bash
# Backup PostgreSQL
./scripts/backup-postgres.sh

# Backup is saved to /backups/ai_gym_trainer_YYYY-MM-DD.sql.gz
```

## Health Check

```bash
curl http://127.0.0.1:8910/health
# Expected: { "ok": true, "dbTime": "..." }
```

## Troubleshooting

### Mesocycle shows wrong week
1. Check `GET /api/coach/memory/vyacheslav` → `coachState.mesocycle.weekInCycle`
2. Check `GET /api/workout-history` → count sessions for the user
3. If sessions < expected → `loadRecentHistory` limit (should be 16, not 8)
4. If `plannedWorkoutsPerWeek` wrong → check `computeEffectiveWorkoutsPerWeek` (issue #77)

### Planned workouts stale after deploy
```bash
node server/regeneratePlannedWorkouts.mjs --all-users
```

### API returns 401 (or the browser keeps prompting for a login)
Most likely a header collision, not bad credentials — see "Headers reserved
by infrastructure" above. Run `scripts/verify-caddy-auth.sh` to confirm.
Otherwise check that `VITE_API_AUTH_TOKEN` (build-time) matches the server's
`API_AUTH_TOKEN`.

### PWA shows old data (even after deploy)
1. Hard refresh: iOS Safari → long-press reload → "Reload Without Content Blockers"
2. Or: remove PWA from home screen → re-add
3. Or: wait for service worker update (Workbox checks every ~24h)
