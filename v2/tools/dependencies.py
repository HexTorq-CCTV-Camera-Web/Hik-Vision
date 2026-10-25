"""Print dependency versions only, without account or SDK credentials."""
import json
import sys
import av
import PIL

print(json.dumps({'python': sys.version.split()[0], 'pyav': av.__version__, 'pillow': PIL.__version__}))
