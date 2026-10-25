"""Import container Ubuntu public CA certificates into this Wine user's ROOT store."""
import ctypes as C
import json
from pathlib import Path
import re
import ssl

crypt = C.WinDLL('crypt32')
crypt.CertOpenStore.argtypes = [C.c_void_p, C.c_uint32, C.c_void_p, C.c_uint32, C.c_wchar_p]
crypt.CertOpenStore.restype = C.c_void_p
crypt.CertAddEncodedCertificateToStore.argtypes = [C.c_void_p, C.c_uint32, C.c_void_p, C.c_uint32, C.c_uint32, C.c_void_p]
crypt.CertAddEncodedCertificateToStore.restype = C.c_int
crypt.CertCloseStore.argtypes = [C.c_void_p, C.c_uint32]
crypt.CertCloseStore.restype = C.c_int
# Python's Windows TLS defaults enumerate the local-machine certificate store.
store = crypt.CertOpenStore(C.c_void_p(10), 0, None, 0x20000, 'ROOT')
if not store:
    raise SystemExit('Could not open the isolated Wine certificate store.')
added = failed = 0
try:
    bundle = Path('Z:/etc/ssl/certs/ca-certificates.crt').read_text()
    for pem in re.findall(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----', bundle, re.S):
        encoded = ssl.PEM_cert_to_DER_cert(pem)
        buffer = C.create_string_buffer(encoded)
        if crypt.CertAddEncodedCertificateToStore(store, 1, buffer, len(encoded), 3, None):
            added += 1
        else:
            failed += 1
finally:
    crypt.CertCloseStore(store, 0)
print(json.dumps({'stage': 'wine-trust-store', 'added': added, 'failed': failed}), flush=True)
raise SystemExit(0 if added and not failed else 1)
