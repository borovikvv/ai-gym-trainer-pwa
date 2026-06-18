import base64, importlib.util, json, sys, httpx, time
from pathlib import Path
root=Path('/usr/local/lib/hermes-agent'); sys.path.insert(0,str(root))
spec=importlib.util.spec_from_file_location('p', root/'plugins/image_gen/openai-codex/__init__.py')
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
from agent.auxiliary_client import _codex_cloudflare_headers
token=mod._read_codex_access_token(); headers=_codex_cloudflare_headers(token); headers.update({'Accept':'text/event-stream','Authorization':f'Bearer {token}','Content-Type':'application/json'})
prompts=[
"Generate a realistic instructional fitness image: seated cable pulldown machine exercise. A single adult athlete sits at the machine and pulls the overhead bar down toward the upper chest. Modern gym. No text, no logos.",
"Create one no-text gym exercise guide image of a person using an overhead cable pulldown machine. Show correct seated posture and the bar moving down to the chest. No labels, no letters.",
"Fitness app illustration, vertical pull machine in gym, person seated holding wide bar at chest level, elbows down, clear technique, no text or logos.",
]
for i,prompt in enumerate(prompts,1):
 print('TRY',i, flush=True)
 payload=mod._build_responses_payload(prompt=prompt, size='1536x1024', quality='medium')
 newest=None
 with httpx.Client(timeout=httpx.Timeout(300,connect=30,read=300,write=30,pool=30), headers=headers) as http:
  with http.stream('POST', f'{mod._CODEX_BASE_URL}/responses', json=payload) as response:
   print('status', response.status_code, flush=True)
   for event in mod._iter_sse_json(response):
    if event.get('type') in ('error','response.failed'):
     print('ERR_EVENT', json.dumps(event, ensure_ascii=False)[:2000], flush=True)
    found=mod._extract_image_b64(event)
    if found: newest=found
 if newest:
  out=Path('/root/ai-gym-trainer-pwa/public/exercise-guides/lat-pulldown-gpt.png')
  out.write_bytes(base64.b64decode(newest)); print('OK', out); break
 time.sleep(2)
