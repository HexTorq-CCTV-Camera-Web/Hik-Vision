# Hikvision camera viewer — v1

Standalone folder map and current startup paths: [STANDALONE.md](STANDALONE.md).


Separate Hikvision project. The working CPPlus/EzyKam implementation remains in `../../CPPLUS/v2`.

## Audio playback — 2026-10-23

The live viewer now has **Unmute / Mute**. Sound starts muted and requires a click. Stopping video, changing channel/quality, disconnecting, or hiding the tab cancels queued sound and closes its audio connection.

The receiver decodes audio from the same SDK media stream as video and converts it to 16 kHz mono PCM in memory. A session-protected `/api/live/audio` event stream feeds browser Web Audio. No audio recordings are saved. Buffer limits prevent a slow tab from accumulating old sound. Missing or unsupported audio does not intentionally interrupt video; the control reports unavailable audio when detected.

Validation: 25 Node tests and two Python audio tests pass. Chrome's actual Web Audio engine accepted a generated PCM packet, scheduled it, and closed cleanly on mute; that check used zero output gain. **Live camera sound has not been verified:** all five recorders were Offline during this change. Video and audio use separate delivery paths, so this prototype does not promise frame-accurate A/V synchronization.

Run `npm test`, `npm run test:audio`, and `npm run check`. Audio decoding requires the existing Python/PyAV installation. After a local server restart, reconnect Chrome; SDK playback also requires a valid imported SDK login session.

## Latest verification — 2026-10-22

The India portal (`iindia.hik-connect.com`) is supported. Five shared recorders and their 48 camera channels were verified through the signed-in account. KPM 5 now reports Online (status 1) with eight shared channels; the other four report Offline (status 2). Unknown status values remain unknown.

Shared recorder names and channels come from the observed read-only Sharing Details request, `POST /v3/hcweb/share/accept/device` with form field `deviceId`. The application lists these channels but does not start video. Nineteen automated checks pass. The user confirmed KPM 5 plays in iVMS-4200, and the desktop video process has active cloud connections. Standalone SDK authentication, video-byte reception, and browser playback remain pending. See [the stream investigation](STREAM-INVESTIGATION.md).

## Run locally

Node 22.9+ is required. No dependencies or build step are needed.

```powershell
cd K:\2026-SHOP\Playground\Camera\hikvision\v1
npm start
```

Open **http://localhost:8003**. Optional settings are documented in `.env.example`; `npm start` works without creating `.env`. Use `npm test` for integration tests and `npm run check` for JavaScript syntax checks.

1. Open the official Hik-Connect device portal in Chrome and sign in there.
2. Enable remote debugging in `chrome://inspect/#remote-debugging`.
3. In this local app, click **Connect signed-in Chrome**. Handle any Chrome connection approval prompt yourself.
4. The app retrieves the account's real device list. Once a DVR is added or shared, click **Refresh** and continue the channel/player capture.

The local server keeps the imported Hik-Connect session in memory, scoped to an opaque HttpOnly workspace cookie. Credentials are never returned to the frontend or written to disk. **Disconnect** clears this workspace's session; it does not sign out the official portal. Restarting the server requires reconnecting the workspace.

This browser-connected setup binds to loopback only and rejects non-local API hosts and cross-origin actions. It is not a public/VPS authentication solution. Independent account login, captcha/MFA handling, and production hosting need a separate verified implementation.

## Implemented and checked

- Separate responsive interface, real connection states, setup checklist, device-list refresh, and safe diagnostics.
- Read-only Chrome session bridge supporting legacy `/json/list` and current `DevToolsActivePort` browser-WebSocket discovery. It attaches only to the official Hik-Connect main-portal tab and detaches after reading its account session.
- Proxy for the observed owned-device and incoming-sharing endpoints, pagination, conservative device mapping, and session-expiry handling.
- Shared records with an unverified shape are explicitly flagged for capture rather than invented as playable cameras.
- Only `public/` is served. Configuration, server code, tests, and research notes are inaccessible through static routes.
- Sixteen automated checks cover session isolation, token handling, origin/host restrictions, Chrome discovery, cloud responses, pagination, and browser request recovery messages.
- Real-browser verification succeeded: the custom app connected to the signed-in account, the live Hik-Connect API returned zero devices, and the interface showed the add/share-DVR state with no console errors.

**Pending:** Non-empty device/share record mapping, channel enumeration, playback negotiation, decoder/SDK selection, quality switching, and real rendered video. No player or direct stream endpoint has been fabricated.

## Project structure

