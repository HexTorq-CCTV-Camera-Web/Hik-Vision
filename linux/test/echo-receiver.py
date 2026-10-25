import json
import os
import sys
streams = {}
for line in sys.stdin:
    message = json.loads(line)
    identifier = message['streamId']
    action = message['action']
    if action == 'start':
        streams[identifier] = message['config']['serial']
    if identifier in streams:
        print(json.dumps({'streamId': identifier, 'stage': 'fixture',
            'camera': streams[identifier], 'pid': os.getpid()}), flush=True)
    if action == 'stop':
        streams.pop(identifier, None)
        print(json.dumps({'streamId': identifier, 'stage': 'pool-ended', 'exitCode': 0}), flush=True)
