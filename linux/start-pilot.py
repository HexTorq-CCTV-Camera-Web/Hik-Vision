"""Start the isolated receiver and viewer as mohan. No existing service is changed."""
import json
import os
from pathlib import Path
import socket
import subprocess

root = Path('/home/mohan/cam')
if os.getuid() != 1006:
    raise SystemExit('Run as mohan.')
os.umask(0o077)
with socket.socket() as probe:
    if probe.connect_ex(('127.0.0.1', 21000)) == 0:
        raise SystemExit('Port 21000 is already occupied; leave its service unchanged.')
check = subprocess.run(['docker', 'container', 'inspect', 'mohan-cam-receiver'], capture_output=True)
if check.returncode:
    subprocess.run([
        'docker', 'run', '-d', '--restart', 'unless-stopped', '--log-driver', 'none',
        '--init', '--name', 'mohan-cam-receiver', '--cpus', '1.25', '--memory', '2g',
        '--pids-limit', '512', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
        '--read-only', '--tmpfs', '/tmp:rw,nosuid,size=256m',
        '--env-file', str(root / 'config/receiver.env'),
        '-v', f'{root}/sdk:/work/sdk:ro', '-v', f'{root}/app:/work/app:ro',
        '-v', f'{root}/wineprefix:/work/wineprefix', '-v', f'{root}/home:/work/home',
        '--entrypoint', '/bin/sleep', 'mohan-cam-playback:local', 'infinity'
    ], check=True, stdout=subprocess.DEVNULL)
else:
    subprocess.run(['docker', 'start', 'mohan-cam-receiver'], check=True, stdout=subprocess.DEVNULL)
(root / 'app/receiver-python.sh').chmod(0o700)
environment = os.environ.copy()
environment.update(
    HIK_PRODUCT_DATA_DIR=str(root / 'data'), HIK_PYTHON=str(root / 'app/receiver-python.sh'),
    PORT='21000', HIK_LISTEN_HOST='0.0.0.0', MAX_LIVE_STREAMS='16',
    PUBLIC_ORIGIN='http://187.127.189.231:21000', HIK_ALLOW_HTTP_PILOT='1')
with (root / 'logs/viewer.log').open('ab') as output:
    child = subprocess.Popen(['node', str(root / 'app/server.mjs')], cwd=root,
        env=environment, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
        start_new_session=True)
(root / 'viewer.pid').write_text(str(child.pid))
print(json.dumps({'started': True, 'port': 21000, 'pid': child.pid}))
