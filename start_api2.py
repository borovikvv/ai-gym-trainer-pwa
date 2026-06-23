#!/usr/bin/env python3
"""Start API with correct DB credentials."""
import os, subprocess, time, urllib.request

with open(os.path.join(os.path.dirname(__file__), '.env.local')) as f:
    for line in f:
        if line.startswith('DATABASE_URL='):
            db_url = line.split('=', 1)[1].strip()
            break

env = os.environ.copy()
env['DATABASE_URL'] = db_url
env['API_PORT'] = '8910'
env['API_HOST'] = '127.0.0.1'

log = open('/tmp/api_py.log', 'w')
p = subprocess.Popen(
    ['npx', 'tsx', 'server/index.ts'],
    cwd=os.path.dirname(__file__),
    env=env, stdout=log, stderr=subprocess.STDOUT
)

for i in range(30):
    time.sleep(1)
    try:
        r = urllib.request.urlopen('http://127.0.0.1:8910/health', timeout=2)
        data = r.read().decode()
        if '"ok":true' in data:
            log.write(f"OK at attempt {i+1}: {data}\n")
            log.flush()
            break
        else:
            log.write(f"Attempt {i+1}: {data}\n")
            log.flush()
    except Exception as e:
        log.write(f"Attempt {i+1}: {e}\n")
        log.flush()

log.write("API running, entering keepalive...\n")
log.flush()
with open('/tmp/api_status2.txt', 'w') as f:
    f.write('running\n')
p.wait()
