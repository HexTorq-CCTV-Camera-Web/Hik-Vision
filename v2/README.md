# Hikvision Windows v2

Standalone folder map and current startup paths: [STANDALONE.md](STANDALONE.md).


Windows product development comes first. Linux migration is deferred until the Windows acceptance checks pass. This is an alpha build in a separate folder; v1 on port 8003 is unchanged. This build uses port 8004.

## Run

Requires Windows, Node 22.9+, Python with the dependencies in `native/requirements.txt`, and the installed iVMS/OpenNetStream SDK used by the working prototype.

```powershell
cd K:\2026-SHOP\Playground\Camera\hikvision\v2
npm start
```

Open <http://localhost:8004/>. On first launch, create a viewer username and a password of at least 12 characters. This owner account protects this workspace; it is separate from the Hik-Connect login. Never send either password in diagnostics or chat.

Use **Import account from Chrome** to save the current authorized provider connection. For playback, the importer can also recover an available SDK callback result. Otherwise click **Use iVMS playback sign-in**: it reads the installed client's recorded India SDK sign-in, verifies it against a channel independently shared with the linked web account, and saves it encrypted only after that authorization succeeds. The read-only SDK verification succeeded against this account on 2026-10-23; no video was started. A provider web session alone is not an SDK playback grant.

The independent provider-password form is experimental and has not completed a real account login test.

## Live audio

The browser receives mono 16 kHz PCM through a separate authenticated audio event stream, isolating audio delivery from large video packets and video reconnections. Click **Unmute** to listen; only the selected tile is audible. On 2026-10-23, live video and increasing decoded audio samples were verified on four simultaneous feeds from KPM 5, KPM Bus 4 and KPM 3. The user confirmed clear camera sound in the browser. This confirms listening audio; microphone talk remains a separate acceptance check.

These recorders provide G.711 mu-law audio in MPEG program streams that FFmpeg labels as MP2. `native/ps_audio.py` reads the SDK's HIK_MEDIAINFO header, extracts bounded audio PES payloads, decodes the identified G.711 variant and resamples it for the existing browser player. Other formats retain the PyAV demux/decode path. No codec is guessed from arbitrary audio bytes, and no PlayCtrl audio device or microphone is opened for listening. `audioCodec`, `audioDecoder` and fixed error metadata are available in authenticated stream status; raw upstream errors and packet bytes are omitted.

## Smooth video

**Playback → Smooth** is the default when the browser exposes WebCodecs. The Windows receiver decodes the camera's H.265 and encodes low-delay H.264; Chrome decodes that compressed video into a canvas. One authenticated video event stream carries all grid tiles; a second authenticated event stream carries only focused camera audio. No WebRTC connection or direct browser-to-camera P2P is claimed. Base64 transport overhead remains, but independent JPEG pictures are no longer sent in this mode.

Smooth playback uses camera timestamps with approximately 900 ms of initial video/audio buffering. This deliberately adds about one second of viewing delay to absorb cloud delivery bursts. The video queue holds up to 50 decoded frames, rebases large timestamp discontinuities and releases old frames after congestion. Audio schedules consecutive buffers contiguously, adapting its buffer after an underrun instead of inserting a safety gap before every packet. Excess audio backlog is bounded to approximately three seconds. Compatibility retains its shorter initial audio buffer. Native base64 decoding is used when available, with a loop-based fallback. Legacy clients can still request audio on their combined event stream.

After the initial small-buffer Smooth build still interrupted, the revised timestamp-buffered build was verified on KPM 3 / Camera 01: a 15-second live sample delivered 150 audio packets with zero scheduling gaps or underruns and 223 displayed video frames. The user then confirmed that both picture and sound were steady. Longer interruptions from the upstream camera connection can still exceed the playout buffer.

The H.264 targets are 1.2 Mb/s for HD and 320 kb/s for SD before base64 and audio. Output preserves incoming frame timing up to 30 fps instead of the JPEG path's 8 fps cap. Actual delivered FPS depends on camera configuration, cloud delivery and receiver performance; no frames are invented to promise 30 fps. The player bounds decode and display queues, waits for keyframes after reconnecting, and automatically falls back if H.264 browser decoding fails. **Playback → Compatibility** selects the original JPEG path manually. Snapshots, zoom, picture sizing, recording and selected-camera audio work with the canvas surface. Clip capture now permits up to 30 fps.

On 2026-10-23, the user confirmed that Smooth mode looked much smoother. Tested scene samples used approximately 24–57 KB/s for base64 video payloads; this is not a fixed network cap. The tile footer reports current encoder output FPS and approximate video payload KB/s, excluding JSON envelopes, audio, status traffic and TCP/TLS overhead. Selected-camera PCM audio adds roughly 43 KB/s before its JSON envelopes. These figures measure receiver-to-browser delivery, not the separate camera-to-receiver cloud link. A mobile indication of 300 KB/s means about 2.4 Mb/s, not 300 kb/s.