- `server.mjs`: local HTTP app and in-memory workspace sessions.
- `lib/browser-session.mjs`: read-only Chrome discovery and session connection.
- `lib/hik-connect.mjs`: captured Hik-Connect list routes and response adapters.
- `public/`: browser interface, styles, and diagnostics.
- `test/integration.test.mjs`: tests using synthetic sessions and mock cloud responses; tests never log in to your real account.
- `.env.example`: optional non-secret local configuration.

API routes: `GET /api/health`, `GET /api/status`, `POST /api/connect/browser`, `GET /api/devices`, and `POST /api/disconnect`. Browser actions require the app's JSON/custom-header request and same-origin checks. There is no playback route until the real DVR flow is captured.

## Intended behavior

1. Authenticate the user's Hik-Connect account using the flow supported by their portal.
2. Retrieve its devices and camera channels, including shared devices where supported.
3. Select a channel and render its cloud live video inside this custom website.
4. Fetch session and stream credentials at runtime, support quality selection, and stop/release streams correctly.

Devices may be analogue cameras attached to a Hikvision DVR. The integration targets the recorder's Hik-Connect channels; a directly reachable IP-camera stream is not assumed.

## Discovery status

Started 2026-10-16. Chrome and the local app are now connected, and the supplied account is already authenticated. Camera-list retrieval is implemented and verified against the real empty account. Playback integration is pending access to an actual device: the user confirmed the DVR has not yet been added/shared.

The user identified these official entry points:

- Login: `https://www.hik-connect.com/views/login/index.html#/login`
- Personal device management: `https://www.hik-connect.com/views/main/index.html#/common/personal/DeviceManagement`

The user supplied login credentials in chat; they are intentionally not saved here or in project configuration.

Read-only inspection of the public HTML and JavaScript confirmed:

- Both supplied HTML entry points return HTTP 200.
- The main portal loads `js/jsWebControl-1.0.0.min.js` and versioned JavaScript chunks.
- Its public source references a public-key endpoint and multiple login versions (`/v3/users/publickey`, `/v3/users/login/v6`, `/v3/users/login/v2`) alongside newer account/SSO services. These are source references, not a verified login recipe.
- The source contains navigation to `/common/personal/deviceManagement`. Actual device/channel requests, regional API routing, live-view transport, and any local plugin dependency remain unverified.

No additional login request has been attempted, and no account or device settings have been changed. The existing signed-in session was used for read-only inspection; credentials and session tokens are not saved in project files.

The user enabled Chrome remote debugging and the connector successfully attached. Keep site permission prompts user-controlled. Do not export passwords into this project or copy credentials from another browser profile.

### Authenticated findings

- Signed-in account email matches the email supplied by the user. Country: India, area ID 244.
- Device Management shows **No device**.
- My Shared Devices shows **No sharing**.
- Observed device request: `GET /v3/hcweb/devices/list?limit=10&offset=0`. HTTP 200; `meta.code=200`; `data.success=true`; `data.data=[]`.
- Observed sharing request: `GET /v3/hcweb/share/list?limit=10&offset=0`. HTTP 200; `resultCode="0"`; `shareInfos=null`.
- Incoming-share checks: `GET /v3/hcweb/share/news` returns `shareDevices=null`; `GET /v3/hcweb/share/domains` returns `data.data=null`, with successful result codes.
- Requests send a `sessionId` header and browser session cookie. Authentication succeeded; empty device results must not be mislabeled as an expired login.
- The portal loads a newer child application under `/views/main/child/attendance/`; static outer-shell bundles alone are insufficient to identify the live player.

The user confirmed that the DVR still needs to be added/shared, and requested all independent setup work in the meantime. Do not create a Team, add a device, accept a share, or change device ownership without the user's instructions.

## Confirmed public integration information

[Hikvision's Hik-Connect integration documentation](https://tpp.hikvision.com/products/HC-Integration) describes device management, cloud/P2P connectivity, and a WASM/JSDecoder kit for custom browser live view. It documents API key application and developer-tool access through its Technology Partner Portal.

Hik-Connect personal, Team, and Hik-Partner Pro portals may have different account, device, and playback flows. The user's exact working portal must be identified before selecting APIs or a decoder SDK. No EzyKam MQTT topics, Tuya signaling envelopes, or CPPlus login endpoints are assumed to apply.

## Capture checklist

- Exact portal URL, region, and account mode.
- Login/session renewal flow, without committing credentials.
- Device list and channel list request/response shapes.
- Start/stop live-view requests, transport protocol, and temporary tokens.
- Any browser SDK, WASM files, local plugin requirement, or encryption-code prompt.
- Main/substream selection and the actual frame resolution.
- A successful rendered frame before declaring playback working.

This is local development. No Hikvision site has been published and no camera configuration has been changed.
