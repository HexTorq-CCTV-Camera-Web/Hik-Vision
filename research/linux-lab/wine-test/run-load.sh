#!/bin/bash
set -euo pipefail
cd /home/mohan/cam
mkdir -p home runtime logs
chmod 700 home runtime logs
trap 'docker rm -f mohan-cam-wine-load >/dev/null 2>&1 || true' EXIT
result=0
timeout 80s docker run --rm --name mohan-cam-wine-load \
  --network none --cpus 1 --memory 2g --pids-limit 256 \
  --cap-drop ALL --security-opt no-new-privileges \
  --read-only --tmpfs /tmp:rw,nosuid,size=256m \
  -v "$PWD:/work" --entrypoint /usr/lib/wine/wine64 mohan-cam-wine-test:local \
  /opt/windows-python/python.exe \
  'Z:\work\smoke.py' --load-only > logs/load.log 2>&1 || result=$?
cat logs/load.log
exit "$result"
