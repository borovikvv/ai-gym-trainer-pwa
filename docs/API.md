# API Reference

All endpoints are prefixed with `/api`. Base URL: `http://<host>:8910` (default port 8910).

Auth: HTTP Basic Auth with `userId:password` (configured per user via `assertAllowedUserId` / `assertAllowedRowOwner`).

---

## Health

### `GET /health`
Check server + database connectivity.
```json
{ "ok": true, "dbTime": "2026-06-26T12:00:00.000Z" }
```

---

## Program Data

### `GET /program-data`
Returns all users, profiles, workout days, exercises, and exercise library.
```json
{
  "users": [...],
  "profiles": [...],
  "workoutDays": [...],
  "exerciseLibrary": [...]
}
```

### `PATCH /program-exercises/:id`
Update a program exercise (sets, reps, weight, rest, coach focus).
```json
// Request body (all optional):
{ "setsCount": 3, "repMin": 8, "repMax": 10, "targetWeight": 60,
  "weightStep": 2.5, "restSeconds": 90, "coachFocus": "..." }
```

---

## User Profiles

### `PATCH /user-profiles/:userId`
Update user profile (age, goal, workoutsPerWeek, preferences, etc.).
```json
// Request body:
{ "userId": "vyacheslav", "age": 43, "workoutsPerWeek": 3,
  "preferences": { "lightDays": ["Четверг"], "focusAreas": ["Грудь"] },
  "bannedExercises": [...], "notes": "..." }
```
Side effect: calls `ensureProgramMatchesWorkoutFrequency` (creates/removes program days).

---

## Workout History

### `GET /workout-history`
Returns all workout sessions (all users) with sets and progression events.
```json
[{ "id": "...", "userId": "...", "completedAt": "...", "totalVolume": 1775,
   "exercises": [...] }]
```

### `POST /workout-history`
Save a completed workout. Triggers:
1. `saveWorkoutDebriefRecommendation` — quality score + debrief
2. `markPlannedWorkoutCompleted` — marks the planned workout as done
3. `planAndApplyNextWorkout` — recalculates next program exercise
4. `regeneratePlannedWorkout` — regenerates the NEXT planned workout with updated mesocycle
```json
// Request body:
{ "id": "...", "userId": "...", "workoutDayId": "...", "completedAt": "...",
  "totalVolume": 1775, "readinessCheckIn": {...},
  "exercises": [{ "exerciseId": "...", "sets": [...], "nextRecommendedWeight": 60,
    "progressionType": "increase", "progressionReason": "..." }] }
// Response:
{ "coachPlan": {...}, "debrief": {...} }
```

---

## Workout Drafts

### `POST /workout-drafts`
Save a workout draft (autosave during active workout).
### `GET /workout-drafts/active?userId=...`
Load the most recent unsaved draft.
### `DELETE /workout-drafts/:id`
Delete a draft.

---

## Coach

### `GET /coach/state/:userId`
Returns current coach state (readiness, recovery, mesocycle, muscleGroups, exercises).
### `GET /coach/memory/:userId`
Returns coach memory (weekly balance, muscle group profiles, recommendations) + coach state + long-term `memoryFacts` and `goals` (Фаза 2).
### `POST /coach/next-set`
Recommends the next set (weight, reps, rest, action). Фаза 1: the rules baseline is refined by a FAST-tier LLM using the full live context (readiness, mesocycle, exercise history, session so far), clamped by user policy; falls back to rules on any LLM failure. Every decision is logged to `coach_decision_log`.
```json
// Request body:
{ "userId": "...", "sessionId": null, "exercise": {...}, "completedSets": [...],
  "remainingSets": 2, "pain": false,
  "sessionSoFar": [{ "exerciseId": "...", "exerciseName": "...", "sets": [...] }],
  "context": { "coachState": {...}, "session": {...} } }
// Response: { ok, recommendation: { action, recommendedWeight, ..., source: "llm"|"rules", detail }, coachState, source }
```
### `POST /coach/live-strategy`
Live strategy decision for the rest of the workout (hold/reduce/replace/finish). Kept as an explicit endpoint; the frontend no longer calls it per set (merged into `/coach/next-set`).
### `POST /coach/workout-today`
Generate a coach-recommended workout for today (recovery accessory if readiness is low).

---

## Long-term Memory & Goals (Фаза 2)

### `GET /coach/memory-facts/:userId?status=active|archived|all`
Persistent coach memory facts (injuries, load responses, preferences, constraints, milestones). Written by the post-workout LLM reflection and by the user.
### `POST /coach/memory-facts/:userId`
Add a user fact: `{ "kind": "injury|load_response|preference|constraint|milestone", "content": "..." }`.
### `PATCH /coach/memory-facts/:userId/:id`
`{ "content": "..." }` to edit, `{ "status": "archived" }` to archive (injuries can only be archived by the user, never by the LLM), `{ "confirm": true }` to confirm an LLM-noticed fact.
### `GET /coach/goals/:userId?status=active|all`
Multi-week goals the coach steers toward. `progress_note` is refreshed weekly from e1RM trends by the program review.
### `POST /coach/goals/:userId`
`{ "title": "...", "metric": "e1rm", "exerciseId": "bench-press", "targetValue": 80, "targetDate": "2026-09-01" }`.
### `PATCH /coach/goals/:userId/:id`
Update `title` / `status` (`active|achieved|paused|dropped`) / `targetValue` / `targetDate`.

---

## Planned Workouts

### `GET /planned-workouts?userId=...`
Returns planned workouts (status ≠ cancelled, date ≥ today - 7 days). Ensures default workouts exist if none. Фаза 2Б: lazily reconciles the schedule first — overdue uncompleted workouts become `missed` and all future coach workouts are cascade-regenerated around the actual gap. Response includes `reconciliation: { missedDates, regenerated }`.
### `POST /planned-workouts`
Create a single planned workout for a specific date.
```json
{ "userId": "...", "scheduledDate": "2026-06-28" }
```
### `POST /planned-workouts/week`
Replace all planned workouts in a date range with fresh-generated ones.
```json
{ "userId": "...", "dates": ["2026-06-28", "2026-06-30", "2026-07-02"],
  "rangeStart": "2026-06-28", "rangeEnd": "2026-07-02" }
```
### `PATCH /planned-workouts/:id`
Update scheduled date or status. If date changes → regenerates workout.
### `POST /planned-workouts/:id/generate`
Regenerate a single planned workout (manual "Обновить").
### `DELETE /planned-workouts/:id`
Cancel a planned workout (soft delete — sets status to 'cancelled').

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `app_users` | User accounts (id, name, initials, goal, streak) |
| `user_profiles` | Questionnaire data (age, workoutsPerWeek, preferences, lightDays, ...) |
| `exercise_library` | Exercise catalog (name, muscleGroup, metadata, default params) |
| `programs` | Training programs (one per user, status='active') |
| `program_days` | Days within a program (day A, day B, ...) |
| `program_exercises` | Exercises within program days (sets, reps, weight, coachFocus) |
| `planned_workouts` | Scheduled workouts on the calendar (date, status, coachReason) |
| `planned_workout_exercises` | Exercises within planned workouts |
| `workout_sessions` | Completed workout records (completedAt, totalVolume, qualityScore) |
| `workout_sets` | Individual sets within completed workouts |
| `progression_events` | Progression decisions per exercise (increase/hold/deload/pain) |
| `workout_drafts` | Autosaved workout drafts (active exercise index, logs) |
| `recommendations` | Coach decision logs + debriefs |
| `volume_landmark_overrides` | Per-user MEV/MRV adjustments (adaptive volume calibration) |
