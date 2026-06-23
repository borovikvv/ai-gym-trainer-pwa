#!/usr/bin/env python3
"""Start AI Gym Trainer API with correct DATABASE_URL."""
import os, subprocess, time, urllib.request, sys

db_url = None
with open(os.path.join(os.path.dirname(__file__), '.env.local')) as f:
    for line in f:
        line = line.strip()
        if line.startswith('DATABASE_URL='):
            db_url = line.split('=', 1)[1]
            break

if not db_url:
    print("ERROR: DATABASE_URL not found in .env.local")
    sys.exit(1)

env = os.environ.copy()
env['DATABASE_URL'] = db_url
env['API_PORT'] = '8910'
env['API_HOST'] = '127.0.0.1'

log = open('/tmp/api-start.log', 'w')
p = subprocess.Popen(
    ['npx', 'tsx', 'server/index.ts'],
    cwd=os.path.dirname(__file__),
    env=env,
    stdout=log,
    stderr=subprocess.STDOUT
)

# Wait for startup
for i in range(10):
    time.sleep(1)
    try:
        r = urllib.request.urlopen('http://127.0.0.1:8910/health', timeout=2)
        resp = r.read().decode()
        log.write(f"\nHealth check attempt {i+1}: {resp}\n")
        log.flush()
        if '"ok":true' in resp:
            print(f"API started successfully: {resp}")
            p.wait()  # keep running
            sys.exit(0)
    except Exception as e:
        log.write(f"Attempt {i+1}: {e}\n")
        log.flush()

log.write("API failed to start within 10 seconds\n")
with open('/tmp/api-start.log') as f:
    print(f"Log contents:\n{f.read()}")
sys.exit(1)
