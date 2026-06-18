#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import os
import shutil
import sys
from pathlib import Path

HERMES_ROOT = Path(os.environ.get("HERMES_AGENT_ROOT", "/usr/local/lib/hermes-agent"))
OUT_DIR = Path("/root/ai-gym-trainer-pwa/public/exercise-guides")
MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2-medium")

EXERCISES = [
    {
        "id": "lat-pulldown",
        "name": "Тяга верхнего блока",
        "scene": "athlete seated at a lat pulldown machine, torso slightly leaned back, pulling the wide bar down toward the upper chest with elbows moving down and back",
        "focus": "vertical cable path, shoulder blades down, chest lifted, no body swinging",
    },
    {
        "id": "barbell-squat",
        "name": "Присед со штангой",
        "scene": "athlete performing a controlled back squat with a barbell on the upper back, feet shoulder width, hips back and down, knees tracking over toes",
        "focus": "neutral spine, full foot pressure, safe depth, bar over mid-foot",
    },
    {
        "id": "cable-row",
        "name": "Горизонтальная тяга",
        "scene": "athlete seated at a cable row machine, pulling a neutral handle toward the lower ribs with a stable torso and elbows close to body",
        "focus": "straight cable line, chest tall, shoulder blades squeeze, no leaning back aggressively",
    },
    {
        "id": "plank",
        "name": "Планка",
        "scene": "athlete holding a forearm plank on a gym mat, elbows under shoulders, body in a straight line from head to heels",
        "focus": "neutral neck, braced core, hips neither sagging nor too high",
    },
    {
        "id": "romanian-deadlift",
        "name": "Румынская тяга",
        "scene": "athlete doing a Romanian deadlift with a barbell, hips hinging backward, slight knee bend, bar close to thighs and shins",
        "focus": "hip hinge, neutral back, hamstring stretch, bar close to body",
    },
    {
        "id": "incline-db-press",
        "name": "Жим гантелей на наклонной",
        "scene": "athlete lying on an incline bench pressing two dumbbells upward, elbows controlled around 45 degrees, feet planted",
        "focus": "upper chest press path, stable shoulders, controlled lower phase, no excessive arch",
    },
    {
        "id": "deadlift-machine-row",
        "name": "Тяга в тренажёре",
        "scene": "athlete using a seated plate-loaded row machine with chest support, pulling handles back toward the ribs",
        "focus": "chest stays on pad, elbows travel back, shoulder blades squeeze, no jerking",
    },
    {
        "id": "db-shoulder-press",
        "name": "Жим гантелей сидя",
        "scene": "athlete seated on an upright bench pressing dumbbells overhead, wrists stacked over elbows, core braced",
        "focus": "vertical press path, controlled shoulders, ribs down, dumbbells finish above shoulders",
    },
    {
        "id": "walking-lunges",
        "name": "Выпады с гантелями",
        "scene": "athlete performing walking lunges holding dumbbells at sides, front knee tracking over foot, back knee lowering under control",
        "focus": "upright torso, stable front foot, controlled stride length, no knee collapse",
    },
]


def load_provider():
    plugin_path = HERMES_ROOT / "plugins" / "image_gen" / "openai-codex" / "__init__.py"
    if not plugin_path.exists():
        raise FileNotFoundError(plugin_path)
    sys.path.insert(0, str(HERMES_ROOT))
    spec = importlib.util.spec_from_file_location("openai_codex_image_gen", plugin_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load OpenAI Codex image provider")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.OpenAICodexImageGenProvider()


def prompt_for(ex: dict[str, str]) -> str:
    return f"""
Create a clear instructional fitness illustration for a mobile gym coaching app.

Exercise: {ex['name']}.
Scene: {ex['scene']}.
Technique focus: {ex['focus']}.

Composition requirements:
- Show one athletic adult in a realistic modern gym, performing the exercise with correct form.
- Make body position, equipment, and movement path easy to understand on a phone screen.
- Use subtle translucent motion arrows and/or ghosted start/end position to explain the movement.
- Warm premium fitness-app style, realistic but clean, high contrast, 4:3 instructional composition.
- No readable text, no letters, no numbers, no logos, no labels, no watermarks, no fake UI, no captions.
- Avoid extra people, clutter, mirrors with confusing reflections, and unsafe technique.
""".strip()


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    os.environ["OPENAI_IMAGE_MODEL"] = MODEL
    provider = load_provider()
    failures = []
    for ex in EXERCISES:
        out = OUT_DIR / f"{ex['id']}-gpt.png"
        if out.exists() and out.stat().st_size > 100_000:
            print(f"SKIP {ex['id']} {out}", flush=True)
            continue
        print(f"GENERATE {ex['id']} {ex['name']}", flush=True)
        result = provider.generate(prompt=prompt_for(ex), aspect_ratio="landscape")
        if not result.get("success"):
            failures.append((ex["id"], result.get("error") or str(result)))
            print(f"FAIL {ex['id']}: {failures[-1][1]}", flush=True)
            continue
        shutil.copyfile(Path(result["image"]), out)
        print(f"OK {ex['id']} -> {out}", flush=True)
    if failures:
        print("FAILURES:")
        for item in failures:
            print(item)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
