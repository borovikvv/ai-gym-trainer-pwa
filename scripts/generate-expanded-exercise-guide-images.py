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
    {"id": "push-up", "name": "Отжимания", "muscles": "chest, triceps, core", "equipment": "bodyweight, floor", "movement": "classic push-up: straight plank body line, hands slightly wider than shoulders, chest lowers toward floor then presses up"},
    {"id": "dumbbell-fly", "name": "Разведения гантелей лёжа", "muscles": "chest", "equipment": "flat bench and two dumbbells", "movement": "lying dumbbell fly: slight elbow bend, arms open wide in an arc then return above chest under control"},
    {"id": "chest-supported-row", "name": "Тяга с упором грудью", "muscles": "mid back, lats, rear delts", "equipment": "incline bench and dumbbells or chest-supported row machine", "movement": "chest-supported row: chest fixed on pad, elbows pull back, shoulder blades squeeze, controlled lowering"},
    {"id": "assisted-pull-up", "name": "Подтягивания в гравитроне", "muscles": "lats, upper back, biceps", "equipment": "assisted pull-up machine", "movement": "assisted pull-up: knees on support pad, arms start extended, athlete pulls chest toward bar with elbows down"},
    {"id": "leg-press", "name": "Жим ногами", "muscles": "quadriceps, glutes, hamstrings", "equipment": "45-degree leg press machine", "movement": "leg press: feet on platform, knees bend under control, platform pressed away without locking knees"},
    {"id": "leg-extension", "name": "Разгибание ног в тренажёре", "muscles": "quadriceps", "equipment": "leg extension machine", "movement": "seated leg extension: shins under pad, knees extend to lift the roller, controlled return"},
    {"id": "lying-leg-curl", "name": "Сгибание ног лёжа", "muscles": "hamstrings", "equipment": "lying leg curl machine", "movement": "lying leg curl: athlete prone on machine, heels curl pad toward glutes, pelvis stays down"},
    {"id": "bulgarian-split-squat", "name": "Болгарский сплит-присед", "muscles": "quads, glutes", "equipment": "bench and two dumbbells", "movement": "rear-foot elevated split squat: back foot on bench, front foot stable, athlete lowers and rises vertically"},
    {"id": "hip-thrust", "name": "Ягодичный мост со штангой", "muscles": "glutes, posterior chain", "equipment": "bench, barbell with pad", "movement": "barbell hip thrust: upper back on bench, bar over hips, hips extend to straight shoulder-hip-knee line"},
    {"id": "cable-pull-through", "name": "Кабельный pull-through", "muscles": "glutes, hamstrings", "equipment": "low cable pulley with rope", "movement": "cable pull-through: athlete faces away from cable, rope between legs, hips hinge back then extend forward"},
    {"id": "seated-calf-raise", "name": "Подъёмы на икры сидя", "muscles": "calves, soleus", "equipment": "seated calf raise machine", "movement": "seated calf raise: knees under pads, heels drop below platform then rise onto toes with pause"},
    {"id": "arnold-press", "name": "Жим Арнольда", "muscles": "shoulders", "equipment": "bench and two dumbbells", "movement": "seated Arnold press: dumbbells start in front of shoulders palms facing in, rotate while pressing overhead"},
    {"id": "cable-lateral-raise", "name": "Отведение руки в сторону на блоке", "muscles": "side delts", "equipment": "low cable pulley with single handle", "movement": "single-arm cable lateral raise: athlete stands side-on to low pulley, raises arm out to shoulder height"},
    {"id": "preacher-curl", "name": "Сгибание рук на скамье Скотта", "muscles": "biceps", "equipment": "preacher bench with EZ bar", "movement": "preacher curl: upper arms supported on pad, bar curls up, controlled lowering near full extension"},
    {"id": "cable-curl", "name": "Сгибание рук на нижнем блоке", "muscles": "biceps", "equipment": "low cable pulley with straight bar", "movement": "standing cable curl: elbows pinned to sides, bar curls toward chest, steady cable tension"},
    {"id": "bench-dips", "name": "Обратные отжимания от скамьи", "muscles": "triceps, chest", "equipment": "flat bench", "movement": "bench dip: hands on bench behind body, elbows bend backward, athlete presses up with triceps"},
    {"id": "skull-crusher", "name": "Французский жим лёжа", "muscles": "triceps", "equipment": "flat bench and EZ bar", "movement": "lying triceps extension skull crusher: upper arms mostly vertical, elbows bend to lower bar toward forehead then extend"},
    {"id": "dead-bug", "name": "Dead bug", "muscles": "core, deep abdominals", "equipment": "bodyweight on mat", "movement": "dead bug: athlete lies on back, opposite arm and leg extend while low back stays pressed to floor"},
    {"id": "side-plank", "name": "Боковая планка", "muscles": "obliques, core", "equipment": "bodyweight on mat", "movement": "side plank: elbow under shoulder, body in straight line, hips lifted from floor"},
    {"id": "cable-woodchop", "name": "Дровосек на блоке", "muscles": "obliques, core", "equipment": "cable machine with handle", "movement": "cable woodchop: two-handed diagonal rotation from high cable across body, stable feet and controlled return"},
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
    previous_model = os.environ.get("OPENAI_IMAGE_MODEL")
    os.environ["OPENAI_IMAGE_MODEL"] = MODEL
    results = []
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
                results.append({"id": item["id"], "status": "failed", "error": str(result.get("error") or result)})
                print(json.dumps(results[-1], ensure_ascii=False), flush=True)
                continue
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
    failed = [item for item in results if item.get("status") == "failed"]
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
