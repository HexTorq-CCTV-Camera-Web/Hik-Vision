import { cleanPreferences } from '../lib/preferences.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveStreams, playbackPolicy } from '../public/adaptive.mjs';

const camera = id => ({ id, camera: { key: 'camera-' + id }, wanted: true, adaptivePaused: false, quality: 'sd', qualityMode: 'auto' });
const context = extra => ({ enabled: true, live: true, hidden: false, focusedId: null, grid: 4, selectedId: 0, audioWanted: false, warmIds: new Set(), ...extra });
test('adaptive policy uses SD grids, HD focus and respects explicit quality overrides', () => {
  const tile = camera(0);
  assert.equal(playbackPolicy(tile, context(), 0).quality, 'sd');
  assert.equal(playbackPolicy(tile, context({ grid: 1 }), 0).quality, 'hd');
  assert.equal(playbackPolicy(tile, context({ focusedId: 0 }), 0).quality, 'hd');
  assert.equal(playbackPolicy(tile, context({ focusedId: 1 }), 0).run, false);
  tile.qualityMode = 'sd'; assert.equal(playbackPolicy(tile, context({ focusedId: 0 }), 0).quality, 'sd');
  tile.qualityMode = 'hd'; assert.equal(playbackPolicy(tile, context(), 0).quality, 'hd');
  const saved = cleanPreferences({ layouts: [{ name: 'Pinned HD', grid: 1, cameras: [{ deviceId: 'test', channel: 1, quality: 'hd', qualityMode: 'hd', fit: 'fit' }] }] });
  assert.equal(saved.layouts[0].cameras[0].qualityMode, 'hd');
});
test('hidden tabs and non-live pages keep only recordings and selected SD audio', () => {
  const tile = camera(0);
  for (const background of [{ hidden: true }, { live: false }]) {
    assert.equal(playbackPolicy(tile, context(background), 0).run, false);
    assert.equal(playbackPolicy(tile, context({ ...background, audioWanted: true }), 0).quality, 'sd');
    assert.equal(playbackPolicy(tile, context({ ...background, audioWanted: true, selectedId: 1 }), 0).run, false);
  }
  tile.quality = 'hd'; tile.recorder = { active: true };
  const recording = playbackPolicy(tile, context({ hidden: true, focusedId: 1 }), 0);
  assert.equal(recording.run, true); assert.equal(recording.quality, 'hd'); assert.equal(recording.reason, 'recording');
  assert.equal(playbackPolicy(tile, context({ enabled: false }), 0).run, false);
});
test('rotation standby remains warm only during foreground grid viewing', () => {
  const tile = camera(5), ctx = context({ warmIds: new Set([5]) });
  assert.equal(playbackPolicy(tile, ctx, 6).run, true);
  assert.equal(playbackPolicy(tile, { ...ctx, hidden: true }, 6).run, false);
  assert.equal(playbackPolicy(tile, { ...ctx, focusedId: 0 }, 6).run, false);
  assert.equal(playbackPolicy(tile, context(), 6).run, false);
});
test('a manually stopped camera never restarts just because the view changes', async () => {
  const tile = { ...camera(0), wanted: false }; let starts = 0;
  const adaptive = new AdaptiveStreams({ tiles: () => [tile], context: () => context({ grid: 1 }), suspend() {}, resume() { starts++; } });
  await adaptive.reconcile(); assert.equal(starts, 0);
  tile.adaptivePaused = true; await adaptive.reconcile(); assert.equal(starts, 1);
});
test('a rapid return from HD focus cancels the old target before camera restart', async () => {
  const tile = camera(0), log = []; let ctx = context({ focusedId: 0 }), release;
  const stop = new Promise(resolve => { release = resolve; });
  const adaptive = new AdaptiveStreams({ tiles: () => [tile], context: () => ctx,
    suspend(tile) { tile.wanted = false; tile.adaptivePaused = true; return stop; },
    async resume(tile, quality, valid) { await stop; if (valid()) { tile.wanted = true; tile.adaptivePaused = false; tile.quality = quality; log.push(quality); } } });
  const focus = adaptive.reconcile(); ctx = context(); const grid = adaptive.reconcile(); release();
  await Promise.all([focus, grid]); assert.deepEqual(log, ['sd']); assert.equal(tile.wanted, true);
});
test('manual stop or account cancellation invalidates a pending adaptive resume', async () => {
  for (const cancel of [false, true]) {
    const tile = camera(0); let release, starts = 0;
    const stop = new Promise(resolve => { release = resolve; });
    const adaptive = new AdaptiveStreams({ tiles: () => [tile], context: () => context({ grid: 1 }),
      suspend(tile) { tile.wanted = false; tile.adaptivePaused = true; return stop; },
      async resume(tile, quality, valid) { await stop; if (valid()) starts++; } });
    const pending = adaptive.reconcile();
    if (cancel) adaptive.cancel(); else tile.adaptivePaused = false;
    release(); await pending; assert.equal(starts, 0);
  }
});
test('recording quality stays unchanged while other hidden cameras are paused and restored', async () => {
  const tiles = [camera(0), camera(1), camera(2)]; tiles[1].recorder = { active: true };
  let ctx = context({ focusedId: 0 }); const suspended = [], resumed = [];
  const adaptive = new AdaptiveStreams({ tiles: () => tiles, context: () => ctx,
    suspend(tile) { suspended.push(tile.id); tile.wanted = false; tile.adaptivePaused = true; },
    resume(tile, quality, valid) { if (valid()) { resumed.push(tile.id); tile.quality = quality; tile.wanted = true; tile.adaptivePaused = false; } } });
  await adaptive.reconcile(); assert.deepEqual(suspended.sort(), [0, 2]); assert.equal(tiles[1].quality, 'sd'); assert.equal(tiles[1].wanted, true);
  ctx = context(); await adaptive.reconcile(); assert.equal(tiles[2].wanted, true); assert.equal(tiles[0].quality, 'sd');
  assert.equal(suspended.includes(1), false); assert.ok(resumed.includes(2));
});
test('adaptive camera resumes are limited to two concurrent starts and unchanged targets do not restart', async () => {
  const tiles = Array.from({ length: 8 }, (_, id) => ({ ...camera(id), wanted: false, adaptivePaused: true }));
  let active = 0, peak = 0, starts = 0;
  const adaptive = new AdaptiveStreams({ tiles: () => tiles, context: () => context({ grid: 9 }), suspend() {},
    async resume(tile, quality, valid) { active++; peak = Math.max(peak, active); starts++; await new Promise(resolve => setTimeout(resolve, 2)); if (valid()) { tile.wanted = true; tile.adaptivePaused = false; tile.quality = quality; } active--; } });
  const first = adaptive.reconcile(), repeated = adaptive.reconcile(); await Promise.all([first, repeated]);
  assert.equal(peak, 2); assert.equal(starts, 8); await adaptive.reconcile(); assert.equal(starts, 8);
});
