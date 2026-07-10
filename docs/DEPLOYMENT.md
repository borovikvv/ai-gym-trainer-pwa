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

# 3. Apply any new DB migrations
# Check supabase/ for new .sql files since last deploy
node supabase/apply-migration.mjs supabase/2026-XX-XX_new_migration.sql

# 4. Build frontend + type-check backend
npm run build

# 5. Restart the API server
pm2 restart ai-gym-trainer   # or: systemctl restart ai-gym-trainer

# 6. Regenerate planned workouts (if mesocycle/pattern logic changed)
node server/regeneratePlannedWorkouts.mjs --all-users
```

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
| `POST /api/workout-history` (save workout) | Next planned workout is auto-regenerated |
| `POST /api/planned-workouts/:id/generate` (manual "Обновить") | Single workout regenerated |
| `POST /api/planned-workouts/week` (replace calendar week) | All workouts in range regenerated |
| `PATCH /api/planned-workouts/:id` (move date) | Workout regenerated on new date |
| Code deploy | Run `regeneratePlannedWorkouts.mjs` manually |

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

### API returns 401
Check HTTP Basic Auth credentials. User ID must match `app_users.id`.

### PWA shows old data (even after deploy)
1. Hard refresh: iOS Safari → long-press reload → "Reload Without Content Blockers"
2. Or: remove PWA from home screen → re-add
3. Or: wait for service worker update (Workbox checks every ~24h)
