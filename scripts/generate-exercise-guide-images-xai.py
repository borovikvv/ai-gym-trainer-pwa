#!/usr/bin/env python3
"""Regenerate exercise guide images via xAI's grok-imagine-image-quality.

Runs on the server (Hermes) where the hermes-agent plugin framework and
XAI_API_KEY live. Mirrors scripts/generate-exercise-guide-images.py but
swaps the OpenAI Codex plugin for the xAI image-gen plugin.

Usage:
  python3 generate-exercise-guide-images-xai.py --only barbell-row   # single test
  python3 generate-exercise-guide-images-xai.py                      # full batch
  python3 generate-exercise-guide-images-xai.py --force              # overwrite existing files too
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
import shutil
import sys
import urllib.request
from pathlib import Path

HERMES_ROOT = Path(os.environ.get("HERMES_AGENT_ROOT", "/usr/local/lib/hermes-agent"))
OUT_DIR = Path("/root/ai-gym-trainer-pwa/public/exercise-guides")
MODEL = os.environ.get("XAI_IMAGE_MODEL", "grok-imagine-image-quality")

# id -> generation brief. Covers: (a) style-fix regenerations flagged in the
# audit report, (b) barbell-row (missing image entirely — confirmed bug),
# (c) the 3 new free-weight staples added by
# 2026-07-16_exercise_library_add_free_weight_staples.sql.
EXERCISES = [
    {
        "id": "barbell-row",
        "name": "Тяга штанги в наклоне",
        "muscles": "lats, rhomboids, rear delts, biceps",
        "equipment": "barbell",
        "movement": "hip-hinge bent-over row: torso near-parallel to floor, barbell pulled to lower ribs/upper abdomen, elbows drive back and up, controlled lowering",
    },
    {
        "id": "bench-press",
        "name": "Жим лёжа",
        "muscles": "chest, front delts, triceps",
        "equipment": "barbell, flat bench",
        "movement": "flat barbell bench press: bar lowered to mid-chest with elbows ~45° from torso, pressed back up to lockout",
    },
    {
        "id": "dumbbell-bench-press",
        "name": "Жим гантелей лёжа",
        "muscles": "chest, front delts, triceps",
        "equipment": "dumbbells, flat bench",
        "movement": "flat dumbbell bench press: dumbbells lowered beside chest, pressed up and slightly inward to near-touch at lockout",
    },
    {
        "id": "cable-crossover",
        "name": "Кроссовер на блоках",
        "muscles": "chest, front delts",
        "equipment": "dual cable crossover machine",
        "movement": "standing cable crossover fly: arms start wide with slight elbow bend, sweep down and across in front of the body to meet at waist height, controlled return to wide start — show the full arc with a ghost start position, not a static end pose",
    },
    {
        "id": "rear-delt-raise-dumbbell",
        "name": "Махи гантелями в наклоне на заднюю дельту",
        "muscles": "rear delts, upper back",
        "equipment": "dumbbells",
        "movement": "bent-over dumbbell rear delt raise: hinge forward at hips, arms raise out to sides with slight elbow bend, controlled descent",
    },
    {
        "id": "decline-bench-crunch",
        "name": "Скручивания на наклонной скамье",
        "muscles": "rectus abdominis",
        "equipment": "decline bench",
        "movement": "decline bench crunch: feet anchored at top, torso curls up toward knees, controlled lowering without full recline",
    },
    {
        "id": "captain-chair-knee-raise",
        "name": "Подъём коленей в упоре",
        "muscles": "rectus abdominis, hip flexors",
        "equipment": "captain's chair / vertical knee raise station",
        "movement": "supported knee raise: torso braced against pads, knees drawn up toward chest, controlled lowering",
    },
    {
        "id": "machine-crunch",
        "name": "Скручивания в тренажёре",
        "muscles": "rectus abdominis",
        "equipment": "ab crunch machine",
        "movement": "seated machine crunch: torso curls forward against resistance pad, controlled return",
    },
    {
        "id": "lat-pulldown",
        "name": "Тяга верхнего блока",
        "muscles": "lats, biceps",
        "equipment": "cable lat pulldown machine",
        "movement": "wide-grip lat pulldown: bar pulled down to upper chest with elbows driving down and back, controlled return to full stretch",
    },
    {
        "id": "barbell-overhead-press",
        "name": "Жим штанги стоя",
        "muscles": "front delts, side delts, triceps",
        "equipment": "barbell",
        "movement": "standing strict overhead press: bar starts at collarbone, pressed straight overhead to lockout with a slight head-through motion, controlled lowering back to the shoulders",
    },
    {
        "id": "conventional-deadlift",
        "name": "Становая тяга",
        "muscles": "glutes, hamstrings, lower back, lats",
        "equipment": "barbell",
        "movement": "conventional deadlift: hip-width stance, bar close to shins, flat back hinge down to the bar, drive through the floor extending hips and knees together to lockout, controlled lowering",
    },
    {
        "id": "single-arm-dumbbell-row",
        "name": "Тяга гантели одной рукой в наклоне",
        "muscles": "lats, rhomboids, biceps",
        "equipment": "dumbbell, flat bench",
        "movement": "single-arm dumbbell row: opposite knee and hand supported on bench, flat back parallel to floor, dumbbell pulled to hip with elbow driving up and back, controlled lowering to full arm extension",
    },
]


def load_provider():
    plugin_path = HERMES_ROOT / "plugins" / "image_gen" / "xai" / "__init__.py"
    if not plugin_path.exists():
        raise FileNotFoundError(f"xAI image plugin not found: {plugin_path}")
    sys.path.insert(0, str(HERMES_ROOT))
    spec = importlib.util.spec_from_file_location("xai_image_gen", plugin_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load plugin spec: {plugin_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.XAIImageGenProvider()


def build_prompt(item: dict) -> str:
    return f"""
