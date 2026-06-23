#!/usr/bin/env python3
"""Start API with debug — log what tsx process actually receives."""
import os, subprocess, time, urllib.request

with open(os.path.join(os.path.dirname(__file__), '.env.local')) as f:
    for line in f:
        if line.startswith('DATABASE_URL='):
            db_url = line.split('=', 1)[1].strip()
            break

# Write a quick debug script that wraps the real index.ts
debug_code = '''
const origUrl = process.env.DATABASE_URL || "NOT SET";
console.log("INIT: DATABASE_URL length:", origUrl.length);
console.log("INIT: DATABASE_URL starts with:", origUrl.substring(0, 30));
console.log("INIT: Contains @127:", origUrl.includes("@127"));
console.log("INIT: Separator check:", origUrl.split("@")[0].split(":"));

// Add debug to db module
import("./db.js").then(mod => {
  console.log("DB module loaded");
  // Force a test query
  mod.pool.query("SELECT 1 as test").then(r => {
    console.log("DB TEST OK:", r.rows[0].test);
  }).catch(e => {
    console.log("DB TEST FAIL:", e.message);
  });
});

// Then load the real server
import("./index.ts");
'''

# Create a debug entry point
with open(os.path.join(os.path.dirname(__file__), 'server', '_debug_start.mjs'), 'w') as f:
    f.write(debug_code)

env = os.environ.copy()
env['DATABASE_URL'] = db_url
env['API_PORT'] = '8910'
env['API_HOST'] = '127.0.0.1'

log = open('/tmp/debug_api.log', 'w')
log.write(f"DB_URL set to: {db_url[:30]}...{db_url[-20:]}\n")
log.write(f"DB_URL length: {len(db_url)}\n")
log.flush()

p = subprocess.Popen(
    ['npx', 'tsx', 'server/_debug_start.mjs'],
    cwd=os.path.dirname(__file__),
    env=env, stdout=log, stderr=subprocess.STDOUT
)

time.sleep(5)

# Check health
try:
    r = urllib.request.urlopen('http://127.0.0.1:8910/health', timeout=3)
    log.write(f"HEALTH: {r.read().decode()}\n")
except Exception as e:
    log.write(f"HEALTH FAIL: {e}\n")

log.flush()
log.write("Done debug. Check /tmp/debug_api.log\n")

# Kill the debug process
p.kill()
p.wait()
print("Done - check /tmp/debug_api.log")
