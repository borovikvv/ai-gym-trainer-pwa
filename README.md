# AI Gym Trainer PWA

Adaptive coaching progressive web app for strength training. Russian-language UI.

The app computes a personalized mesocycle (loading → accumulation → intensification → deload), tracks volume landmarks (MEV / MAV / MRV per muscle group), estimates 1RM via the Helms/RTS formula, and adapts each next workout based on readiness, fatigue, pain history, and progression.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript 6, Vite 8, Tailwind 4, vite-plugin-pwa 1.3 |
| Backend | Node.js (ESM, `--env-file`), Express 5, pg 8 — **migrating to TypeScript via tsx** |
| Shared | `shared/types.ts` — single source of truth for cross-stack contracts |
| DB / Auth | PostgreSQL (local) + Supabase (optional fallback) |
| Tests | Vitest 4 + Testing Library + jsdom |
| Lint | ESLint 10 + typescript-eslint 8 (type-checked) |
| LLM | OpenAI-compatible (optional, for post-workout coach planning; falls back to rules) |

## Development

```bash
# Install
npm install

# Configure
cp .env.example .env.local
# Fill in DATABASE_URL, VITE_API_BASE_URL, OPENAI_API_KEY (optional)

# Run frontend (port 5173)
npm run dev

# Run backend (port 8910)
npm run api

# Run tests
npm test

# Lint
npm run lint

# Type-check (also part of 'npm run build')
npx tsc -b

# Production build
npm run build
```

## Database migrations

Migrations live in `supabase/` as plain SQL files. Apply with:

```bash
node supabase/apply-migration.mjs supabase/2026-06-15_quality_score.sql
```

The server does NOT run DDL on startup — migrations must be applied out-of-band during deploy.

## Project structure

```
src/
  components/        UI components (CoachHome, GymScreen, ProgressScreen, etc.)
    ui/              Shared UI primitives (HeroStatus, MetricPair, SectionList, ...)
  hooks/             React hooks (useWorkoutSession, useProgramData, ...)
  domain/            Pure business logic (e1RM, mesocycle, progression, ...)
  data/              API clients and repositories (programApi, workoutApi, ...)
  lib/               Shared utilities (format, muscleGroups) — mirrors server/lib

server/
  routes/            HTTP routes (coachRoutes, workoutRoutes, ...)
  services/          Service layer (programService, workoutService, ...)
  lib/               Shared server utilities (format, muscleGroups)
  coach*.js          Coach domain logic (decision, engine, memory, planner, state, ...)
  mesocycle.js       Stateless adaptive mesocycle engine
  volumeLandmarks.js MEV/MAV/MRV per muscle group, phase-adjusted
  plannedWorkoutGenerator.js
                     Generates planned workouts for the calendar

supabase/            SQL migrations
public/exercise-guides/   Exercise images and JSON guides
scripts/             Asset generators (Python + Node)
```

## CI

GitHub Actions runs lint + type-check + tests + build on every push to `main` and `improvement/**`, and on every PR to `main`. See `.github/workflows/ci.yml`.

## Architecture notes

- **Stateless mesocycle.** `computeMesocycleState` derives the current cycle position from workout history + profile — no persistence required. Computed fresh on every coach state refresh.
- **Two-pass coach state.** `loadCoachMemoryForUser` computes coachMemory (which needs a first-pass coachState) and then recomputes coachState with coachMemory available, so the mesocycle engine can use `weeklyBalance.muscleSetCounts` for early MRV triggers. All endpoints that return coachState go through this two-pass path.
- **Volume landmarks.** `server/volumeLandmarks.js` defines per-muscle-group MEV/MAV/MRV, differentiated by `ageRecoveryProfile.phase` (teen/adult/mature_adult). `coachPlanner` uses these to clamp setsCount when weekly volume approaches MRV.
- **Deload.** When `mesocycle.isDeload` is true, both `coachPlanner` (live updates) and `plannedWorkoutGenerator` (calendar) apply `applyDeloadReduction` — reducing sets, weight, reps, and forcing 'easy' intensity.
- **e1RM.** `src/domain/estimatedOneRepMax.ts` uses the Helms/RTS formula (e1RM = weight × (1 + reps/40)) and computes trend via linear regression over the last 8 data points. Sparklines are rendered as inline SVG without chart libraries.
