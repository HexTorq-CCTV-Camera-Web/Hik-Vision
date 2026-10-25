"""Wine SDK load/initialization check. Secrets arrive on stdin, never argv."""
import ctypes as C
import json
import os
from pathlib import Path
import struct
import time
import re
import sys


def emit(stage, **values):
    print(json.dumps(dict(stage=stage, **values)), flush=True)


def main():
    os.chdir(os.environ.get("HIK_PROBE_RUNTIME", r"Z:\work\runtime"))
    directory = Path(os.environ.get("HIK_PROBE_SDK_DIRECTORY", r"Z:\work\sdk"))
    handles = [os.add_dll_directory(str(directory))]
    for sub in ("HCNetSDKCom", "PlayCtrl", "Microsoft.VC90.MFC"):
        if (directory / sub).is_dir():
            handles.append(os.add_dll_directory(str(directory / sub)))
    emit("environment", platform=sys.platform, pointerBits=struct.calcsize("P") * 8)
    try:
        sdk = C.WinDLL(str(directory / "OpenNetStream.dll"))
    except OSError as error:
        emit("load-failed", winerror=getattr(error, "winerror", None), detail=str(error))
        return 2
    names = ("OpenSDK_InitLib", "OpenSDK_SetAccessToken", "OpenSDK_Data_GetDevDetailInfo",
             "OpenSDK_AllocSessionEx", "OpenSDK_SetDataCallBack", "OpenSDK_StartPlayWithStreamType")
    emit("library-loaded", exports={name: hasattr(sdk, name) for name in names})
    if "--load-only" in sys.argv:
        return 0
    config = json.loads(sys.stdin.readline())
    if config.get('com'):
        C.OleDLL('ole32').CoInitializeEx(None, 2)
    if config.get('searchPath'):
        C.WinDLL('kernel32').SetDllDirectoryW(str(directory))
        os.environ['PATH'] = str(directory) + ';' + os.environ.get('PATH', '')
    initialize = sdk.OpenSDK_InitLib
    initialize.argtypes = [C.c_char_p, C.c_char_p, C.c_char_p]
    initialize.restype = C.c_int
    finish = sdk.OpenSDK_FiniLib
    finish.argtypes = []
    finish.restype = C.c_int
    result = initialize(b"https://iindiaopenauth.ezvizlife.com", b"https://iindiaopen.ezvizlife.com", config["appId"].encode())
    emit("initialize", result=result)
    if result:
        return 3
    try:
        if "--init-only" in sys.argv:
            return 0
        sdk.OpenSDK_SetConfigInfo.argtypes = [C.c_int, C.c_int]
        sdk.OpenSDK_SetConfigInfo.restype = None
        sdk.OpenSDK_SetConfigInfo(4, 5)
        sdk.OpenSDK_SetConfigInfo(2, 1)
        if config.get("dataCenter"):
            sdk.OpenSDK_SetDataCenterConfig.argtypes = [C.c_char_p, C.c_char_p]
            sdk.OpenSDK_SetDataCenterConfig.restype = C.c_int
            emit("data-center", result=sdk.OpenSDK_SetDataCenterConfig(str(directory / 'DataCenterApi_EX.dll').encode(), b'https://apiiindia.hik-connect.com'))
        setter = sdk.OpenSDK_SetAccessToken
        setter.argtypes = [C.c_char_p]
        setter.restype = C.c_int
        emit("set-session", result=setter(config["accessToken"].encode()))
        if config.get("dataCenter"):
            sdk.OpenSDK_SetNonDeviceTkToken.argtypes = [C.c_char_p]
            sdk.OpenSDK_SetNonDeviceTkToken.restype = C.c_int
            emit("set-regional-session", result=sdk.OpenSDK_SetNonDeviceTkToken(config["accessToken"].encode()))
        if config.get('startupWait'): time.sleep(min(5, float(config['startupWait'])))
        details = sdk.OpenSDK_Data_GetDevDetailInfo
        details.argtypes = [C.c_char_p, C.c_int, C.c_bool, C.POINTER(C.c_void_p), C.POINTER(C.c_int)]
        details.restype = C.c_int
        pointer, length = C.c_void_p(), C.c_int()
        result = details(config["serial"].encode(), int(config.get("channel", 1)), True, C.byref(pointer), C.byref(length))
        sdk.OpenSDK_GetLastErrorCode.argtypes = []
        sdk.OpenSDK_GetLastErrorCode.restype = C.c_int
        emit("device-authorization", result=result, responseBytes=length.value, sdkError=sdk.OpenSDK_GetLastErrorCode())
        if result:
            desc = sdk.OpenSDK_GetLastErrorDesc
            desc.argtypes = []
            desc.restype = C.c_char_p
            raw = (desc() or b'')[:2000]
            vocabulary = {'init', 'initialize', 'initialized', 'not', 'null', 'context', 'sdk', 'error', 'failed', 'network', 'parameter', 'invalid', 'token', 'expired', 'timeout', 'connect', 'thread', 'ssl', 'certificate', 'unknown', 'library', 'load', 'interface'}
            terms = sorted(set(re.findall(r'[a-z]+', raw.decode(errors='ignore').lower())) & vocabulary)
            emit('sdk-error-classification', bytes=len(raw), terms=terms)
        if pointer.value:
            sdk.OpenSDK_Data_Free.argtypes = [C.c_void_p]
            sdk.OpenSDK_Data_Free.restype = C.c_int
            sdk.OpenSDK_Data_Free(pointer)
        return 0 if result == 0 and length.value > 0 else 4
    finally:
        finish()


if __name__ == "__main__":
    raise SystemExit(main())