This is software transcoding. Sixteen simultaneous HD encoders have not been performance-qualified; use SD for small grid tiles. Direct compressed-video forwarding would need a browser-decodable source codec or another verified H.265 decode path.

The viewer is a single-owner application, with multiple authenticated browser sessions. It is not a multi-tenant SaaS release.

## Saved access

### Recorder grids and previews

Click a recorder heading or choose it in the recorder filter to stop the previous layout, assign all shared channels and start them automatically. The grid picks 1, 4, 9 or 16 positions to fit up to 16 channels; unused positions in recorder layouts are hidden. Multi-camera layouts start with SD to reduce bandwidth. Device switches cancel old queued starts, and offline recorders show their channels without opening receivers. Device availability refreshes every 30 seconds while the page is visible.

Click a camera tile or its library card to enlarge it; **Back to cameras** restores the grid. **Group picture** applies Fit, Fill or Original size to every visible tile and becomes the default for the next recorder. The selected camera retains an individual picture-size control. Group picture preference is saved in the encrypted viewer settings.

Preview snapshots load automatically for every online camera without selecting it. The viewer requests one snapshot at a time and refreshes each successful image after five minutes. The server shares a five-minute memory cache across tabs and reuses an existing camera receiver when available. Otherwise it briefly opens an SD receiver, decodes a single thumbnail (up to 320 x 180), and stops that receiver immediately. These background snapshots count toward the global connection limit; foreground live playback takes priority. Offline cameras keep their last image, and unavailable snapshots retry on the next cycle. Snapshots are labelled separately from live playback and do not change the active grid. No preview images are saved to disk; disconnecting or changing the provider account clears the cache.

Browser verification covered 8- and 16-channel automatic grids, camera enlargement/return, preview refresh, group Fill, rapid recorder switches and offline layouts without native starts.

Live verification on KPM 3 reached eight playing channels and eight generated previews. Camera 03 enlarged and returned to the eight-camera grid without stopping the other streams. Group Fill and Original size applied to all eight pictures, and the saved group setting was verified through the preferences API. Two initial startup timeouts recovered on retry; transient decoder-timeout messages now remain eligible for automatic reconnect instead of being classified as account failures merely because their help text mentions reconnecting an account.

The default data folder is `%LOCALAPPDATA%\HikvisionCameraProductV2`, outside the repository:

- `key.dpapi`: the encryption key protected with Windows DPAPI for the current Windows user.
- `accounts.vault`: AES-256-GCM authenticated encryption of the owner password hash, viewer-session hashes, and linked provider credentials.

Passwords submitted to Hik-Connect are not stored. Viewer passwords use salted scrypt. Browser cookies are opaque, HttpOnly, SameSite Strict and valid for up to 30 days; their hashes are persisted. HTTPS hosting adds Secure cookies. Signing out invalidates the current viewer session and stops its media; it does not remove the saved provider connection. **Remove saved connection** deletes the stored provider grant and stops all viewer streams. Changing the viewer password revokes other viewer sessions.

Restarting the server preserves saved access. A callback grant has its observed expiration checked. The installed-client log does not establish an SDK token expiration time, so this path records the successful validation time without inventing an expiry. The native receiver checks authorization again when opening a channel. SDK rejection and a rejected provider session require reauthorization. No verified provider refresh flow exists yet; this release does not claim automatic renewal. A missing or corrupted vault key causes a safe startup failure rather than silently replacing the account store. DPAPI ties access to this Windows account: copying the encrypted files alone to a different Windows account or Linux will not unlock them.

A Windows named-pipe guard enforces one server instance per data directory, preventing concurrent vault writers even on different HTTP ports. Stream/device state is transient and rebuilt after startup; no camera video recordings are saved by this app. The installed SDK can generate its own diagnostics in a temporary runtime directory.

## Startup and diagnostics

```powershell
.\scripts\doctor.ps1
.\scripts\start.ps1
```

`start-hidden.ps1` starts the server without a visible window. After acceptance, `scripts/install-startup.ps1` registers a logon task under the current Windows user, with up to three restarts after failure. It does not overwrite an existing task or change the running server. No task has been registered automatically. Use the same Windows user that created the account store.

The doctor checks dependencies and DLL exports; it does not sign into the account or start a stream. The `HIK_PYTHON` and `HIK_SDK_DIRECTORY` environment variables select alternate installations. Node loads `.env` when starting; the PowerShell doctor uses its current environment.

## Remote hosting

The backend binds to loopback. For authorized remote use, complete owner setup locally first, place it behind an HTTPS reverse proxy, and set `PUBLIC_ORIGIN` to the exact external HTTPS origin. Preserve the public Host header. Remote owner setup is rejected and cookies become Secure. Do not publish the Node development port directly. An actual domain, TLS proxy and remote-device acceptance test have not been configured in this workspace.

