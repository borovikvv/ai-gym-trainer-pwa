#!/usr/bin/env python3
"""Update Oleg's workout draft with corrected set data."""
import json, sys, os

db_url = os.environ.get('DATABASE_URL')
if not db_url:
    print("DATABASE_URL not set")
    sys.exit(1)

import subprocess

# Get current draft
result = subprocess.run(
    ["psql", db_url, "-t", "-A",
     "-c", "SELECT payload FROM public.workout_drafts WHERE id = 'oleg:planned-oleg-2026-07-12-1782742998910';"],
    capture_output=True, text=True
)
raw = result.stdout.strip()
if not raw:
    print("Draft not found")
    sys.exit(1)

draft = json.loads(raw)
logs = draft['logs']

# 1. Plank — 2 sets of 60 sec
logs['plank-extra-1783873952645']['sets'] = [
    {"rpe": 7, "reps": 60, "weight": 0, "completed": True, "repsInput": "60", "weightInput": "0"},
    {"rpe": 7, "reps": 60, "weight": 0, "completed": True, "repsInput": "60", "weightInput": "0"},
]

# 2. Shoulder press machine — corrected sets
shoulder_id = 'arnold-press-alternative-жим-в-тренажёре-replacement-1783870998451'
logs[shoulder_id]['sets'] = [
    {"rpe": 7, "reps": 10, "weight": 25, "completed": True, "repsInput": "10", "weightInput": "25"},
    {"rpe": 8, "reps": 10, "weight": 30, "completed": True, "repsInput": "10", "weightInput": "30"},
    {"rpe": 9, "reps": 10, "weight": 30, "completed": True, "repsInput": "10", "weightInput": "30"},
]

# 3. Remove duplicate empty exercises
for eid in ['incline-db-press-extra-1783872616183',
            'incline-db-press-extra-1783873066975',
            'db-shoulder-press-replacement-1783874713498']:
    logs.pop(eid, None)

# Update payload
new_payload = json.dumps(draft, ensure_ascii=False)
escaped = new_payload.replace("'", "''")
subprocess.run(
    ["psql", db_url, "-c",
     f"UPDATE public.workout_drafts SET payload = '{escaped}'::jsonb, updated_at = now() WHERE id = 'oleg:planned-oleg-2026-07-12-1782742998910';"],
    capture_output=True, text=True
)

# Show result
for eid, log in logs.items():
    labels = []
    for s in log['sets']:
        w = s.get('weight', 0)
        r = s.get('reps', 0)
        done = s.get('completed', False)
        if 'plank' in eid.lower():
            labels.append(f"{'✅' if done else '⬜'} {r} сек")
        elif done:
            labels.append(f"✅ {w}×{r}")
        else:
            labels.append(f"⬜ {w}×{r}")
    print(f"{' | '.join(labels)}")
