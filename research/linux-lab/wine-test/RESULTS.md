> Superseded by the successful 2026-10-24 Linux pilot tests: see
> [the current report](../standalone/RESULTS-2026-10-24.md). This file preserves the earlier failed experiment.

# Linux/Wine receiver feasibility test — 2026-10-23

Workspace: `/home/mohan/cam`, existing user `mohan` (UID/GID 1006).
Host: Ubuntu 24.04.4 x86-64. Disposable test image:
`mohan-cam-wine-test:local`, Ubuntu 24.04 / Wine 9 / Windows Python 3.11.9 x64.
No production service was deployed and no host Wine packages were installed.
Docker maintains its usual daemon-owned image cache outside the workspace.

| Gate | Result | Evidence |
| --- | --- | --- |
| Non-root Windows Python under Wine | PASS | `sys.platform=win32`, 64-bit pointers |
| Vendor DLL loading | PASS after adding MFC runtime | OpenNetStream plus all six tested exports load |
| SDK initialization | PASS | `OpenSDK_InitLib=0` |
| Set saved token locally | PASS | `OpenSDK_SetAccessToken=0`; this is not cloud authorization |
| Public domain DNS | PASS | Both India SDK domains resolve |
| Native Linux HTTPS | PASS | Root URLs return HTTP 404 with certificate verification successful |
| Windows Python HTTPS under Wine | PASS with explicit CA bundle | Both root URLs return 404 after `SSL_CERT_FILE=Z:/etc/ssl/certs/ca-certificates.crt` |
| SDK device-details request under Wine | FAIL / unresolved | Return -1, last-error -1, zero response bytes |
| Same saved credential/device on Windows | PASS | Device-details return 0, last-error 0, 3317 response bytes |
| SDK request with virtual display and CA configuration | FAIL / unresolved | Same -1 / zero-byte result |
| Live compressed media / video / audio | NOT VERIFIED | SDK device-details gate fails; recorders also reported offline |
| Multiple cameras / restart / renewal | NOT VERIFIED | Earlier gate must pass first |

## Findings and attempted corrections

1. The original `xvfb-run` wrapper stalled before launching Windows Python.
   Direct headless loading worked; a manually launched Xvfb also became ready.
2. First DLL load failed because MidPage.dll imports mfc90.dll. Added the installed
   client's Microsoft.VC90.MFC files and search directory; loading then passed.
3. Generic HTTPS under Windows Python initially failed certificate verification.
   Certificate-store import returned success but did not populate the roots
   enumerated by Python. An explicit Ubuntu CA bundle fixes Python HTTPS without
   disabling verification. This does not establish how the proprietary SDK's
   HTTP client handles certificates.
4. SDK cloud requests still failed with CA configuration and with a display.
   Module diagnostics found no further `err:module` failures in that request.
   The exact cause remains unknown: runtime behavior, SDK-specific networking,
   environment/IP differences or additional configuration still need investigation.

## Current conclusion

Wine can execute this SDK's initialization code on this VPS. End-to-end Hik-Connect
cloud reception is **not working yet**. Do not migrate the working Windows viewer
or describe the Linux receiver as production ready based on these results.

Next investigation: obtain a redacted SDK-specific failure trace for the device
request; check dynamically loaded components and application configuration; compare
the Windows and VPS request paths. After authorization works, test one online
channel, native Linux decoding, sound, reconnect, concurrency and token renewal.

Account passwords and installed account logs were not copied. Saved authorization
was passed through SSH stdin, not command arguments or a plaintext input file.
The report contains no tokens, device serials or raw cloud responses.
