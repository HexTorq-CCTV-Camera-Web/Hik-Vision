import test from 'node:test';
import assert from 'node:assert/strict';
import { SmoothPlayer } from '../public/smooth.mjs';

test('smooth playback waits for a keyframe, bounds queued frames and releases stale decoded frames', () => {
  const saved = Object.fromEntries(['VideoDecoder','EncodedVideoChunk','requestAnimationFrame','cancelAnimationFrame'].map(key => [key, globalThis[key]]));
  let options, draws = 0, errors = 0;
  globalThis.VideoDecoder = class {
    state = 'configured'; decodeQueueSize = 0; decoded = [];
    constructor(value) { options = value; }
    configure() {} decode(value) { this.decoded.push(value); } close() { this.state = 'closed'; }
  };
  globalThis.EncodedVideoChunk = class { constructor(value) { Object.assign(this, value); } };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  const canvas = { width: 0, height: 0, getContext: () => ({ drawImage() { draws++; } }) };
  const player = new SmoothPlayer(canvas, () => {}, () => { errors++; });
  const packet = { h264: 'AAAAAQ==', key: false, timestamp: 0, width: 352, height: 288, codec: 'avc1.42C028' };
  try {
    player.push(packet); assert.equal(player.decoder, undefined);
    player.push({ ...packet, key: true }); assert.equal(player.decoder.decoded.length, 1);
    const frames = Array.from({ length: 60 }, (_, n) => ({ timestamp: n * 40000, displayWidth: 352, displayHeight: 288, close() { this.closed = true; } }));
    for (const frame of frames) options.output(frame);
    assert.equal(player.frames.length, 50); assert.ok(frames.slice(0,10).every(frame => frame.closed));
    player.draw(0); assert.equal(draws, 0);
    const due = player.anchor + frames[10].timestamp / 1000;
    player.draw(due); player.draw(due + 40);
    assert.equal(draws, 2);
    // A timestamp discontinuity rebases once and becomes playable after buffering.
    for (const frame of player.frames) frame.close(); player.frames = [];
    const jump = { timestamp: 100000000000, displayWidth: 352, displayHeight: 288, close() { this.closed = true; } };
    options.output(jump); player.draw(due + 100);
    assert.equal(draws, 2);
    player.draw(player.anchor + jump.timestamp / 1000);
    assert.equal(draws, 3); assert.equal(jump.closed, true);
    const stale = options.output;
    player.reset(); assert.ok(frames.every(frame => frame.closed));
    const late = { close() { this.closed = true; } }; stale(late); assert.equal(late.closed, true);
    player.push(packet); assert.equal(player.decoder, null);
    assert.equal(errors, 0);
  } finally {
    player.reset(); for (const [key, value] of Object.entries(saved)) if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
  }
});
