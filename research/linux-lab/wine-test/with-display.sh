#!/bin/sh
set -eu
export DISPLAY=:88
Xvfb :88 -screen 0 1280x720x24 -nolisten tcp -ac > /work/logs/xvfb.log 2>&1 &
count=0
while [ ! -S /tmp/.X11-unix/X88 ]; do
  count=$((count + 1))
  if [ "$count" -ge 30 ]; then
    printf '%s\n' 'Virtual display did not become ready.' >&2
    exit 5
  fi
  sleep 0.2
done
exec /usr/lib/wine/wine64 /opt/windows-python/python.exe Z:/work/smoke.py
