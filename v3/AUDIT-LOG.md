# Audit log

Open **Audit log** in the navbar. Superadmin sees activity across workspaces;
workspace admins see only their own workspace. Members cannot read history,
including through the API. Audit access does not grant camera media access.

Entries show event, local time, workspace, actor and affected person or clip.
Expand View details for permission summaries, status changes, cleanup reasons and
event references. Search people/workspaces/cameras, filter by category/date range,
and load older activity. Pages hold at most 50 events using a stable ID cursor.

Recorded actions include workspace requests/approvals/rejections/suspensions,
member creation/permissions/status, password resets, Hik-Connect connections and
recovery, recording policy changes and manual/automatic recording deletion.
Database mutations and their audit events share a PostgreSQL transaction.

Deletion records an intent before removing files, followed by completion/failure
when that outcome can be stored. A request without a completion is not a claim
that deletion succeeded: files and the database are separate resources. An
interrupted operation can leave its request for review. Cleanup refuses to begin
deletion if its audit intent cannot be stored. Retention/storage cleanup appears
as System with its reason. Recording retention does not purge audit history.

The application role can append/read authorized events but cannot update/delete
them. This is not protection against a privileged database owner. There is no
audit-delete endpoint. Database credentials remain trusted server infrastructure.

Passwords, tokens, cookies, raw SDK responses, SDP and private file paths are
excluded. Details use a bounded allowlist; the UI renders text rather than HTML.
Legacy entries remain visible. New detail fields cannot reconstruct information
that earlier versions never recorded.

## Validation - 24 October 2026

- Local SaaS: **64 tests passed**, including nine audit checks.
- Verified role/workspace scope, metadata redaction, filters, literal search,
  pagination, deletion events, retention cleanup, failed-intent safety and denied
  UPDATE/DELETE of history by the runtime database role.
- Isolated headless Chrome: root/admin/member navigation, filters, older pages,
  details, escaped target text, deletion entries and 390px layout passed.
- No unexpected script errors. Disposable synthetic users/files only; no VPS work.

Optional browser acceptance, with the explicit fixture already running and the
same .local/browser-qa Playwright dependency used by recovery acceptance:

```powershell
node tools/audit-browser-qa.mjs
```
