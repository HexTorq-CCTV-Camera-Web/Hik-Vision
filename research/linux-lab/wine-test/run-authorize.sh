#!/bin/bash
# A JSON configuration arrives on stdin. Never put access tokens in argv.
set -euo pipefail
cd /home/mohan/cam
trap 'docker rm -f mohan-cam-wine-auth >/dev/null 2>&1 || true' EXIT
timeout 60s docker run --rm -i --log-driver none --name mohan-cam-wine-auth \
  --cpus 1 --memory 2g --pids-limit 256 --cap-drop ALL \
  --security-opt no-new-privileges --read-only --tmpfs /tmp:rw,nosuid,size=256m \
  -e SSL_CERT_FILE=Z:/etc/ssl/certs/ca-certificates.crt \
  -e CURL_CA_BUNDLE=Z:/etc/ssl/certs/ca-certificates.crt \
  -v "$PWD:/work" --entrypoint /usr/lib/wine/wine64 \
  mohan-cam-wine-test:local /opt/windows-python/python.exe Z:/work/smoke.py
