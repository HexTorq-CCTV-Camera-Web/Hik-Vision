# Hikvision SaaS v3 - local PostgreSQL application

Standalone folder map and current startup paths: [STANDALONE.md](STANDALONE.md).


This is separate from the working Windows v2 camera viewer at localhost:8004.
No VPS changes or deployment were made. PostgreSQL is confirmed and installed
locally. The application runs at http://localhost:8006/.

Signup, approval, workspace membership, camera permissions and scoped recording
storage are implemented. The real database contains no default accounts: create
the single superadmin on first local startup.

## Required workflow

1. A single superadmin controls platform approvals.
2. Public admin signup creates a pending request; pending users cannot access cameras.
3. The superadmin approves or rejects the request. Approval activates its workspace.
4. An approved admin connects only that workspace's Hik-Connect account.
5. Admins create and manage member accounts within their own workspace only.
6. Members receive explicit camera/recorder view, download and recording permissions.
7. Workspaces remain isolated across device discovery, SDK grants, live sessions,
   recordings/files, storage policy, favourites, groups and saved layouts.

## Access boundaries

Audit log in the navbar shows platform activity to superadmin and workspace-only
activity to admins. Members have no audit access. See AUDIT-LOG.md for events,
filters, deletion outcomes and validation.

Health monitoring is available only to superadmin. It tracks failed playback,
storage pressure and server/task errors with acknowledgment and recovery status.
See HEALTH-MONITORING.md for readings, thresholds and limitations. Workspace
quotas remain deferred; monitoring changes no existing limits.

Session-derived identity and tenant scope are authoritative. Client body/query
parameters never select another workspace or grant a role. Superadmin control-plane
access does not implicitly grant access to tenants' camera streams or recordings.
Pending, suspended, rejected and unknown users/tenants are denied. New member
accounts cannot promote themselves or manage a Hik-Connect grant.

Run `npm test` in this directory. Seventy-seven tests pass, including real PostgreSQL and
HTTP workflows against disposable databases. Coverage includes approvals, forced
password changes, forged roles/scope, cross-workspace denial, recording access,
channel permissions, account changes, session revocation and RLS enforcement.

## Local startup

```powershell
cd K:\2026-SHOP\Playground\Camera\hikvision\v3
npm run setup:local
npm start
```

Setup starts the private PostgreSQL cluster when stopped and applies the schema.
Ctrl+C stops Node; PostgreSQL remains a separate local process. Node 22.9+ and the
bundled vendor/windows-sdk source/native dependencies are required (included here). Run npm ci to restore
Node dependencies. Setup requires the binaries already extracted under
.local/postgresql/pgsql; it does not download PostgreSQL automatically.

PostgreSQL 17.11 listens on 127.0.0.1:55432, database cam_saas. Runtime cam_app has
neither superuser nor BYPASSRLS rights; migrations use a separate bootstrap role.
Configuration and bootstrap secrets use Windows DPAPI under .local. Provider
tokens use AES-256-GCM, workspace identity as authenticated data, and a local
DPAPI-protected key under data. Preserve the database, recording files and keys
together when preparing protected backups.

PostgreSQL FORCE ROW LEVEL SECURITY and application checks enforce workspace
scope. Transactions establish scope using the same database client. The database
credential remains trusted server infrastructure; RLS is not protection against
theft of that credential.

## Using the application

Create the superadmin locally. In a different browser profile select Request
access, submit an admin signup, then approve it in the superadmin Workspaces page.
The approved admin connects their own Hik-Connect account from the navbar and
creates members in Team. Members must change temporary passwords on first login.
Assign recorder View, Download and Record permissions. Members cannot administer
the workspace or connect Hik-Connect. The API also supports channel restrictions.

Password support is manual: in the superadmin Workspaces dashboard, choose
Manage users on a workspace, then Reset password beside an admin or member.
Enter and confirm a temporary password (12-128 characters) and share it directly
with that user. Existing sessions and live feeds for that user are closed; next
login requires a personal password change. Approval/suspension status, camera
permissions, recordings and Hik-Connect grants are preserved. Reset actions are
audited without storing the temporary password. This resets the viewer account,
not the user's password at Hik-Connect. The superadmin changes their own password
through Account. Email verification and email-based password recovery are not
planned, as requested by the user.

Changing Hik-Connect accounts clears member assignments and revokes their sessions;
admins must assign the new cameras. Layouts are archived by account. Historical
clips remain accessible to the workspace admin. Permission changes, password
resets and workspace suspensions revoke affected sessions and close live feeds.

Recording files have workspace-specific retention/storage limits under
data/tenants/<workspace UUID>/recordings. Download controls cover clips and
snapshots; they are not DRM against capturing media a browser can view.

## Remaining production work

Browser tests use synthetic users/media, not real Hikvision authorization.
The detailed role-by-role results and limitations are in QA-REPORT-2026-10-24.md.
Account recovery implementation, opt-in secret storage, acceptance checks and the
remaining SDK-token renewal limitation are documented in ACCOUNT-RECOVERY.md.
Personal-portal ID/password login creates a web grant and may require additional
provider verification. Video still requires a matching SDK grant; independent
Linux SDK authorization and renewal remain unverified. Real live video retains
the installed Windows SDK dependency. This is not a completed Linux deployment.

HTTPS/domain, independent provider renewal and backup/restore acceptance remain
production work. Rate limits are process-local.
Optional environment variables are DATABASE_URL, PORT, HIK_SAAS_DATA_DIR,
HIK_SAAS_MASTER_KEY and PUBLIC_ORIGIN. A remote origin requires HTTPS; the app
binds loopback for a future reverse proxy. Linux needs an explicit master key;
the local setup helper provisions Windows only.

Primary references:

- https://www.postgresql.org/docs/current/ddl-rowsecurity.html
- https://www.postgresql.org/download/windows/
- https://node-postgres.com/features/transactions

## Camera reliability work remains pending

All five recorders were offline on 24 October 2026, confirmed by the user.
Resume real-camera acceptance using ../RELIABILITY-TEST-CHECKLIST.md when online.
The Windows v2 viewer is retained for that work.
