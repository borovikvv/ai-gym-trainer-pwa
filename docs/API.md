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
Returns coach memory (weekly balance, muscle group profiles, recommendations) + coach state.
### `POST /coach/next-set`
Recommends the next set (weight, reps, rest, action).
```json
// Request body:
{ "userId": "...", "exercise": {...}, "completedSets": [...],
  "remainingSets": 2, "pain": false,
  "context": { "coachState": {...}, "session": {...} } }
```
### `POST /coach/live-strategy`
Live strategy decision for the rest of the workout (hold/reduce/replace/finish).
### `POST /coach/workout-today`
Generate a coach-recommended workout for today (recovery accessory if readiness is low).

---

## Planned Workouts

### `GET /planned-workouts?userId=...`
Returns planned workouts (status ≠ cancelled, date ≥ today - 7 days). Ensures default workouts exist if none.
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
