# Linux product migration: decisions and verification plan

Date: 2026-10-23. This is a migration plan, not a completed Linux integration.
The user confirmed that no Hikvision developer account, API key, or SDK package is available yet.

## What the current code establishes

- `native/probe.py` explicitly requires Windows and loads the installed `OpenNetStream.dll` through `ctypes.WinDLL`.
- The receiver uses the installed client's application identity. Production must use an application identity issued for our integration.
- `lib/browser-session.mjs` imports an existing Chrome session. This is local setup, not independent product authentication.
- The SDK authorization and portal session are separate credentials. A working device-list session does not establish SDK playback authorization.
- `native/probe.py` decodes received media and emits JPEG frames, throttled by `now - previous_frame >= 0.125`: at most approximately eight frames per second.
- `lib/live.mjs` sends these JPEGs to the browser as MJPEG. The browser does not receive the original H.265 bitstream.
- Audio currently has a separate PCM delivery path. Its implementation has automated validation; live camera audio remains unverified because the devices were offline at the latest check.

## Target architecture

Preferred, subject to provider compatibility verification:

```text
Browser -- HTTPS --> Linux Node application -- supported API --> Hik-Connect
   |                     |
   |                     +-- application sessions and encrypted account grants
   |
   +-- supported Hik-Connect browser SDK --> authorized cloud media service
```

The browser SDK's actual media routing, authorization, supported codecs, and deployment requirements must be checked against its developer package. This diagram does not establish that the existing personal-account shares are supported or that every connection will be direct P2P.

Fallback, only if a compatible Linux cloud receiver is supplied and verified:

```text
Hik-Connect --> Linux cloud receiver --> encoded-media gateway --> browser
                                                        audio + video
```

The existence of a Linux device SDK does not establish support for cloud playback of personal-account shares. Windows DLLs cannot simply be loaded by Linux Node or by browser JavaScript. Linux containers do not change that ABI dependency.

## Provider access: first integration milestone

Hikvision documents REST OpenAPI and a WASM/JSDecoder browser development kit. Its public integration page describes applying for an API key and obtaining developer tools after TPP approval:

<https://tpp.hikvision.com/products/HC-Integration>

Before choosing this as the replacement, obtain authoritative answers and test:

1. Does the integration support India-region Hik-Connect accounts?
2. Can it discover and play devices shared to a personal account, including KPM 5, without changing device ownership?
3. Is a Team account required? If so, what changes to permissions and enrollment are required? Do not move or rebind devices as a discovery step.
4. What end-user authorization and token renewal flow is supported? Distinguish application credentials from end-user grants.
5. Does the browser SDK support the camera's actual H.265 profile and audio codec on the intended desktop and mobile browsers?
6. If server-side reception is needed, is there a Linux cloud SDK for this exact service, account type, and region? Obtain its distribution and deployment requirements.

Suggested enquiry text, for the user to submit:

> We are building a Node.js application hosted on a Linux VPS. Our India-region Hik-Connect personal account receives shared access to DVR channels. We need read-only device/channel discovery and authorized browser live video and audio, with independent account authorization and supported credential renewal. Does Hik-Connect OpenAPI with JSDecoder support these existing personal-account shares? Please provide the appropriate developer access, regional documentation, authorization flow, SDK package and deployment terms. If this requires Team mode, please explain the migration and permission implications before any device changes.

No vendor enquiry has been sent by this workspace.

## Independent login and renewal

Our site's login and the connection to Hik-Connect are different layers:

1. A user signs into our application over HTTPS.
2. They link their provider account through the supported authorization mechanism.
3. The backend stores the authorized grant encrypted at rest, together with expiry, provider region, and user ownership. Encryption keys stay outside the database.
4. Before listing devices or starting playback, the backend validates the grant and renews it using the provider's documented mechanism, if available. Serialize concurrent renewals and atomically store rotated credentials.
5. Each playback request checks the current user's channel permission and obtains only the playback authorization needed by the supported SDK. Long-lived application secrets stay on the server.
6. Revocation, removed sharing permissions, and renewal rejection end access and request account reconnection when necessary.

Persistence can survive a Node restart; it cannot make an expired credential valid. A refresh-token-shaped value observed in a callback is not proof that we have a working renewal endpoint. Do not invent endpoints or implement password encryption from guesses.

