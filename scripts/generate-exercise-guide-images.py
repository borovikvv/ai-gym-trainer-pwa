#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
from pathlib import Path

HERMES_ROOT = Path(os.environ.get("HERMES_AGENT_ROOT", "/usr/local/lib/hermes-agent"))
OUT_DIR = Path("/root/ai-gym-trainer-pwa/public/exercise-guides")
MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-2-medium")

EXERCISES = [
    {
        "id": "barbell-curl",
        "name": "Сгибание рук со штангой",
        "muscles": "biceps, arms",
        "equipment": "straight or EZ barbell",
        "movement": "standing curl: elbows fixed near torso, bar travels upward toward chest, controlled lowering",
    },
    {
        "id": "cable-triceps-pushdown",
        "name": "Разгибание рук на блоке",
        "muscles": "triceps, arms",
        "equipment": "cable machine with rope attachment",
        "movement": "standing rope pushdown: elbows pinned at sides, hands press rope down and slightly apart, controlled return",
    },
    {
        "id": "calf-raise",
        "name": "Подъёмы на икры",
        "muscles": "calves",
        "equipment": "standing calf raise machine or step with support",
        "movement": "heels lower below platform then rise onto toes, upright posture, controlled tempo",
    },
    {
        "id": "dumbbell-curl",
        "name": "Сгибание рук с гантелями",
        "muscles": "biceps, arms",
        "equipment": "two dumbbells",
        "movement": "standing alternating dumbbell curl with supination, elbows stable, no body swing",
    },
    {
        "id": "face-pull",
        "name": "Face pull",
        "muscles": "rear delts, upper back, external rotators",
        "equipment": "cable machine with rope at face height",
        "movement": "pull rope toward face, elbows high, rope ends split outward, shoulders down",
    },
    {
        "id": "hammer-curl",
        "name": "Молотковые сгибания",
        "muscles": "biceps, brachialis, forearms",
        "equipment": "two dumbbells",
        "movement": "standing hammer curl with neutral grip, elbows fixed, controlled lowering",
    },
    {
        "id": "lateral-raises",
        "name": "Разведения гантелей в стороны",
        "muscles": "side delts, shoulders",
        "equipment": "two light dumbbells",
        "movement": "raise arms out to sides to shoulder height, slight elbow bend, wrists below elbows, controlled descent",
    },
    {
        "id": "overhead-triceps-extension",
        "name": "Разгибание рук из-за головы",
        "muscles": "triceps, long head",
        "equipment": "single dumbbell or cable rope overhead",
        "movement": "overhead triceps extension: elbows narrow, forearms bend behind head then extend upward, ribs down",
    },
    {
        "id": "rear-delt-machine",
        "name": "Обратная бабочка",
        "muscles": "rear delts, upper back",
        "equipment": "reverse pec deck machine",
        "movement": "chest supported on reverse fly machine, arms sweep outward/back, controlled return",
    },
]


def load_provider():
    plugin_path = HERMES_ROOT / "plugins" / "image_gen" / "openai-codex" / "__init__.py"
    if not plugin_path.exists():
        raise FileNotFoundError(f"OpenAI Codex image plugin not found: {plugin_path}")
    sys.path.insert(0, str(HERMES_ROOT))
    spec = importlib.util.spec_from_file_location("openai_codex_image_gen", plugin_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load plugin spec: {plugin_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.OpenAICodexImageGenProvider()


def build_prompt(item: dict) -> str:
    return f"""
Create a premium text-free instructional fitness illustration for a mobile personal trainer app.

Exercise: {item['name']} ({item['id']})
Target muscles: {item['muscles']}
Equipment: {item['equipment']}
Movement to show: {item['movement']}.

Visual style must match the existing exercise guide images in this product: realistic modern gym, clean premium editorial lighting, warm neutral tones, one athlete demonstrating correct technique, subtle ghost-position or motion arrows to show the movement path, uncluttered background, app-friendly 3/4 instructional composition.

Hard constraints:
- No readable text, no letters, no numbers, no captions, no logos, no watermarks, no UI labels.
- Do not include pseudo-text on machines, clothing, walls, screens, or equipment.
- Avoid exaggerated anatomy, unsafe form, distorted hands, extra limbs, or impossible equipment.
- Show correct, safe technique clearly enough that a gym user can understand the exercise from the image.
- Landscape 3:2-ish composition suitable for a 3/4-screen exercise modal.
""".strip()


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    provider = load_provider()
    results = []
    previous_model = os.environ.get("OPENAI_IMAGE_MODEL")
    os.environ["OPENAI_IMAGE_MODEL"] = MODEL
    try:
        for item in EXERCISES:
            out_path = OUT_DIR / f"{item['id']}-gpt.png"
            if out_path.exists() and out_path.stat().st_size > 1000:
                results.append({"id": item["id"], "status": "exists", "path": str(out_path)})
                continue
            prompt = build_prompt(item)
            print(json.dumps({"event": "generate", "id": item["id"], "model": MODEL}, ensure_ascii=False), flush=True)
            result = provider.generate(prompt=prompt, aspect_ratio="landscape")
            if not result.get("success"):
                raise RuntimeError(f"{item['id']}: {result.get('error') or result}")
            source = Path(result["image"])
            shutil.copyfile(source, out_path)
            manifest = {
                "id": item["id"],
                "name": item["name"],
                "model": result.get("model") or MODEL,
                "provider": result.get("provider") or "openai-codex",
                "image": str(out_path),
                "prompt": prompt,
            }
            (OUT_DIR / f"{item['id']}-gpt.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
            results.append({"id": item["id"], "status": "generated", "path": str(out_path)})
            print(json.dumps(results[-1], ensure_ascii=False), flush=True)
    finally:
        if previous_model is None:
            os.environ.pop("OPENAI_IMAGE_MODEL", None)
        else:
            os.environ["OPENAI_IMAGE_MODEL"] = previous_model
    print(json.dumps({"ok": True, "results": results}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
