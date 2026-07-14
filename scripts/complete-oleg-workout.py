#!/usr/bin/env python3
"""Complete Oleg's workout from the current draft via API."""
import json, os, sys, urllib.request, urllib.error

db_url = os.environ.get('DATABASE_URL')
api_url = os.environ.get('API_BASE_URL', 'http://127.0.0.1:8910')
if not db_url:
    print("DATABASE_URL not set")
    sys.exit(1)

import subprocess

# 1. Get the current draft from DB
result = subprocess.run(
    ["psql", db_url, "-t", "-A",
     "-c", "SELECT id, user_id, workout_day_id, payload FROM public.workout_drafts WHERE id = 'oleg:planned-oleg-2026-07-12-1782742998910';"],
    capture_output=True, text=True
)
row = result.stdout.strip()
if not row:
    print("Draft not found")
    sys.exit(1)

parts = row.split("|", 2)
draft_id = parts[0]
user_id = parts[1]
workout_day_id = parts[2] if len(parts) > 2 else ""

# Get payload separately
result2 = subprocess.run(
    ["psql", db_url, "-t", "-A",
     "-c", "SELECT payload FROM public.workout_drafts WHERE id = 'oleg:planned-oleg-2026-07-12-1782742998910';"],
    capture_output=True, text=True
)
draft_payload = json.loads(result2.stdout.strip())
logs = draft_payload.get('logs', {})

# Get planned workout name
result3 = subprocess.run(
    ["psql", db_url, "-t", "-A",
     "-c", "SELECT workout_day_name FROM public.planned_workouts WHERE id = 'planned-oleg-2026-07-12-1782742998910';"],
    capture_output=True, text=True
)
workout_day_name = result3.stdout.strip() or 'персональная тренировка'

# 2. Build exercise entries from draft logs
# Map exercise IDs to readable names
EXERCISE_NAMES = {
    'cable-curl': 'Сгибания на бицепс в кроссовере',
    'dumbbell-fly': 'Разводка гантелей лёжа',
    'seated-calf-raise': 'Подъёмы на носки сидя',
    'plank-extra-1783873952645': 'Планка',
    'incline-db-press-extra-1783873645603': 'Жим гантелей на наклонной',
    'arnold-press-alternative-жим-в-тренажёре-replacement-1783870998451': 'Жим в тренажёре (плечи)',
}

exercises = []
total_volume = 0

for eid in ['cable-curl', 'dumbbell-fly', 'seated-calf-raise',
            'plank-extra-1783873952645', 'incline-db-press-extra-1783873645603',
            'arnold-press-alternative-жим-в-тренажёре-replacement-1783870998451']:
    log = logs.get(eid)
    if not log:
        continue

    completed_sets = [s for s in log.get('sets', []) if s.get('completed')]
    if not completed_sets:
        continue

    # Calculate volume
    volume = sum(s.get('weight', 0) * s.get('reps', 0) for s in completed_sets)
    total_volume += volume

    last_set = completed_sets[-1]
    next_weight = max(0, float(last_set.get('weight', 0)))

    exercises.append({
        "exerciseId": eid,
        "exerciseName": EXERCISE_NAMES.get(eid, eid),
        "pain": log.get('pain', False),
        "sets": [{
            "weight": float(s.get('weight', 0)),
            "reps": int(s.get('reps', 0)),
            "rpe": int(s.get('rpe', 7)),
            "completed": True
        } for s in completed_sets],
        "nextRecommendedWeight": next_weight,
        "progressionType": "hold",
        "progressionReason": ""
    })

# 3. Build workout entry
now_iso = "2026-07-12T17:30:00.000Z"
session_id = f"oleg-planned-oleg-2026-07-12-1782742998910-{now_iso.replace(':', '').replace('.', '').replace('Z', 'Z')}"

entry = {
    "id": session_id,
    "userId": user_id,
    "workoutDayId": workout_day_id,
    "workoutDayName": workout_day_name,
    "completedAt": now_iso,
    "totalVolume": round(total_volume, 1),
    "readinessCheckIn": None,
    "qualityScore": None,
    "exercises": exercises
}

# 4. POST to API
payload = json.dumps(entry).encode('utf-8')
req = urllib.request.Request(
    f"{api_url}/api/workout-history",
    data=payload,
    headers={"Content-Type": "application/json"},
    method="POST"
)

try:
    with urllib.request.urlopen(req, timeout=30) as resp:
        response_data = json.loads(resp.read())
        print(f"HTTP {resp.status}")
        print(f"coachPlan: {response_data.get('coachPlan', {}).get('summary', 'none')}")
        print(f"debrief: {json.dumps(response_data.get('debrief'), ensure_ascii=False, indent=2)}")
except urllib.error.HTTPError as e:
    body = e.read().decode()
    print(f"HTTP {e.code}: {body}")
    sys.exit(1)

# 5. Show saved workout
print("\n=== Сохранённая тренировка ===")
print(f"Сессия: {session_id}")
print(f"Объём: {round(total_volume, 1)} кг")
print()
for ex in exercises:
    sets_str = " | ".join([f"{s['weight']}×{s['reps']}" if ex['exerciseId'] != 'plank-extra-1783873952645' else f"{s['reps']} сек" for s in ex['sets']])
    print(f"{ex['exerciseName']}: {sets_str}")
