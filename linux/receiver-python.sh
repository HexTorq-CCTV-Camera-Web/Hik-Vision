#!/bin/bash
set -euo pipefail
case "${1:-}" in
 */pool.py) script=Z:/work/app/native/pool.py ;;
 *) script=Z:/work/app/native/probe.py ;;
esac
exec docker exec -i mohan-cam-receiver /usr/lib/wine/wine64 /opt/windows-python/python.exe "$script"