Product acceptance requires a fresh browser with no Hik-Connect tab and no Chrome debugging, a server restart, credential expiry/renewal, revoked sharing, and separation between two application users. Existing local session import is not sufficient for those tests.

## Lower bandwidth and higher frame rate

The key change is to preserve inter-frame compressed video instead of turning each displayed frame into an independent JPEG.

- Prefer the supported vendor browser player if it can receive the existing authorized cloud stream and decode its codecs.
- For a gateway, retain compressed packets where possible, demux the received container and deliver a browser-compatible stream. Repackaging changes container/transport without decoding and re-encoding the pictures.
- MSE generally requires a supported container/codec combination, such as suitable fragmented MP4; raw vendor packets or MPEG-PS cannot simply be appended as an MP4 stream.
- WebCodecs can decode supported encoded chunks, but the application still needs transport, demuxing, timestamps, keyframe handling, scheduling, and synchronized audio. Check the exact codec configuration at runtime.
- If the original codec is unsupported, a vendor WASM decoder is a possible browser path, with CPU/battery limits that must be measured. A compatible server-transcoded stream is another path. WebRTC does not automatically convert H.265 to a supported codec.
- Where transcoding is necessary, share a single encoded channel output among viewers when practical, instead of transcoding separately per viewer.
- Deliver compressed audio with proper timestamps and bounded buffering alongside video; arbitrary independent PCM timing is not the final synchronization design.

Removing the 0.125-second JPEG throttle alone may increase output FPS, CPU consumption, and bandwidth. It does not recover frames that the camera never sends or solve the Linux cloud receiver dependency.

Measure actual camera FPS, encoded bitrate, viewer bandwidth, end-to-end latency, dropped frames, CPU/memory, audio synchronization, and multiple-viewer behavior. Do not promise 25/30 FPS before measuring the source and target devices.

Browser API references:

- <https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API>
- <https://developer.mozilla.org/en-US/docs/Web/API/MediaSource/isTypeSupported_static>

## How Windows connection inspection works

These are reproducible inspection commands, not captured historical output. Start iVMS live playback, then run in PowerShell:

```powershell
$ivmsProcesses = Get-Process | Where-Object { $_.ProcessName -match '^iVMS' }
$ivmsProcesses | Select-Object ProcessName, Id
$ivmsProcessIds = @($ivmsProcesses.Id)

Get-NetTCPConnection -State Established |
    Where-Object { $_.OwningProcess -in $ivmsProcessIds } |
    Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort, OwningProcess
```

`OwningProcess` associates a socket with a process ID. Compare playback stopped and started; the prior investigation observed port 7100 connections in the video process. This is evidence of a network connection, not an HTTP API trace, decrypted media, or a reusable camera URL. It covers TCP connections, not every possible UDP flow.

For a visual view, run `resmon.exe`, open Network, and select the relevant iVMS processes. TCP Connections shows endpoints. Application logs are a separate source of evidence: SDK operation names and result codes can be correlated with the playback start time. Raw vendor logs may contain credentials; share only redacted findings.

Previously inspected log locations:

```text
C:\Users\Public\iVMS-4200 Site\UserData\Log\Video.C
C:\Program Files (x86)\iVMS-4200 Site\iVMS-4200 Client\Client\log\opensdk\opensdk.log
```

Microsoft command reference:
<https://learn.microsoft.com/en-us/powershell/module/nettcpip/get-nettcpconnection>

## Implementation order and exit criteria

1. Obtain provider access and prove compatibility using one existing shared channel; no ownership changes.
2. Prove account authorization, device discovery, and renewal from Linux without Chrome or iVMS.
3. Prove compressed video and audio playback in a fresh supported browser. Benchmark before choosing gateway/transcoding capacity.
4. Implement durable application/account sessions, permission checks, bounded stream lifetimes, and account disconnect.
5. Package the Node application and any verified receiver as Linux services with HTTPS and secret injection. Do not expose the current loopback-only development server by merely changing its bind address.
6. Test restart recovery, expiry, revocation, reconnect, offline cameras, multiple viewers, and audio/video synchronization on target browsers.

Until steps 1-3 pass, Linux deployment, independent renewal, browser H.265 compatibility, and production audio synchronization remain unverified. The working Windows prototype remains available for comparison.
