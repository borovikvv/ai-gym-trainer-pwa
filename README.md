# AI Gym Trainer PWA

Adaptive coaching progressive web app for strength training. Russian-language UI.

The app computes a personalized mesocycle (loading → accumulation → intensification → deload), tracks volume landmarks (MEV / MAV / MRV per muscle group), estimates 1RM via the Helms/RTS formula, and adapts each next workout based on readiness, fatigue, pain history, and progression.

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript 6 (strict), Vite 8, vite-plugin-pwa 1.3 |
| Backend | Node.js (ESM), Express 5, pg 8 — **fully TypeScript, strict mode** |
| Shared | `shared/types.ts` — single source of truth for cross-stack contracts |
| DB / Auth | PostgreSQL (local) + Supabase (optional fallback) |
| Tests | Vitest 4 + Testing Library + jsdom (474 tests) |
| Lint | ESLint 10 + typescript-eslint 8 (type-checked, 0 errors) |
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

## Documentation

| Document | Description |
|----------|-------------|
| [docs/API.md](docs/API.md) | All API endpoints with request/response shapes |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Deploy steps, regeneration triggers, troubleshooting |

## Database migrations

Migrations live in `supabase/` as plain SQL files. Apply with:

```bash
node supabase/apply-migration.mjs supabase/2026-06-15_quality_score.sql
```

The server does NOT run DDL on startup — migrations must be applied out-of-band during deploy.

## Project structure

```
src/
  pages/             Page components (CoachHomePage, GymPage, PlanPage, SimplePages)
  components/        UI components (CoachHome, GymScreen, ProgressScreen, etc.)
    ui/              Shared UI primitives (HeroStatus, MetricPair, SectionList, InfoHint, ...)
  hooks/             React hooks (useWorkoutSession, useProgramData, usePlannedWorkouts, ...)
  contexts/          React contexts (NavigationContext, CoachContext, ProgramContext)
  domain/            Pure business logic (e1RM, mesocycle, progression, readinessCheckIn, ...)
  data/              API clients and repositories (programApi, workoutApi, ...)
  lib/               Shared utilities (format, muscleGroups, offlineQueue)

server/
  routes/            HTTP routes (coachRoutes, workoutRoutes, plannedWorkoutRoutes, ...)
  services/          Service layer (programService, workoutService, plannedWorkoutService, ...)
  dbClient.ts        Shared DbClient interface for pg
  coachState.ts      Coach state computation (readiness, recovery, mesocycle)
  coachMemory.ts     Coach memory (weekly balance, muscle profiles)
  coachDecision.ts   Coach decision engine (priority/avoid muscle groups)
  coachEngine.ts     Live set recommendations (next set, rest, weight)
  coachBrain.ts      Live strategy decisions (LLM-powered, falls back to rules)
  coachPlanner.ts    Post-workout plan adjustment (rules + LLM)
  coachDebrief.ts    Post-workout quality scoring and debrief
  mesocycle.ts       Stateless adaptive mesocycle engine (loading/deload)
  volumeLandmarks.ts MEV/MAV/MRV per muscle group, phase-adjusted
  plannedWorkoutGenerator.ts
                     Generates planned workouts with pattern rotation
  utils.ts           Shared server utilities (normalize, groupBy, date helpers)
  regeneratePlannedWorkouts.mjs
                     Admin script: regenerate all future planned workouts

shared/
  types.ts           Cross-stack type contracts (CoachState, WorkoutHistory, ...)

supabase/            SQL migrations + schema
public/exercise-guides/   Exercise images and JSON guides
scripts/             Asset generators (Python + Node)
```

## CI

GitHub Actions runs lint + type-check + tests + build on every push to `main` and `improvement/**`, and on every PR to `main`. See `.github/workflows/ci.yml`.

## Architecture notes

- **Stateless mesocycle.** `computeMesocycleState` derives the current cycle position from workout history + profile — no persistence required. Computed fresh on every coach state refresh.
- **Actual workout frequency.** `computeEffectiveWorkoutsPerWeek` (issue #77) computes `plannedWorkoutsPerWeek` from actual history (last 28 days), not from the questionnaire. This prevents mesocycle shifts when the user changes their questionnaire.
- **Two-pass coach state.** `loadCoachMemoryForUser` computes coachMemory (which needs a first-pass coachState) and then recomputes coachState with coachMemory available, so the mesocycle engine can use `weeklyBalance.muscleSetCounts` for early MRV triggers.
- **Pattern rotation.** `chooseTargetPattern` (issue #75) uses `previousGeneratedWorkouts` to rotate muscle groups between consecutive workouts (push/pull alternation). No more identical workouts back-to-back.
- **Light days.** `preferences.lightDays` (issue #78) — array of weekday names when the workout avoids large muscle groups (legs, back, chest). Useful when the user has another physical activity (e.g. boxing) on the same day.
- **Volume landmarks.** `server/volumeLandmarks.ts` defines per-muscle-group MEV/MAV/MRV, differentiated by `ageRecoveryProfile.phase` (teen/adult/mature_adult). `coachPlanner` uses these to clamp setsCount when weekly volume approaches MRV.
- **Deload.** When `mesocycle.isDeload` is true, both `coachPlanner` (live updates) and `plannedWorkoutGenerator` (calendar) apply `applyDeloadReduction` — reducing sets, weight, reps, and forcing 'easy' intensity.
- **e1RM.** `src/domain/estimatedOneRepMax.ts` uses the Helms/RTS formula (e1RM = weight × (1 + reps/40)) and computes trend via linear regression over the last 8 data points. Sparklines are rendered as inline SVG without chart libraries.
- **Strict TypeScript.** All backend files use `strict: true` (issue #36/#68). 184 `any` replaced with concrete types across 21 files.
