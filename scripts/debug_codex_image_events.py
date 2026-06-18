import importlib.util, os, sys, json
from pathlib import Path
root=Path('/usr/local/lib/hermes-agent')
sys.path.insert(0,str(root))
spec=importlib.util.spec_from_file_location('p', root/'plugins/image_gen/openai-codex/__init__.py')
mod=importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
token=mod._read_codex_access_token()
print('token', bool(token))
payload=mod._build_responses_payload(prompt='Create an image of a bench press exercise. No text.', size='1536x1024', quality='low')
import httpx
from agent.auxiliary_client import _codex_cloudflare_headers
headers=_codex_cloudflare_headers(token); headers.update({'Accept':'text/event-stream','Authorization':f'Bearer {token}','Content-Type':'application/json'})
with httpx.Client(timeout=httpx.Timeout(120, connect=30, read=120, write=30, pool=30), headers=headers) as http:
    with http.stream('POST', f'{mod._CODEX_BASE_URL}/responses', json=payload) as response:
        print('status', response.status_code)
        if response.status_code>=400:
            print(response.read().decode()[:1000]); raise SystemExit
        count=0
        for event in mod._iter_sse_json(response):
            count += 1
            print('EVENT', count, event.get('type'), json.dumps(event, ensure_ascii=False)[:1000])
            if count>=20: break
