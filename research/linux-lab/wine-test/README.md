# Isolated Wine receiver experiment

Server workspace: `/home/mohan/cam`, owned by existing user `mohan`.
All Wine processes run with UID/GID 1006 inside a disposable Docker container.
Host packages and the existing Windows viewer are unchanged. Docker manages its
own image/layer cache as usual; test inputs, prefix, scripts and logs live in cam.

The test image contains Ubuntu 24.04, Wine 9 and Windows Python 3.11.9 x64.
The SDK bundle contains selected vendor binaries and their PE import dependencies,
plus HCNetSDKCom/PlayCtrl plugins. It excludes account logs and passwords.
The bundle must come from the installed, working client, not DLL download sites.
The MFC runtime in `Microsoft.VC90.MFC` is also required by MidPage.dll.

See [RESULTS.md](RESULTS.md) for the actual results and current unresolved gate.
For outbound Windows Python HTTPS tests, pass
`SSL_CERT_FILE=Z:/etc/ssl/certs/ca-certificates.crt`. Certificate verification
must remain enabled. This setting fixes the public Python HTTPS control but has
not resolved the proprietary SDK's device-details request failure.

Run as mohan:

```sh
cd ~/cam
bash run-load.sh
```

This first stage has no network access and supplies no camera credentials. It
tests Windows Python, DLL loading and expected exported functions only. A zero
exit code does not establish cloud reception, audio or production compatibility.

Subsequent authorization tests must receive credentials on stdin through SSH;
never put tokens in command arguments or committed files. `smoke.py` reports
numeric SDK results and response sizes, never raw cloud responses or tokens.

Next gates: SDK initialization; read-only device authorization; a short compressed
media capture from an online camera; native Linux video/audio decode; reconnect
and multi-camera measurements; independent sign-in/renewal and Linux key storage.
