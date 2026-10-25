> Update 2026-10-24: Linux/Wine cloud reception now works in the separate
> [standalone pilot](standalone/README.md). See its [acceptance report](standalone/RESULTS-2026-10-24.md).
> The independent login/renewal investigation below remains unfinished.

# Hikvision Linux lab

A separate custom-integration investigation. No developer key or Windows DLL is required by this lab's Node code. No files are imported from `../v1`; no existing app server is stopped or reconfigured. This is a CLI experiment, not a second working camera viewer.

## Current milestone

An independent personal-portal login client, implemented from the official portal's observed JavaScript. The unauthenticated India public-key request succeeds directly from Node and returns a 2048-bit RSA key. It does not read a Chrome session or invoke the installed SDK.

Real password login, verification challenges, SDK playback authorization, session renewal and Linux cloud reception are not yet verified. To preserve the running v1 account session, this investigation has not submitted a new password login or logged the account out. A new provider login may affect existing sessions; the first real login experiment should use a separate test account or a time when the current viewer can be interrupted.

## Run

Requires Node 22.9 or newer. No npm packages to install.

```text
cd hikvision/linux-lab
npm run probe
npm test
npm run check
```

`probe` only fetches the public login key. It does not submit credentials. Output includes key type/size and the platform actually tested; success on Windows does not establish a successful Linux deployment.

The independent login experiment is available for a separate test account:

```text
npm run login
```

It prompts for the account and hides the password in an interactive terminal. Credentials are not accepted as command-line arguments, printed, or stored. On success it queries the shared-device list, prints only counts, and discards its in-memory session on exit. It does not call provider logout, start streams, modify sharing, or alter device configuration.

For automation, `node cli.mjs login --stdin` accepts a JSON object containing `account`, `password` and optionally `imageCode`. Supply it through a trusted pipe; do not put passwords in shell history or committed files. `HIK_LAB_ORIGIN` accepts only `https://iindia.hik-connect.com` or `https://www.hik-connect.com`. `HIK_LAB_FEATURE_CODE` optionally supplies a stable client feature identifier.

The official site generates a browser fingerprint as its feature code. The lab currently generates a random 32-character identifier when none is configured. Whether the provider accepts that identifier must be verified. CAPTCHA, trusted-terminal checks, regional handoff and MFA are not bypassed. The lab does not automatically retry a rejected password login.

## Findings, 2026-10-23

Read-only inspection of the already-open official portal identified these loaded modules:

| Module | Observed behavior | Verification level |
| --- | --- | --- |
| HCBLogin `6c974f` | GET `/v3/users/publickey`, POST `/v3/users/login/v6`, form-encoded request | Static source observed; key GET also verified from Node |
| HCBLogin `3d0e75` and `c35461` | Hash password with MD5, append a comma and Unix time in seconds, encrypt using JSEncrypt and the server public key | Static source observed; Node envelope verified with a generated RSA key |
| HCBLogin `9fb987` | clientType 48, clientSource 0, customno 1000002, featureCode, sessionId header | Static source observed |
| HCBVideo `52a44a` | Browser player methods including JS_Play, JS_OpenSound, JS_PlayWithBinaryData, JS_StopWebCodecs | Present in loaded source; not proven usable for personal shares |
| HCBVideo `724ff6` / `0788f6` | Player token request at `/resource/v1/vms/system/token/get` | Static candidate, not called or verified for this account |
| HCBVideo `f7df35` | Converts an ezopen descriptor through `/api/lapp/live/url/ezopen`, with an accessToken and environment domain | Static candidate; domain/token compatibility unverified |

Source inspected: the modules loaded by <https://www.hik-connect.com/views/login/index.html>. Module IDs and endpoints can change. Presence of a player in a shared bundle does not imply the personal portal exposes or authorizes it. Some modules refer to Team resource services. An ezopen descriptor is not by itself a browser-playable stream.

No vendor bundles, application secrets, captured account credentials or raw account responses are checked into this folder. No guessed refresh endpoint is implemented. This is separate from the developer-key integration route described in the v1 migration plan.

Further inspection of `724ff6` shows that the player token response is processed with `AESDecrypt(accessToken, challenge, iterateNum, userId, sessionId)` and associated with a platform user/session. This is evidence of an additional authorization layer, not proof that the personal portal cookie can call that service. The token request and decryption have not been executed. Follow the request wrapper, authorized account context, regional environment and actual response before implementing this path.

## Work sequence

1. **Independent portal login.** Verify a real login with an isolated test account. Compare required fingerprint/header fields, region handoff and manual verification behavior against an actual official login trace. Do not treat a public-key response as proof of account access.
2. **Playback authorization.** Follow the loaded player's token acquisition and environment selection. Determine whether the personal shared account is eligible, or whether the token endpoint requires Team authorization. A web session is not assumed to be an SDK token.
3. **Cloud media transport.** If an authorized browser media path works, test it without installed iVMS. Otherwise investigate the authorized native client's transport in isolation. Identify negotiation, framing, authentication, keepalive and encryption requirements from evidence. Port 7100 alone supplies none of these details. This stage may be substantial protocol work and is not yet proven feasible on Linux.
4. **Compressed video and audio.** Preserve source compression; use a compatible player or demux/remux into supported browser delivery. Verify actual codec support, keyframes, timestamps, audio synchronization, bitrate and FPS.
5. **Durable authorization.** Implement encrypted account-grant storage only after the credential lifecycle is known. Verify actual renewal rather than persisting an expiring token and calling it renewal. Keep app sessions separate from provider credentials.
6. **Linux acceptance.** Run on a fresh Linux host without Chrome session import, Windows, iVMS or developer credentials. Test login, device permission checks, online/offline behavior, playback, restart recovery, expiry, revocation and multiple viewers.

If the cloud protocol cannot be reproduced with the available evidence, an owner-authorized connector near the recorder is an alternative architecture to evaluate. It requires recorder/network access beyond the current cloud share and is not silently substituted for the requested cloud-only product.
