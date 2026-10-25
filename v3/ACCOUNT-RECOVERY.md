# Account recovery - local SaaS v3

## What is implemented

Viewer login and Hik-Connect access remain separate. A provider failure does not
sign a user out of their viewer account or delete saved layouts/recordings.

Workspace admins can enable two options in the Hik-Connect sign-in popup:

1. **Reconnect automatically** stores that account's sign-in encrypted inside
   its workspace provider record. A worker can perform the existing personal-portal
   login again after explicit web expiry or a known expiry hint. This is automatic
   reauthentication, not a newly discovered refresh-token API. It is off by default.
2. **Restore playback from iVMS on this PC** permits checking an updated local
   Windows-client token against a real shared channel before storing it. It does
   not create an SDK token, sign into iVMS automatically, or give Linux an SDK login.

The popup explains storage before opt-in. Turning automatic recovery off removes
the saved sign-in secret and cancels an in-flight renewal's ability to save its
result. Current web/playback access stays connected. Disconnecting removes the
provider record. A newly connected account cannot inherit the previous account's
secret, SDK token, member camera grants or preferences.

## Worker behavior

- Runs every 30 seconds; normal provider health/discovery checks are five minutes
  apart. Expiry/failure triggers can schedule earlier recovery.
- Works without an open administrator browser session. Suspended workspaces or
  inactive admins do not run jobs.
- A database-backed four-minute lease prevents concurrent password submissions
  across worker processes. Exact encrypted-record comparisons protect against
  late responses after disconnect, another login or disabled recovery.
- Transport failures and HTTP 429 back off from one minute to at most 15 minutes.
  Rejected credentials, account mismatches and verification challenges stop
  automatic login until the admin signs in again. Web 403 is not treated as expiry.
- SDK checks have their own cooldown and never replace a token until a shared
  channel authorizes it. An unchanged rejected candidate is not repeatedly tested.
  A known SDK expiry is preserved when the same token is checked.
- Successful discovery updates workspace camera availability. Active media is
  rechecked every five seconds for local session/channel/provider permission loss.
- Same-account recovery keeps preferences and member grants. The browser restores
  its foreground camera arrangement and preserves manually stopped cameras.
  It does not resume cameras from another account, recorder route or hidden page.
- Interrupted manual recordings finish; recovery does not silently start another
  recording or promise gapless recording through an outage.
- Recovery audit events contain no passwords or tokens. Status APIs expose only
  flags, timestamps and fixed reason codes.

The worker database functions are server infrastructure operations. Their inputs
are not exposed as tenant-selectable HTTP endpoints. The application database
credential and encryption key remain privileged. Ordinary admins and members
cannot use platform scope or request recovery for another workspace.

## Administrator actions

Open Account, then Sign in to Hik-Connect. Enter the current ID/password and opt
in to the required recovery options. Existing connections have no saved provider
password and therefore require one explicit sign-in to enable automatic recovery.

If sign-in is rejected or verification is required, automatic retries stop. Use
the real current credentials and complete verification required by Hik-Connect;
this app does not bypass CAPTCHA/MFA or claim all challenge flows are supported.

If playback requires attention on Windows, sign into the matching account in
iVMS and use Check iVMS playback access. With playback recovery enabled the worker
also detects an updated candidate. The token is checked against workspace camera
access before it is saved. A web sign-in alone does not produce SDK authorization.

## Validation

The local suite covers encrypted secrets/status redaction, web expiry, background
recovery with no admin browser, transient backoff, rate limiting, verification
rejection, concurrent workers, stale leases, account mismatch, disconnect/new-login
races, opt-out, member grant/session preservation, SDK candidate validation, known
SDK expiry, Linux capability limits and revoked-camera stream cleanup.

Optional browser acceptance uses only the disposable synthetic service:

```powershell
# Terminal 1, after local database setup
$env:HIK_SAAS_TEST_FIXTURE='1'
node tools/browser-fixture.mjs
# Terminal 2; isolated headless Chrome, no existing Chrome profile
node tools/recovery-browser-qa.mjs
```

The browser QA tool requires playwright-core installed under .local/browser-qa
and Chrome installed locally (QA_CHROME can override its executable path).
It checks opt-in, expiry feedback, same-view restoration, manual-stop preservation,
forgetting the secret, retained access, 390px layout and script errors. Browser
expiry is simulated through response interception; backend reauthentication uses
injected synthetic provider responses in PostgreSQL tests.

## Remaining external acceptance gate

**Fully unattended SDK-token renewal is not implemented or verified.** The code
can reuse a newly authorized installed-client token; it cannot manufacture that
token when iVMS also needs a fresh sign-in. Independent Linux SDK authorization
remains unavailable. No guessed refresh endpoint or developer app credentials are
used. Provider-required verification can also require user interaction.

Real-account acceptance is still required: authorized re-login after genuine web
expiry, a newly issued SDK grant, changed provider password, revoked sharing,
network interruption and a long-running camera session. Synthetic tests establish
the application lifecycle protections, not vendor support for unattended renewal.
The physical recorders were last reported offline. No VPS work was performed.

Vendor references examined:

- SDK login/response parameters: https://open.ys7.com/doc/en/pc/group__midpage.html
- SDK authentication overview: https://open.ys7.com/doc/en/pc/page2.html

These documents describe SDK authentication; they do not establish a working
refresh flow for this project's personal Hik-Connect account integration.
