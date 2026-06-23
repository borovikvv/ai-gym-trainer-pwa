#!/usr/bin/env python3
"""Start API server — sets DB creds from .env.local directly in the subprocess env."""
import os, subprocess, sys, urllib.request, time

env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env.local')
db_url = None
with open(env_path) as f:
    for line in f:
        if line.startswith('DATABASE_URL='):
            db_url = line.split('=', 1)[1].strip()
            break

if not db_url:
    print("ERROR: DATABASE_URL not found in .env.local")
    sys.exit(1)

env = {
    'DATABASE_URL': db_url,
    'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
    'HOME': os.environ.get('HOME', '/root'),
    'API_PORT': '8910',
    'API_HOST': '127.0.0.1',
}

cwd = os.path.dirname(os.path.abspath(__file__))
p = subprocess.Popen(
    ['npx', 'tsx', 'server/index.ts'],
    cwd=cwd, env=env, stdout=sys.stdout, stderr=sys.stderr
)

for i in range(15):
    time.sleep(2)
    try:
        req = urllib.request.urlopen('http://127.0.0.1:8910/health', timeout=3)
        body = req.read().decode()
        if '"ok":true' in body:
            print(f"API healthy at attempt {i+1}: {body}", flush=True)
            break
        print(f"Health returned 500: {body}", flush=True)
    except Exception as e:
        print(f"  Attempt {i+1}: {e}", flush=True)
else:
    print("API failed to start", flush=True)
    p.kill()
    sys.exit(1)

p.wait()
