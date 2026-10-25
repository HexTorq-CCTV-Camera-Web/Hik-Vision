#!/bin/bash
set -euo pipefail
umask 077
cd /home/mohan/cam
trap 'docker rm -f mohan-cam-http-probe >/dev/null 2>&1 || true' EXIT
timeout 65s docker run --rm -i --log-driver none --name mohan-cam-http-probe \
 --cpus 1 --memory 2g --pids-limit 256 --cap-drop ALL \
 --security-opt no-new-privileges --read-only --tmpfs /tmp:rw,nosuid,size=256m \
 -v "$PWD:/work" --entrypoint /usr/lib/wine/wine64 \
 mohan-cam-wine-test:local /opt/windows-python/python.exe Z:/work/sdk-http-probe.py "$@"
