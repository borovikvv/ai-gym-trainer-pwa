#!/usr/bin/env python3
from __future__ import annotations

import base64
import importlib.util
import json
import os
import sys
import time
from pathlib import Path

import httpx

HERMES_ROOT = Path('/usr/local/lib/hermes-agent')
sys.path.insert(0, str(HERMES_ROOT))
spec = importlib.util.spec_from_file_location('openai_codex_image_gen', HERMES_ROOT / 'plugins/image_gen/openai-codex/__init__.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)  # type: ignore[union-attr]
from agent.auxiliary_client import _codex_cloudflare_headers

OUT_DIR = Path('/root/ai-gym-trainer-pwa/public/exercise-guides')
OUT_DIR.mkdir(parents=True, exist_ok=True)
MODEL_QUALITY = os.environ.get('GPT_IMAGE_QUALITY', 'medium')
SIZE = '1536x1024'
OUT = OUT_DIR / 'pallof-press-gpt.png'
META = OUT_DIR / 'pallof-press-gpt.json'

PROMPT = """Generate one realistic instructional image for a mobile gym exercise guide.
Exercise: Pallof press anti-rotation cable press.
Show a single adult athlete standing side-on to a cable machine, feet about shoulder-width, knees slightly bent, torso tall and braced. The cable pulley is set at mid-chest height to the athlete's side. The athlete holds a single cable handle with both hands and presses both hands straight forward away from the chest, arms extended in front of the sternum, resisting the sideways pull of the cable without rotating the torso. The cable should clearly run horizontally from the side into the hands. Correct technique must be obvious: neutral spine, hips square, shoulders down, core braced, no twisting. Modern gym, clean premium fitness app style, natural lighting, realistic anatomy, full-body view, high contrast, no clutter. Use subtle motion arrows or a faint ghosted start/end position only if helpful.
Strictly no readable text, no letters, no numbers, no logos, no captions, no watermarks, no UI labels."""


def generate_one() -> tuple[bool, str, list[str]]:
    token = mod._read_codex_access_token()
    headers = _codex_cloudflare_headers(token)
    headers.update({'Accept': 'text/event-stream', 'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    payload = mod._build_responses_payload(prompt=PROMPT, size=SIZE, quality=MODEL_QUALITY)
    timeout = httpx.Timeout(300, connect=30, read=300, write=30, pool=30)
    newest = None
    types: list[str] = []
    texts: list[str] = []
    with httpx.Client(timeout=timeout, headers=headers) as http:
        with http.stream('POST', f'{mod._CODEX_BASE_URL}/responses', json=payload) as response:
            if response.status_code >= 400:
                return False, f'HTTP {response.status_code}: {response.read().decode(errors="replace")[:1000]}', types
            for event in mod._iter_sse_json(response):
                event_type = str(event.get('type'))
                types.append(event_type)
                found = mod._extract_image_b64(event)
                if found:
                    newest = found
                serialized = json.dumps(event, ensure_ascii=False)
                if 'output_text' in serialized or 'refusal' in serialized:
                    texts.append(serialized[:800])
    if not newest:
        return False, 'no image; texts=' + ' | '.join(texts[-3:]), types
    OUT.write_bytes(base64.b64decode(newest))
    META.write_text(json.dumps({'prompt': PROMPT, 'size': SIZE, 'quality': MODEL_QUALITY, 'output': str(OUT)}, ensure_ascii=False, indent=2), encoding='utf-8')
    return True, str(OUT), types


if __name__ == '__main__':
    last_msg = ''
    for attempt in range(1, 4):
        print(f'GEN pallof-press attempt {attempt}', flush=True)
        ok, msg, types = generate_one()
        print(' ->', ok, msg, 'events_tail=', ','.join(types[-8:]), flush=True)
        if ok:
            raise SystemExit(0)
        last_msg = msg
        time.sleep(3)
    print('FINAL_FAIL', last_msg, flush=True)
    raise SystemExit(1)
