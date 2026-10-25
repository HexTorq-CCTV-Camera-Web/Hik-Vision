"""Move this workspace's pilot into its restartable, bounded container."""
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time

root = Path('/home/mohan/cam')
if os.getuid() != 1006:
    raise SystemExit('Run as mohan.')
os.umask(0o077)
pid_file = root / 'viewer.pid'
if pid_file.exists():
    pid = int(pid_file.read_text())
    process = Path('/proc') / str(pid)
    if process.exists():
        command = (process / 'cmdline').read_bytes().split(b'\0')
        if process.stat().st_uid != os.getuid() or b'/home/mohan/cam/app/server.mjs' not in command:
            raise SystemExit('PID does not belong to this workspace; no process was stopped.')
        os.kill(pid, signal.SIGTERM)
        for _ in range(50):
            with socket.socket() as check:
                if check.connect_ex(('127.0.0.1', 21000)) != 0:
                    break
            time.sleep(0.1)
    pid_file.unlink()
with socket.socket() as check:
    if check.connect_ex(('127.0.0.1', 21000)) == 0:
        raise SystemExit('Port 21000 is in use; leave that listener unchanged.')
existing = subprocess.run(['docker', 'container', 'inspect', 'mohan-cam-receiver'], capture_output=True)
if existing.returncode == 0:
    container = json.loads(existing.stdout)[0]
    image = container['Config']['Image']
    if image not in ('mohan-cam-playback:local', 'mohan-cam-service:local'):
        raise SystemExit('Unexpected container image; left unchanged.')
    subprocess.run(['docker', 'stop', '-t', '20', 'mohan-cam-receiver'], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['docker', 'rm', 'mohan-cam-receiver'], check=True, stdout=subprocess.DEVNULL)
(root / 'app/wine-python.sh').chmod(0o700)
test_session = None
if '--test-session' in sys.argv:
    result = subprocess.run(['node', str(root / 'app/issue-test-session.mjs')], check=True, capture_output=True)
    test_session = result.stdout.decode().strip()
    if len(test_session) != 64:
        raise SystemExit('Invalid test session.')
command = ['docker', 'run', '-d', '--restart', 'unless-stopped', '--log-driver', 'none',
    '--init', '--name', 'mohan-cam-receiver', '--label', 'dev.mohan.camera=pilot',
    '--cpus', '1.25', '--memory', '2g', '--pids-limit', '512', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--read-only', '--tmpfs', '/tmp:rw,nosuid,size=256m',
    '--env-file', str(root / 'config/receiver.env'), '-p', '21000:21000',
    '-e', 'HIK_PRODUCT_DATA_DIR=/work/data', '-e', 'HIK_PYTHON=/work/app/wine-python.sh',
    '-e', 'PORT=21000', '-e', 'HIK_LISTEN_HOST=0.0.0.0', '-e', 'MAX_LIVE_STREAMS=16',
    '-e', 'PUBLIC_ORIGIN=http://187.127.189.231:21000', '-e', 'HIK_ALLOW_HTTP_PILOT=1',
    '-v', f'{root}/sdk:/work/sdk:ro', '-v', f'{root}/app:/work/app:ro',
    '-v', f'{root}/data:/work/data', '-v', f'{root}/wineprefix:/work/wineprefix',
    '-v', f'{root}/home:/work/home', 'mohan-cam-service:local']
subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
print(json.dumps({'deployed': True, 'port': 21000, 'restartPolicy': 'unless-stopped',
    'cpuLimit': 1.25, 'memoryLimitMiB': 2048,
    **({'testSession': test_session} if test_session else {})}))
