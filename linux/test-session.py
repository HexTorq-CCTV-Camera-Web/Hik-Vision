"""Offline operator session for acceptance tests; stdout must be a private pipe."""
import json
import os
from pathlib import Path
import subprocess
if os.getuid() != 1006:
    raise SystemExit('Run as mohan.')
name = 'mohan-cam-receiver'
info = json.loads(subprocess.check_output(['docker', 'inspect', name]))[0]
if info['Config']['Image'] != 'mohan-cam-service:local' or info['Config']['Labels'].get('dev.mohan.camera') != 'pilot':
    raise SystemExit('Unexpected container; left unchanged.')
subprocess.run(['docker', 'stop', '-t', '20', name], check=True, stdout=subprocess.DEVNULL)
try:
    result = subprocess.run(['node', '/home/mohan/cam/app/issue-test-session.mjs'], check=True, capture_output=True)
    token = result.stdout.decode().strip()
finally:
    subprocess.run(['docker', 'start', name], check=True, stdout=subprocess.DEVNULL)
print(json.dumps({'testSession': token, 'restarted': True}))
