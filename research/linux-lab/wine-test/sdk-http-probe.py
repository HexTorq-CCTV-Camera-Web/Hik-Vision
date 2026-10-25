"""Isolated HTTP diagnostics / explicit trusted CA configuration for the Wine SDK.
Patches only this process's import slot; no binary modification or TLS bypass.
"""
import ctypes as C
import json
import os
import struct
from pathlib import Path
import sys
from urllib.parse import urlsplit

directory = Path(os.environ.get("HIK_PROBE_SDK_DIRECTORY", r"Z:\work\sdk"))
os.chdir(os.environ.get("HIK_PROBE_RUNTIME", r"Z:\work\runtime"))
handles = [os.add_dll_directory(str(directory)), os.add_dll_directory(str(directory / "Microsoft.VC90.MFC"))]
sdk = C.WinDLL(str(directory / "OpenNetStream.dll"))
curl = C.CDLL(str(directory / "libcurl.dll"))
curl.curl_easy_perform.argtypes = [C.c_void_p]
curl.curl_easy_perform.restype = C.c_int
curl.curl_easy_setopt.argtypes = [C.c_void_p, C.c_int]
curl.curl_easy_setopt.restype = C.c_int
curl.curl_easy_getinfo.argtypes = [C.c_void_p, C.c_int]
curl.curl_easy_getinfo.restype = C.c_int
kernel = C.WinDLL('kernel32', use_last_error=True)
kernel.VirtualProtect.argtypes = [C.c_void_p, C.c_size_t, C.c_uint32, C.POINTER(C.c_uint32)]
kernel.VirtualProtect.restype = C.c_int
trusted = '--trusted-ca' in sys.argv
callback_type = C.CFUNCTYPE(C.c_int, C.c_void_p)
@callback_type
def perform(handle):
    if trusted:
        curl.curl_easy_setopt(handle, 10065, C.c_char_p(b'Z:/etc/ssl/certs/ca-certificates.crt'))
        curl.curl_easy_setopt(handle, 64, C.c_long(1))
        curl.curl_easy_setopt(handle, 81, C.c_long(2))
    result = curl.curl_easy_perform(handle)
    code = C.c_long()
    curl.curl_easy_getinfo(handle, 0x200002, C.byref(code))
    print(json.dumps({'stage':'sdk-http', 'explicitCA':trusted, 'curlCode':result, 'httpStatus':code.value}), flush=True)
    return result

def patch(module):
    base = module._handle
    def u32(off): return C.c_uint32.from_address(base + off).value
    pe = u32(60)
    optional = pe + 24
    imports = u32(optional + 112 + 8)
    patched = 0
    descriptor = imports
    while u32(descriptor) or u32(descriptor + 12):
        name = C.string_at(base + u32(descriptor + 12)).decode().lower()
        original, address = u32(descriptor), u32(descriptor + 16)
        if name == 'libcurl.dll':
            index = 0
            while C.c_uint64.from_address(base + original + index * 8).value:
                thunk = C.c_uint64.from_address(base + original + index * 8).value
                if not thunk & (1 << 63):
                    symbol = C.string_at(base + thunk + 2).decode()
                    if symbol == 'curl_easy_perform':
                        slot = base + address + index * 8
                        old = C.c_uint32()
                        if not kernel.VirtualProtect(slot, 8, 4, C.byref(old)): raise RuntimeError('Import permission')
                        C.c_void_p.from_address(slot).value = C.cast(perform, C.c_void_p).value
                        restored = C.c_uint32()
                        kernel.VirtualProtect(slot, 8, old.value, C.byref(restored))
                        patched += 1
                index += 1
        descriptor += 20
    return patched
print(json.dumps({'stage':'http-instrumentation', 'importsPatched':patch(sdk) + patch(C.WinDLL(str(directory / 'DataCenterApi_EX.dll'))), 'explicitCA':trusted}), flush=True)
sys.path.insert(0, str(Path(__file__).resolve().parent))
import smoke
raise SystemExit(smoke.main())
