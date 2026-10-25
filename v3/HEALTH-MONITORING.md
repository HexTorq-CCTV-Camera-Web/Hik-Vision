# Superadmin health monitoring

Open **Health** in the superadmin navbar. Workspace admins and members have no
health navigation, page access, API access or direct scoped database visibility.
Their normal camera connection messages remain available. No platform health
details are included in workspace audit logs.

Workspace quotas are deferred. Monitoring does not introduce plan limits or change
member counts, simultaneous-stream limits, recording policies or storage limits.

## Alerts and readings

- Failed stream startup, interruption, timeout, decoding and receiver problems.
  Recorder offline / playback authorization problems are distinguished from
  internal server failures. Failures are observed when playback is attempted;
  this is not continuous physical-camera probing.
- Low physical recording-disk space and recording-policy storage pressure.
- Unexpected HTTP server failures, camera cloud request failures and failed
  background tasks. Records contain fixed summaries/components and safe numeric
  details, not raw exception messages, stack traces, tokens, URLs or credentials.
- Live/failed receiver-slot counts, recording disk free space, Node RSS/heap,
  Node CPU and viewer-process uptime. Node measurements do not include native
  SDK/Python child processes or represent a complete host resource monitor.

Storage is sampled every 30 seconds and Refresh health requests a fresh sample.
The superadmin panel/nav refresh every 30 seconds while visible. Readings include
their timestamps. A failed refresh marks the panel stale and the navbar with `!`;
it does not display stale readings as a fresh healthy result.

Disk warning threshold: below 2 GiB; critical below 512 MiB. It clears at 2.5 GiB
or more to avoid repeated opening/closing near the threshold. Workspace storage
warning: 90% of its existing recording policy limit; critical: 98%; clears below
85%. These are monitoring thresholds, not new quota enforcement.

## Alert lifecycle

Repeated observations update a deduplicated record instead of creating a flood.
Stream resource identity includes the workspace, viewer session, slot and camera;
internal resource/session keys are not returned to the browser. Acknowledgment
means the superadmin has seen an issue, not that it has recovered. Ordinary retry
attempts preserve acknowledgment. A resolved incident that recurs, or a warning
that becomes critical, needs acknowledgment again.

Successful playback resolves its failure. An observed manual stop is labeled
Playback stopped rather than Recovered. Storage and periodic-task alerts clear
after the relevant healthy observation. Server incidents can be marked resolved
by superadmin after fixing them; a subsequent failure reopens the alert. Active
storage/stream conditions cannot be manually declared healthy through that API.

The panel offers status/type filters and the latest 100 matching records ordered
by open status, severity and recent observation. Counts include all records.
History shows the latest state per resource, not an immutable timeline of every
individual observation. First/last observation, count, acknowledgment and latest
resolution are retained in PostgreSQL across process restarts.

If alert persistence fails, a bounded in-memory queue keeps up to 200 latest
failure observations and 200 resolutions. Writes back off for 30 seconds and
retry when the database is reachable. Unsaved observations are best effort and
can be lost on process termination; the panel warns of incomplete data. Graceful
shutdown drains current monitoring work before closing the database pool.

This is in-app monitoring only. No email, SMS, Slack or other external alerts are
sent. A stopped server cannot send an alert from its own panel. An already open
panel reports monitoring unavailable until it can reconnect. The public health
endpoint remains a minimal liveness response, not a global metrics endpoint.

## Local validation

The local suite has **77 passing tests**, including 13 health checks. These cover
superadmin-only reads/scans/actions, scoped RLS denial, deduplication, retry-safe
acknowledgment, recovery/reopening, disk escalation/hysteresis, unchanged recording
limits, unavailable probes, sanitized server incidents, persistent records,
bounded outage fallback and restricted manual resolution.

Isolated headless Chrome checked root-only navigation, metrics, acknowledgment,
server resolution, filters, stale-data warnings, refresh recovery, denied admin/
member access and a 390px layout without unexpected script errors. Signals were
synthetic; real-camera reliability acceptance remains separate.

Optional browser check with the explicit synthetic fixture:

```powershell
$env:HIK_SAAS_TEST_FIXTURE='1'
$env:HIK_SAAS_HEALTH_FIXTURE='1'
node tools/browser-fixture.mjs
# In another terminal, using the existing .local/browser-qa Playwright dependency
node tools/health-browser-qa.mjs
```

All changes and tests are local. No VPS changes were made.
