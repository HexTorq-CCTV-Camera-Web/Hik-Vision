"""One authorized SDK context, separate sessions and decoder queues per camera."""
import ctypes as C
import hashlib
import json
import os
from pathlib import Path
import queue
import sys
import tempfile
import threading

sys.path.insert(0, str(Path(__file__).resolve().parent))
import probe

lock = threading.Lock()
streams = {}
sdk = None
token_hash = None
handles = []

def emit(identifier, **event):
    with lock:
        print(json.dumps(dict(event, streamId=identifier)), flush=True)

def initialize(config):
    global sdk, token_hash
    digest = hashlib.sha256(config['accessToken'].encode()).digest()
    if sdk is not None:
        if digest != token_hash: raise ValueError('Account context changed')
        return
    directory = Path(os.environ['HIK_SDK_DIRECTORY'])
    os.chdir(tempfile.gettempdir())
    for sub in ['', 'HCNetSDKCom', 'PlayCtrl', 'Microsoft.VC90.MFC']:
        path = directory / sub
        if path.is_dir(): handles.append(os.add_dll_directory(str(path)))
    candidate = C.WinDLL(str(directory / 'OpenNetStream.dll'))
    candidate.OpenSDK_InitLib.argtypes = [C.c_char_p, C.c_char_p, C.c_char_p]
    candidate.OpenSDK_InitLib.restype = C.c_int
    if candidate.OpenSDK_InitLib(b'https://iindiaopenauth.ezvizlife.com', b'https://iindiaopen.ezvizlife.com', os.environ['HIK_SDK_APP_ID'].encode()):
        raise RuntimeError('SDK initialization failed')
    candidate.OpenSDK_SetAccessToken.argtypes = [C.c_char_p]
    candidate.OpenSDK_SetAccessToken.restype = C.c_int
    if candidate.OpenSDK_SetAccessToken(config['accessToken'].encode()):
        candidate.OpenSDK_FiniLib()
        raise RuntimeError('SDK authorization failed')
    candidate.OpenSDK_SetConfigInfo.argtypes = [C.c_int, C.c_int]
    candidate.OpenSDK_SetConfigInfo(4, 5)
    candidate.OpenSDK_SetConfigInfo(2, 1)
    sdk, token_hash = candidate, digest

def lines(commands):
    while True:
        item = commands.get()
        if item is None: return
        yield json.dumps(item) + '\n'

def worker(identifier, config, commands):
    try:
        code = probe.main(config=config, control=lines(commands),
            output=lambda stage, **event: emit(identifier, stage=stage, **event), shared=True)
    except Exception as error:
        emit(identifier, stage='probe-failed', errorType=type(error).__name__)
        code = 1
    finally:
        commands.put(None)
        with lock: streams.pop(identifier, None)
    emit(identifier, stage='pool-ended', exitCode=code)

try:
    for line in sys.stdin:
        if len(line) > 16384: continue
        command = json.loads(line)
        identifier = command.get('streamId')
        if not isinstance(identifier, int) or not 0 <= identifier <= 1000000: continue
        if command.get('action') == 'start':
            if len(streams) >= 32 or identifier in streams:
                emit(identifier, stage='probe-failed', errorType='StreamLimit')
                continue
            config = command['config']
            try: initialize(config)
            except Exception as error:
                emit(identifier, stage='probe-failed', errorType=type(error).__name__)
                continue
            commands = queue.Queue(maxsize=32)
            thread = threading.Thread(target=worker, args=(identifier, config, commands), daemon=True)
            streams[identifier] = (commands, thread)
            thread.start()
        elif identifier in streams:
            commands, thread = streams[identifier]
            try: commands.put_nowait(None if command.get('action') == 'stop' else command.get('command', {}))
            except queue.Full: pass
finally:
    active = list(streams.values())
    for commands, thread in active:
        try: commands.put_nowait(None)
        except queue.Full: pass
    for commands, thread in active: thread.join(3)
    if sdk is not None: sdk.OpenSDK_FiniLib()
