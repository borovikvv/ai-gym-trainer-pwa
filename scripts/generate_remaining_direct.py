#!/usr/bin/env python3
from __future__ import annotations
import base64, importlib.util, json, os, sys, time
from pathlib import Path
import httpx

HERMES_ROOT = Path('/usr/local/lib/hermes-agent')
sys.path.insert(0, str(HERMES_ROOT))
spec = importlib.util.spec_from_file_location('openai_codex_image_gen', HERMES_ROOT/'plugins/image_gen/openai-codex/__init__.py')
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
from agent.auxiliary_client import _codex_cloudflare_headers

OUT_DIR = Path('/root/ai-gym-trainer-pwa/public/exercise-guides')
MODEL_QUALITY = os.environ.get('GPT_IMAGE_QUALITY', 'medium')
SIZE='1536x1024'

EXERCISES = [
 ('lat-pulldown','Тяга верхнего блока','a seated gym cable pulldown exercise, person pulls the overhead bar down to the upper chest, elbows down, chest lifted'),
 ('barbell-squat','Присед со штангой','a barbell back squat exercise, person standing in side three-quarter view, barbell on upper back, hips and knees bent, safe neutral spine'),
 ('plank','Планка','a forearm plank exercise on a gym mat, straight body line, elbows under shoulders, core braced'),
 ('incline-db-press','Жим гантелей на наклонной','an incline dumbbell bench press exercise, person on incline bench pressing two dumbbells upward, feet planted'),
 ('deadlift-machine-row','Тяга в тренажёре','a seated chest-supported row machine exercise, person pulls handles toward ribs, chest on pad, elbows back'),
 ('db-shoulder-press','Жим гантелей сидя','a seated dumbbell shoulder press exercise, person on upright bench pressing dumbbells overhead'),
]

def prompt(name, scene):
    return f"""Generate one realistic instructional image for a mobile gym exercise guide.
Exercise: {name}. Show {scene}.
The image must make correct technique obvious: clear body position, gym equipment, and movement direction. Use subtle motion arrows or ghosted start/end position only if helpful.
Modern gym, clean premium fitness app style, single adult athlete, high contrast, no clutter.
Strictly no readable text, no letters, no numbers, no logos, no captions, no watermarks, no UI labels."""

def generate_one(ex_id, name, scene):
    token = mod._read_codex_access_token()
    headers = _codex_cloudflare_headers(token)
    headers.update({'Accept':'text/event-stream','Authorization':f'Bearer {token}','Content-Type':'application/json'})
    payload = mod._build_responses_payload(prompt=prompt(name, scene), size=SIZE, quality=MODEL_QUALITY)
    timeout = httpx.Timeout(300, connect=30, read=300, write=30, pool=30)
    newest=None; types=[]; texts=[]
    with httpx.Client(timeout=timeout, headers=headers) as http:
        with http.stream('POST', f'{mod._CODEX_BASE_URL}/responses', json=payload) as response:
            if response.status_code >= 400:
                return False, f'HTTP {response.status_code}: {response.read().decode(errors="replace")[:500]}'
            for event in mod._iter_sse_json(response):
                types.append(event.get('type'))
                found = mod._extract_image_b64(event)
                if found: newest = found
                s=json.dumps(event, ensure_ascii=False)
                if 'output_text' in s or 'refusal' in s: texts.append(s[:500])
    if not newest:
        return False, 'no_image events=' + ','.join([str(t) for t in types[-20:]]) + ' texts=' + ' | '.join(texts[-3:])
    out=OUT_DIR/f'{ex_id}-gpt.png'
    out.write_bytes(base64.b64decode(newest))
    return True, str(out)

for ex in EXERCISES:
    out=OUT_DIR/f'{ex[0]}-gpt.png'
    if out.exists() and out.stat().st_size > 100_000:
        print('SKIP', ex[0], flush=True); continue
    ok=False; msg=''
    for attempt in range(1,4):
        print('GEN', ex[0], 'attempt', attempt, flush=True)
        ok,msg=generate_one(*ex)
        print(' ->', ok, msg[:500], flush=True)
        if ok: break
        time.sleep(3)
    if not ok:
        print('FINAL_FAIL', ex[0], msg, flush=True)