Create a premium text-free instructional fitness illustration for a mobile personal trainer app.

Exercise: {item['name']} ({item['id']})
Target muscles: {item['muscles']}
Equipment: {item['equipment']}
Movement to show: {item['movement']}.

Visual style must match the existing exercise guide images in this product: realistic modern gym with warm, moody, dimly-lit ambient lighting (dark walls, warm accent lighting strips), premium editorial photography look, one male athlete in dark athletic wear demonstrating correct technique. Like a double-exposure photograph, show TWO distinct body positions of the SAME athlete: a solid, fully-rendered pose at one end of the movement, and a clearly separate semi-transparent/ghost duplicate of the same athlete at the OTHER end of the movement (a visibly different pose, offset to the side, not just a glow outlining the same pose) — connected by a warm orange or white curved motion arrow showing the direction of travel between the two positions. Uncluttered gym background with visible dumbbell racks/rig, app-friendly 3/4 instructional composition, landscape aspect close to 3:2.

Hard constraints:
- No readable text, no letters, no numbers, no captions, no logos, no watermarks, no UI labels.
- Do not include pseudo-text on machines, clothing, walls, screens, or equipment.
- Avoid exaggerated anatomy, unsafe form, distorted hands, extra limbs, or impossible equipment.
- Show correct, safe technique clearly enough that a gym user can understand the exercise from the image.
- Must show the movement (ghost start position + arrow), not a single static end pose.
- Landscape 3:2-ish composition suitable for a 3/4-screen exercise modal.
""".strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", help="Generate a single exercise id (test run)")
    parser.add_argument("--force", action="store_true", help="Overwrite existing files")
    args = parser.parse_args()

    items = [e for e in EXERCISES if e["id"] == args.only] if args.only else EXERCISES
    if args.only and not items:
        print(f"Unknown id: {args.only}", file=sys.stderr)
        return 1

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    provider = load_provider()
    results = []
    previous_model = os.environ.get("XAI_IMAGE_MODEL")
    os.environ["XAI_IMAGE_MODEL"] = MODEL
    try:
        for item in items:
            out_path = OUT_DIR / f"{item['id']}-gpt.png"
            if out_path.exists() and out_path.stat().st_size > 1000 and not args.force:
                results.append({"id": item["id"], "status": "exists", "path": str(out_path)})
                continue
            prompt = build_prompt(item)
            print(json.dumps({"event": "generate", "id": item["id"], "model": MODEL}, ensure_ascii=False), flush=True)
            result = provider.generate(prompt=prompt, aspect_ratio="landscape")
            if not result.get("success"):
                raise RuntimeError(f"{item['id']}: {result.get('error') or result}")
            image_ref = result["image"]
            if image_ref.startswith("http://") or image_ref.startswith("https://"):
                urllib.request.urlretrieve(image_ref, out_path)
            else:
                shutil.copyfile(Path(image_ref), out_path)
            manifest = {
                "id": item["id"],
                "name": item["name"],
                "model": result.get("model") or MODEL,
                "provider": result.get("provider") or "xai",
                "image": str(out_path),
                "prompt": prompt,
            }
            (OUT_DIR / f"{item['id']}-gpt.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
            results.append({"id": item["id"], "status": "generated", "path": str(out_path)})
            print(json.dumps(results[-1], ensure_ascii=False), flush=True)
    finally:
        if previous_model is None:
            os.environ.pop("XAI_IMAGE_MODEL", None)
        else:
            os.environ["XAI_IMAGE_MODEL"] = previous_model
    print(json.dumps({"ok": True, "results": results}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
