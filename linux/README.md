# Hikvision Linux pilot

Standalone folder map and current startup paths: [STANDALONE.md](STANDALONE.md).


Running test URL: http://187.127.189.231:21000/
Remote workspace: `/home/mohan/cam`, service user `mohan` (1006).
Container: `mohan-cam-receiver`, restart policy `unless-stopped`.

This is a separate Linux deployment. Windows v2 is unchanged. Sign in using the
existing Windows viewer username and password; the owner password hash was imported,
not the provider password. Saved cloud grants are encrypted with AES-GCM. The Linux
key is protected by UID ownership and 0700/0600 directory/file permissions, not DPAPI.

## Runtime

Node runs in an Ubuntu container with Wine 9 and embedded Windows Python 3.11.9.
The authorized installed client supplies the SDK binaries. PyAV 18.1.0 / Pillow
12.3.0 decode H.265 and prepare H.264 or JPEG plus PCM audio. SDK sessions share one
SDK initialization per grant, while each camera has its own decoder and output
routing. The browser uses WebCodecs where available or a vendored, integrity-checked
JMuxer 2.1.4 / MediaSource fallback. Smooth playback therefore also works over the
temporary HTTP IP address. Audio remains a separate buffered stream.

The source SDK, grants and account data are outside the HTTP public directory.
Only port 21000 is published. Container limits: 1.25 CPU, 2 GiB RAM, 512 processes;
application cap: 16 active streams including standby rotation streams. This
2-core VPS does not have a verified 16-camera HD/30fps capacity guarantee.

## Operations (as mohan)

```sh
docker restart -t 20 mohan-cam-receiver
docker ps --filter name=mohan-cam-receiver
docker stats --no-stream mohan-cam-receiver
docker exec mohan-cam-receiver sh -c 'node --test /work/app/test/*.test.mjs'
```

`deploy-service.py` builds the service from prepared files and changes only this
workspace's named container. The two Dockerfiles in runtime-build build the test and
codec images; `Dockerfile.service` adds the official Node runtime. Sensitive
account import/operator helpers consume or emit private pipes. Never run their
credential-bearing output in a terminal or redirect it to a public log. Their
files are not browser endpoints.

## Remaining production work

- This IP deployment uses plain HTTP. Configure HTTPS before regular remote use.
- Independent SDK login and automatic Hik-Connect grant renewal are unfinished.
  Playback currently uses the imported, valid account/playback grant. Expiry or
  revocation requires reauthorization; restarting is not credential renewal.
- PC-microphone talk is disabled on Linux. Browser microphone forwarding is not
  implemented.
- Camera availability changes independently of the viewer. An online recorder
  may also have channels without audio or without an attached video source.
- Final rotation acceptance and a complete 48-channel sweep require the recorders
  to remain online. See RESULTS-2026-10-24.md for measured coverage and limitations.


## Persistent recordings - local source, 24 October 2026

This update is local only; it has not been deployed to the VPS.
Finished browser recordings automatically upload to authenticated server storage.
Windows stores files and the atomic metadata index under the viewer data directory's
`recordings` folder. The local Linux source uses its own configured data directory.
No recordings are placed in the public web directory.

Settings is a separate navbar tab. Retention choices are 1, 7, 30 and 90 days
(1 day, 7 days, 1 month and 3 months). Default: seven days and 5 GB of recording
storage. The configurable limit is 0.25-1024 GB. Expired clips and oldest clips
over the limit are removed automatically every minute and on storage operations.
Reducing the settings applies cleanup immediately. A free-disk reserve prevents
uploads from consuming the last 256 MB of server disk.

The Settings page reports recording bytes used, configured limit, available
capacity, clip count, percentage used, retention and last cleanup time. Recordings
remain accessible to the authenticated viewer when Hik-Connect is disconnected.
Downloads and range-based video playback require viewer authentication.

Keep the browser tab open while recording or while a finished clip is saving.
Once a clip says Saved to server it survives refresh and server process restarts.
A failed upload retains its local clip with Retry save and Download controls;
retry IDs prevent duplicate recordings after a response is lost.

Validation: 71 Windows tests; 15 portable storage/recovery tests against the local
Linux source. Synthetic browser checks covered actual MediaRecorder video+audio,
auto-upload, playback after reload, retained settings, failed-upload retry, deletion
after a library refresh, and a 390px mobile Settings layout. No VPS actions used.


## Connection feedback - local source, 24 October 2026

Local-only update. No VPS deployment or SSH actions were performed.
Camera tiles distinguish recorder-offline, channel-unavailable, expired web sign-in,
missing/expired playback authorization, viewer-server connectivity, provider cloud
failures and receiver/decode/timeouts. Appropriate buttons refresh cameras, retry,
try SD, or open the existing authorization recovery flow.

Only explicit authorization evidence is labelled expired. Provider HTTP 403,
non-200 business responses, cloud outages and SDK startup errors do not themselves
prove session expiry and do not delete saved authorization. Generic SDK errors are
not assigned undocumented vendor meanings. Native error categories also travel in
stream state events after an already-playing camera fails.

Server/cloud banners clear on verified recovery; failed library refreshes identify
last-known statuses. Errors retain accessible status text and 44px mobile actions.
77 Windows tests passed, including six connection-feedback regressions. 21 portable
connection/storage/recovery tests passed against the local Linux source. Synthetic
browser checks exercised channel denial, offline recorder, viewer-server failure,
cloud outage, playback authorization, web sign-in expiry and recovery actions, plus
the mobile feedback layout. Actual outage evidence is not inferred from the tests.


## Adaptive streaming - local source, 24 October 2026

Local only; no VPS access or deployment.

Auto quality uses SD in multi-camera grids and HD for an enlarged camera, a
single-camera grid or individual-camera fullscreen. Other hidden cameras pause.
Returning to the grid resumes previously requested cameras in SD. Explicit HD/SD
choices override Auto and are preserved in saved layouts. Try SD error recovery
also makes a manual SD choice, preventing an automatic return to a failing HD stream.

Browser background tabs and non-live pages release unused camera streams.
Active recordings retain their existing connection/quality, and selected listening
uses one SD stream. Returning resumes only previously requested cameras; cameras
manually stopped by the user stay stopped. The same recorder can be reopened without
interrupting an active recording. Explicitly choosing another recorder retains the
existing behavior of finalizing clips from the outgoing recorder.

Rotation maintains its current/next batch while viewing the grid. Background
navigation/tab hiding stops preloading and pauses rotation; return restarts it with
a fresh interval. Opening a focused camera stops rotation. Thumbnail fetching runs
on the recorder-library page, rather than opening extra snapshot connections during
live view, recording management or Settings.

Adaptive startup runs in pairs, cancels stale target choices and serializes per-tile
stop barriers. Old HD requests cannot revive a manually stopped or replaced camera.
The policy does not restart a protected recording merely to change its quality.
Recording capture is still browser-based: OS/browser background throttling can affect
capture frame rate. This feature is not unattended server-side recording.

Validation: 85 Windows tests; 29 portable local-Linux-source tests. Synthetic browser
checks demonstrated eight SD streams -> one HD focused stream -> eight SD streams,
zero unused streams on Settings, one selected SD audio stream, recording protection
while enlarging another camera or returning to the library, persistent clip save,
manual-stop preservation, manual SD/Auto selection, rapid focus cancellation, and
rotation preloading/pause/resume. No real-camera bandwidth or CPU benchmark is claimed.
