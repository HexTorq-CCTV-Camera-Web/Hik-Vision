> Source folders separated on 25 October 2026. Current paths/startup: [README.md](README.md).
> Historical test and deployment limits below remain unchanged.

# Real-camera reliability tests: pending

Status confirmed by user on 24 October 2026: all five recorders are offline.
The user will resume these tests when recorders are online. No long-running
real-camera run has been completed or claimed. Existing automated and synthetic
browser checks are separate from real-camera acceptance.

## Where to test

Local Windows v2: http://localhost:8004/
Source: K:/2026-SHOP/Playground/Camera/hikvision/v2
Keep using this stable viewer for camera acceptance, independent of SaaS work.
Do not use SSH or change the VPS unless the user explicitly requests it.

## Before starting

1. User confirms at least one real channel plays in the phone app.
2. Refresh the local viewer; confirm recorder Online and valid playback access.
3. Note the recorder/channel names and selected quality, without copying tokens.
4. Close other playback clients for the comparison once phone playback is verified.
5. Wait for any active clip to say Saved to server before an intentional restart.

## Acceptance checklist

- Continuous viewing: initially 30 minutes, then a longer unattended observation
  if stable; record duration, decoded/painted frame progress, stalls, reconnects,
  audio continuity, live-frame age and local process memory/resource trend.
- Grid/focus: SD grid -> HD enlarged camera -> SD grid; ensure hidden feeds stop,
  grid resumes, manual quality overrides hold and stopped cameras stay stopped.
- Recording protection: record while enlarging another camera or viewing Settings;
  verify saved clip plays after refresh and background policy does not stop it.
- Rapid recorder changes: use two online recorders. Switch repeatedly, including
  before connection completes; ensure no old feeds, audio, orphan receivers or
  stuck loading state. If only one recorder is online, leave this item pending.
- Rotation: use a grid smaller than available working channels; run several
  complete cycles, verify preloading and fresh picture on swap, then background
  and return. Test with actual channels; synthetic results do not establish this.
- Network drop: simulate an outage only for the test browser tab, then restore it.
  Verify distinct server/network feedback, bounded retry and resumed fresh video.
  Do not disable the whole PC network, reboot cameras or disrupt other services.
- Local server restart: restart only the local viewer, not the VPS. Confirm saved
  account/settings/recordings survive and reconnect without replaying stale frames.
- Document unsupported or unavailable channels separately from viewer failures.

## Evidence to retain

A dated report with each case marked Pass, Fail or Not tested; test duration;
recorder/channel names; observed recovery times; aggregate frame/audio/resource
metrics and sanitized browser errors. Do not save credentials, SDK tokens,
full native/network logs, camera images or recordings as test artifacts.

## Resume

When the user says cameras are online, rerun discovery first. Do not assume they
remain offline or online based on an earlier date. Complete the real cases that
availability permits and explicitly leave the others pending.
