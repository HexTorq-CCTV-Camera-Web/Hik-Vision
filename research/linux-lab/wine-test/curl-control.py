"""Exercise the vendor HTTP library against public roots; no account input."""
import ctypes as C
import json
import os
from pathlib import Path
os.chdir(r"Z:\work\runtime")
handles = [os.add_dll_directory(r"Z:\work\sdk")]
lib = C.CDLL(r"Z:\work\sdk\libcurl.dll")
lib.curl_global_init.argtypes = [C.c_long]
lib.curl_global_init.restype = C.c_int
lib.curl_global_init(3)
lib.curl_easy_init.restype = C.c_void_p
lib.curl_easy_setopt.argtypes = [C.c_void_p, C.c_int]
lib.curl_easy_setopt.restype = C.c_int
lib.curl_easy_perform.argtypes = [C.c_void_p]
lib.curl_easy_perform.restype = C.c_int
lib.curl_easy_getinfo.argtypes = [C.c_void_p, C.c_int]
lib.curl_easy_getinfo.restype = C.c_int
lib.curl_easy_cleanup.argtypes = [C.c_void_p]
lib.curl_version.restype = C.c_char_p
print(json.dumps({"stage":"vendor-http-version", "version":lib.curl_version().decode()}), flush=True)
callback = C.CFUNCTYPE(C.c_size_t, C.c_void_p, C.c_size_t, C.c_size_t, C.c_void_p)
@callback
def discard(ptr, size, count, user): return size * count
for host in ("iindiaopenauth.ezvizlife.com", "iindiaopen.ezvizlife.com"):
 for explicit_ca in (False, True):
  h = lib.curl_easy_init()
  url = ("https://" + host + "/").encode()
  lib.curl_easy_setopt(h, 10002, C.c_char_p(url))
  lib.curl_easy_setopt(h, 20011, discard)
  lib.curl_easy_setopt(h, 13, C.c_long(15))
  lib.curl_easy_setopt(h, 78, C.c_long(10))
  if explicit_ca: lib.curl_easy_setopt(h, 10065, C.c_char_p(b"Z:/etc/ssl/certs/ca-certificates.crt"))
  code = lib.curl_easy_perform(h)
  status = C.c_long()
  lib.curl_easy_getinfo(h, 0x200002, C.byref(status))
  print(json.dumps({"stage":"vendor-http-control", "host":host, "explicitCA":explicit_ca, "curlCode":code, "httpStatus":status.value}), flush=True)
  lib.curl_easy_cleanup(h)