## Validation

```powershell
npm test
npm run test:audio
npm run test:video
npm run check
```

Tests cover real DPAPI key wrapping on Windows, encrypted persistence/reopening, tamper detection, concurrent owner setup, disk-write rollback, session revocation, request origin checks, cloud credential exposure, channel permission checks, expired SDK grants, provider expiry and audio scheduling/resampling. HTTP playback tests use a simulated receiver; they do not establish live camera playback in v2.

## Remaining release checks

1. Create the actual viewer owner and import the actual shared account.
2. The installed-client credential was verified read-only against an actual shared channel. Test the new **Use iVMS playback sign-in** control and its saved state through restart in the user's account; a fresh iVMS login may be required if that credential is rejected.
3. Confirm live video, sound, channel/quality changes and stopping the receiver using an online recorder. Previous v1 video verification does not substitute for this v2 test. Real audio was previously unverified while cameras were offline.
4. Restart v2 and verify the saved connection from the user's browser without repeating account import while credentials remain valid.
5. Establish and test the actual provider renewal or required reauthorization flow. No guessed endpoint or password retry loop is implemented.
6. Replace JPEG delivery with an evaluated compressed-video path, then measure FPS, bitrate, latency and audio synchronization. This alpha retains the prototype's approximately eight-FPS MJPEG and separate PCM path.
7. Configure and verify HTTPS remote hosting, startup recovery and operational behavior before declaring a Windows product release.

The Linux lab stays separate. The later Linux migration must replace the Windows receiver and Windows key protection; the app/account/media boundaries in this build make those dependencies explicit.

## Buffered camera rotation

Rotation connects the next batch in hidden tiles while the current batch stays live. A batch becomes eligible to switch only after every assigned camera has displayed a fresh picture (including Smooth playback buffering). A slow or unavailable camera holds the current view; the toolbar shows how many next-batch cameras are ready. The interval is the minimum viewing time, not a deadline that forces a blank view.

Returning to an already connected batch reuses its streams. Only the current and upcoming batches remain connected. Stop rotation, changing recorder/grid/filter, or expanding a camera cancels preloading and releases hidden streams. Stopping rotation keeps the displayed cameras running. Clips on an outgoing batch are finalized when it switches. When listening is enabled, the next selected camera's sound is buffered at zero volume and adopted at the switch when available.

The viewer still shows at most 16 cameras. Its 32 internal stream slots allow two full batches; MAX_LIVE_STREAMS defaults to 32 across all viewer sessions. An explicitly configured lower cap is respected. Preloading adds bandwidth, native decoding/encoding and browser memory/CPU use for the next batch. Other viewer sessions share the same server cap. Camera connection limits and offline cameras can delay readiness; the viewer does not bypass those limits.

The camera library now uses recorder preview covers with explicit Online/Offline/Unknown pills, live camera counts, and a separate Channels disclosure. Channels appear as a two-column thumbnail contact sheet with names, channel IDs, listening-independent live state, favourites and a selected-camera outline. Search and favourites expose matching channels automatically. Disclosure state and library scroll position survive device refreshes. Automatic snapshots populate unopened cameras and refresh every five minutes; offline retained snapshots are labelled LAST SEEN. A serial background queue opens short SD connections only when an existing receiver cannot provide a snapshot. The layout was browser-checked at desktop and 390px mobile widths.


### Account sign-in popup

The account card now exposes one Sign in to Hik-Connect action. The modal accepts only account ID and password; the page no longer exposes Chrome import, desktop playback sign-in, region selection or a verification-code field. The server starts with the India portal and follows at most one explicit allowlisted regional redirect. Rejected credentials are not retried automatically. Passwords are cleared from the form immediately after submission and are not persisted. Existing playback authorization is retained only when the newly signed-in account identity matches the saved account. A portal login by itself still does not issue independent SDK playback authorization; the modal reports that limitation when needed. Provider-required verification is not bypassed.


Account management is in the top-right navbar menu: Hik-Connect identity, connection/playback status, sign-in popup and disconnect, plus viewer password settings and viewer sign-out. The sidebar starts with the camera library. The menu closes on outside click or Escape and fits a 390px mobile viewport.

The account dropdown uses a dark profile header, compact playback-access card, icon action rows, separate viewer-security section and a quiet session footer. Password-change feedback appears in the menu; password fields clear after submission and when the menu closes. Connected/disconnected layouts and 390px mobile sizing were verified with the synthetic fixture.

The workspace now stacks a full-width recorder library above the live monitor. Recorder covers form a horizontal row (scrollable on small screens); Channels opens full-width contact sheets underneath. Selecting another recorder closes the previous automatically expanded channel panel. The sidebar and connection checklist were removed. Browser checks covered five-card desktop geometry, mobile scrolling without page overflow, automatic eight-camera assignment and camera enlargement/return.


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
