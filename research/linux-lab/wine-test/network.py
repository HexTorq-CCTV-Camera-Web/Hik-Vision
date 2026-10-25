"""Public endpoint DNS/TLS control under Windows Python; no account input."""
import json
import socket
import ssl
import urllib.error
import urllib.request

success = True
for host in ("iindiaopenauth.ezvizlife.com", "iindiaopen.ezvizlife.com"):
    result = {"host": host, "trustedRoots": len(ssl.enum_certificates("ROOT"))}
    try:
        result["dns"] = bool(socket.getaddrinfo(host, 443))
        try:
            with urllib.request.urlopen("https://" + host, timeout=15) as response:
                result["http"] = response.status
        except urllib.error.HTTPError as error:
            result["http"] = error.code
        result["tls"] = True
    except Exception as error:
        success = False
        result["errorType"] = type(error).__name__
        reason = getattr(error, "reason", None)
        result["causeType"] = type(reason).__name__
        result["verifyCode"] = getattr(reason, "verify_code", None)
        result["verifyMessage"] = getattr(reason, "verify_message", None)
    print(json.dumps(result), flush=True)
raise SystemExit(0 if success else 1)
