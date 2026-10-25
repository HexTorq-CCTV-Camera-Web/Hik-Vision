> Source folders separated on 25 October 2026. Current paths/startup: [README.md](README.md).
> Historical test and deployment limits below remain unchanged.

# Local work status - 24 October 2026

## Deployment constraint

User instruction: make changes and run tests locally only. Do not use SSH,
upload files, restart or change the VPS until the user explicitly requests it.
The account-recovery changes below have NOT been deployed to the Linux server.

## Stable Windows v2 account recovery changes

- Separate viewer authentication, Hik-Connect web session and SDK playback access.
- Reconnect-required and playback-required states with explicit UI actions.
- No automatic password retry and no provider passwords saved.
- Matching-account reconnection retains a still-valid playback grant.
- Another account never inherits the previous account's SDK grant.
- Account-scoped layouts, favourites and camera groups; restore when returning.
- Connection revisions reject old tab requests, stale event subscriptions and
  delayed device discovery. Failed sign-in preserves the previous working account.
- Status checks run every 15 seconds when visible, on focus and when back online.
- Windows can verify a matching iVMS playback grant through the recovery banner.
- Linux cannot independently create/renew an SDK grant from ID/password yet.
  There is no verified refresh-token endpoint implemented. Do not claim automatic renewal.

## Local validation

- Windows suite: 85 passing tests after the adaptive streaming update.
- Linux-source portable storage/recovery suites: 29 passing tests on Windows.
- The Linux OS vault/socket suite cannot run on this Windows host; no WSL is
  installed. The VPS was not used for tests after the local-only instruction.
- Synthetic browser checks: account A/B switching, scoped saved layout restoration,
  web expiry with viewer login preserved, web-only account, and another-tab update.
- Real account renewal and live playback still need verification with authorized
  accounts/cameras; synthetic tests do not establish vendor renewal support.

## Other requested work to follow

- Persistent server recordings: implemented locally, including Settings, storage usage/limit,
  1/7/30/90-day retention, authenticated playback/downloads, cleanup and upload retry.
  Not deployed to the VPS.
- Connection feedback: implemented locally for offline recorder, unavailable channel,
  web/playback authorization, server/cloud outage and video receiver errors; not deployed.
- Adaptive SD grids, HD focus, background pauses, recording/audio protection and
  rotation pause/resume: implemented and tested locally, not deployed.
- Real-camera reliability tests explicitly deferred by user: all five recorders
  offline on 24 October 2026. Resume from RELIABILITY-TEST-CHECKLIST.md when online.
- SaaS: superadmin approval of tenant admins; tenant admins connect their own
  Hik-Connect accounts and manage isolated subusers and recorder permissions.
  PostgreSQL implemented locally in saas-v3.
- HTTPS/domain and camera recorded-footage playback explicitly deferred by user.


## Local SaaS v3

PostgreSQL confirmed by user. Separate saas-v3 now implements signup, platform
approval/suspension, workspace admins, forced-password-change members, scoped
Hik-Connect connections, media ACLs, recordings and team permissions.
Private PostgreSQL: loopback port 55432; local application: port 8006.
No real superadmin or tenant seeded: user completes first setup.
Seventy-seven SaaS tests pass, including real PostgreSQL, authentication lifecycle
and HTTP cross-workspace workflows. Windows v2 regression: 85 tests pass.
Separate role agents verified public signup/approval, both admins and members,
browser UI permissions, synthetic feeds/clips, workspace suspension and isolation.
One invalid-layout feedback bug was fixed locally in SaaS v3 (400 instead of 500).
Detailed results: saas-v3/QA-REPORT-2026-10-24.md.
Manual account recovery added: superadmin Manage users lists workspace admins
and members and sets temporary passwords. Target sessions/feeds are revoked and
next login requires a password change. Status/permissions/provider grants remain
unchanged. Email verification and email-based recovery explicitly excluded by user.
Headless Chrome checks passed both reset flows, mismatch validation and 390px UI.
Browser checks use synthetic users/media in disposable test databases.
Windows v2 remains intact; no VPS changes were made.
Real new-account playback and independent SDK renewal are not proven. Cameras
remain offline; continue the reliability checklist when available.
Local SaaS recovery now includes opt-in encrypted provider sign-in, a background
reauthentication worker, persistent leases/backoff, verified updated-iVMS token
recovery, stale-response protection, background discovery/revocation cleanup and
same-account camera view restoration. Secrets are absent without explicit opt-in.
This is not independent SDK-token minting or a verified personal-account refresh
endpoint. Real-account expiry/reissue acceptance remains pending; see
saas-v3/ACCOUNT-RECOVERY.md. No VPS changes.
Audit log added locally: platform-wide superadmin / workspace-only admin view;
members denied. Captures approvals, member permission/status/password changes,
provider connections/recovery and recording deletion/cleanup intent and outcomes.
Read-only UI has search, date/category filters and cursor pagination. Audit
details exclude secrets. See saas-v3/AUDIT-LOG.md; browser/mobile checks passed.
Workspace quotas explicitly deferred by user. Health monitoring added locally
only for superadmin: failed streams, storage pressure and server/task errors,
persistent deduplicated alerts, acknowledgment, recovery, metrics and a navbar
badge. Other roles are denied UI/API/global metrics access. Existing limits are
unchanged; no external messages are sent. See saas-v3/HEALTH-MONITORING.md.
See saas-v3/README.md for setup, trust boundaries and production limitations.
