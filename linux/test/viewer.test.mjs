import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Viewer, slotNumber } from '../lib/viewer.mjs';
import { cleanPreferences } from '../lib/preferences.mjs';
import { Zoom, pictureSize, Retry, recorderGrid, retryableStreamError } from '../public/view-model.mjs';

test('transient decoder timeouts retry without retrying account authorization or channel denials', () => {
  assert.equal(retryableStreamError({ message: 'The video receiver could not decode this stream. Try SD or reconnect the account.', status: 502 }), true);
  assert.equal(retryableStreamError({ message: 'No decoded video arrived. Try SD.', status: 502 }), true);
  assert.equal(retryableStreamError({ message: 'Playback authorization is missing or expired.', status: 409 }), false);
  assert.equal(retryableStreamError({ message: 'This channel is not shared with this account.', status: 403 }), false);
  assert.equal(retryableStreamError({ message: 'The server stream limit is reached.', status: 409 }), false);
});

test('automatic recorder layouts fit all channels without exceeding the 16-stream cap', () => {
  assert.deepEqual(recorderGrid(1), { count: 1, grid: 1 });
  assert.deepEqual(recorderGrid(4), { count: 4, grid: 4 });
  assert.deepEqual(recorderGrid(8), { count: 8, grid: 9 });
  assert.deepEqual(recorderGrid(16), { count: 16, grid: 16 });
  assert.deepEqual(recorderGrid(50), { count: 16, grid: 16 });
  assert.deepEqual(recorderGrid(0), { count: 0, grid: 1 });
  assert.equal(cleanPreferences({ groupFit: 'fill' }).groupFit, 'fill');
  assert.equal(cleanPreferences({ groupFit: 'arbitrary' }).groupFit, 'fit');
});

test('zoom anchors the cursor, bounds panning and restores the whole picture', () => {
  const zoom = new Zoom(); zoom.zoom(2, 100, 50);
  assert.equal(zoom.x, -100); assert.equal(zoom.y, -50);
  zoom.x = 9999; zoom.y = -9999; zoom.clamp(640, 360, 640, 360);
  assert.equal(zoom.x, 320); assert.equal(zoom.y, -180);
  zoom.zoom(99); assert.equal(zoom.scale, 8);
  zoom.reset(); assert.deepEqual({ scale: zoom.scale, x: zoom.x, y: zoom.y }, { scale: 1, x: 0, y: 0 });
  assert.deepEqual(pictureSize(640, 360, 400, 400, 'fit'), { width: 400, height: 225 });
  assert.deepEqual(pictureSize(640, 360, 400, 400, 'fill'), { width: 640 * 400 / 360, height: 400 });
});
test('reconnection backs off, avoids duplicate timers and cannot restart a stopped tile', () => {
  const scheduled = [], cancelled = new Set(); let calls = 0;
  const retry = new Retry({ schedule: (fn, delay) => { const timer = { fn, delay }; scheduled.push(timer); return timer; }, cancel: timer => cancelled.add(timer) });
  assert.equal(retry.queue(() => calls++), 2000); assert.equal(retry.queue(() => calls++), undefined);
  const old = scheduled[0]; retry.stop(); old.fn(); assert.equal(calls, 0); assert.ok(cancelled.has(old));
  assert.equal(retry.queue(() => calls++), 4000); scheduled[1].fn(); assert.equal(calls, 1);
  retry.reset(); assert.equal(retry.queue(() => calls++), 2000); retry.stop();
});
test('saved layouts and favourites are bounded and untrusted properties are stripped', () => {
  const prefs = cleanPreferences({ grid: 16, volume: 2, favourites: ['shared-1:1', 'shared-1:1'], groups: { 'shared-1:1': 'Entrance' },
    layouts: [{ name: 'Night shift', grid: 1, cameras: [{ deviceId: 'shared-1', channel: 1, quality: 'hd', fit: 'fill', secret: 'not-allowed' }] }], token: 'never-save' });
  assert.equal(prefs.volume, 1); assert.equal(prefs.favourites.length, 1); assert.equal(prefs.token, undefined);
  assert.equal(prefs.layouts[0].cameras[0].secret, undefined);
  assert.throws(() => cleanPreferences({ layouts: [{ name: 'bad', grid: 4, cameras: [] }] }));
  assert.equal(slotNumber(31), 31);
  for (const id of [-1,32,'../1',null,1.1]) assert.throws(() => slotNumber(id));
});
test('one event stream multiplexes camera frames and only explicitly focused audio', () => {
  const viewer = new Viewer(), frames = new Map(), audio = new Map(); let stops = 0;
  for (let id = 0; id < 32; id++) {
    const slot = viewer.slot(id);
    slot.live = { deviceId: 'd', channel: id + 1, quality: 'sd',
      status: () => ({ state: 'playing' }), stop: () => { stops++; },
      watchFrames: fn => { frames.set(id, fn); return () => frames.delete(id); },
      watchAudio: fn => { audio.set(id, fn); return () => audio.delete(id); } };
  }
  const res = new EventEmitter(), writes = [];
  Object.assign(res, { destroyed: false, writableLength: 0, writeHead() {}, write: chunk => writes.push(chunk), end: () => res.emit('close') });
  viewer.subscribe(res); assert.equal(frames.size, 32); assert.equal(audio.size, 0);
  frames.get(31)({ jpeg: 'synthetic', width: 640, height: 360 });
  assert.ok(writes.some(value => value.includes('"slot":31') && value.includes('"channel":32')));
  viewer.focusAudio([3]); assert.deepEqual([...audio.keys()], [3]);
  viewer.focusAudio([2,7]); assert.deepEqual([...audio.keys()].sort(), [2,7]);
  const count = writes.length; res.writableLength = 3_000_000; frames.get(0)({ jpeg: 'dropped' }); assert.equal(writes.length, count);
  res.writableLength = 0; viewer.close(); assert.equal(frames.size, 0); assert.equal(audio.size, 0); assert.equal(stops, 32);
});

test('a congested video connection cannot block or disconnect separate camera audio', () => {
  const viewer = new Viewer(); let frame, sound, frameClosed = false, audioClosed = false;
  viewer.slot(0).live = { deviceId: 'test', channel: 1, quality: 'hd', status: () => ({ state: 'playing' }), stop() {},
    watchFrames: fn => { frame = fn; return () => { frameClosed = true; }; },
    watchAudio: fn => { sound = fn; return () => { audioClosed = true; }; } };
  const response = () => {
    const res = new EventEmitter();
    Object.assign(res, { destroyed: false, writableLength: 0, data: '', writeHead() {}, write(value) { this.data += value; },
      destroy() { this.destroyed = true; this.emit('close'); }, end() { this.destroy(); } });
    return res;
  };
  const video = response(), audio = response();
  viewer.subscribe(video, { separateAudio: true }); viewer.subscribeAudioEvents(audio); viewer.focusAudio([0]);
  sound({ pcm: 'test', samples: 1, sampleRate: 16000 });
  assert.ok(audio.data.includes('event: audio')); assert.ok(!video.data.includes('event: audio'));
  video.writableLength = 3000000; frame({ h264: 'test', key: true, timestamp: 0 });
  assert.ok(video.destroyed); assert.ok(frameClosed); assert.equal(audioClosed, false);
  const before = audio.data.length; sound({ pcm: 'next', samples: 1, sampleRate: 16000 });
  assert.ok(audio.data.length > before); assert.ok(!audio.destroyed); assert.ok(!audio.data.includes('event: frame'));
  viewer.close(); assert.ok(audioClosed);
});
