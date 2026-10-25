import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { NativeLive } from '../lib/live.mjs';
import { CameraAudio } from '../public/audio.mjs';

const pcm = Buffer.from([0, 128, 0, 0, 255, 127]).toString('base64');
const packet = { pcm, sampleRate: 16000, samples: 3 };
class Response extends EventEmitter {
  destroyed = false; writableLength = 0; data = '';
  writeHead(status, headers) { this.status = status; this.headers = headers; }
  write(data) { this.data += data; }
  end() { this.destroyed = true; this.emit('close'); }
}
test('native receiver delivers validated audio and closes listeners when playback stops', async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.kill = () => child.emit('close'); child.stdin.on('finish', () => child.emit('close'));
  const live = new NativeLive({ sessionId: 'private-test-session' }, { id: 'test', name: 'Camera', serial: 'TEST' }, 1, 'hd', { runner: () => child });
  const emit = value => child.stdout.write(JSON.stringify(value) + '\n');
  try {
    emit({ stage: 'frame', jpeg: '/9j/2Q==', width: 1, height: 1 }); await live.ready;
    const response = new Response(); live.subscribeAudio(response);
    assert.equal(response.headers['Content-Type'], 'text/event-stream');
    emit({ stage: 'audio-stream', available: true, codec: 'pcm_mulaw' });
    emit({ stage: 'audio-error', phase: 'decode', kind: 'InvalidDataError', code: 1094995529, detail: 'private upstream text' });
    assert.equal(live.status().audioCodec, 'pcm_mulaw');
    assert.deepEqual(live.status().audioError, { phase: 'decode', kind: 'InvalidDataError', code: 1094995529 });
    emit({ stage: 'audio', ...packet, samples: 4 }); assert.equal(live.status().audioSamples, 0);
    emit({ stage: 'audio', ...packet, decoder: 'hik-g711' }); assert.equal(live.status().audio, true);
    assert.equal(live.status().audioError, null); assert.equal(live.status().audioDecoder, 'hik-g711');
    assert.equal(live.status().audioSamples, 3); assert.match(response.data, /data: /);
    assert.ok(!response.data.includes('private-test-session'));
    response.writableLength = 64001; emit({ stage: 'audio', ...packet }); assert.equal(response.destroyed, true);
    const next = new Response(); live.subscribeAudio(next); live.stop();
    assert.equal(next.destroyed, true); assert.equal(live.audioClients.size, 0);
    emit({ stage: 'audio', ...packet }); assert.equal(live.status().audio, false);
  } finally { live.stop(); }
});

function browserMocks() {
  const sources = [], contexts = [];
  class Source { constructor() { sources.push(this); } close() { this.closed = true; } }
  class Context {
    constructor() { this.state = 'running'; this.currentTime = 1; this.nodes = []; contexts.push(this); }
    async resume() {}
    async close() { this.state = 'closed'; }
    createBuffer(_channels, samples, rate) { const data = new Float32Array(samples); return { duration: samples / rate, getChannelData: () => data, data }; }
    createBufferSource() { const node = { connect() {}, disconnect() {}, start(when) { this.when = when; }, stop() { this.stopped = true; } }; this.nodes.push(node); return node; }
  }
  return { Source, Context, sources, contexts };
}
test('unmute decodes signed PCM correctly and mute cancels queued sound', async () => {
  const mocks = browserMocks(); const player = new CameraAudio(mocks);
  assert.equal(player.enabled, false); assert.equal(mocks.contexts.length, 0);
  await player.start(); mocks.sources[0].onmessage({ data: JSON.stringify(packet) });
  const context = mocks.contexts[0]; const node = context.nodes[0];
  assert.deepEqual([...node.buffer.data], [-1, 0, 32767 / 32768]);
  assert.equal(node.when, 1.2);
  player.stop(); assert.equal(mocks.sources[0].closed, true); assert.equal(node.stopped, true); assert.equal(context.state, 'closed');
});
test('channel change while audio activation is pending cannot open an old audio connection', async () => {
  const mocks = browserMocks(); let resume;
  mocks.Context.prototype.resume = () => new Promise(resolve => { resume = resolve; });
  const player = new CameraAudio(mocks); const starting = player.start();
  player.stop(); resume(); await starting;
  assert.equal(mocks.sources.length, 0); assert.equal(player.enabled, false);
});
test('audio backlog is bounded and an ended connection returns to mute', async () => {
  const mocks = browserMocks(); let error;
  const player = new CameraAudio({ ...mocks, onError: message => { error = message; } });
  await player.start();
  const large = { pcm: Buffer.alloc(3200).toString('base64'), samples: 1600, sampleRate: 16000 };
  for (let i = 0; i < 40; i++) mocks.sources[0].onmessage({ data: JSON.stringify(large) });
  assert.ok(player.nodes.size <= 31); assert.ok(player.nextTime - mocks.contexts[0].currentTime <= 3.1); assert.ok(mocks.contexts[0].nodes.some(node => node.stopped));
  mocks.sources[0].onerror(); assert.equal(player.enabled, false); assert.match(error, /connection ended/);
});

test('ordinary arrival jitter and a short audio burst keep consecutive buffers gapless', async () => {
  const mocks = browserMocks(), player = new CameraAudio(mocks);
  await player.start({ external: true });
  const context = mocks.contexts[0], chunk = { pcm: Buffer.alloc(3200).toString('base64'), samples: 1600, sampleRate: 16000 };
  for (const time of [1, 1.11, 1.195, 1.31, 1.39, 1.515]) {
    context.currentTime = time; player.play(chunk);
  }
  for (let i = 0; i < 8; i++) player.play(chunk);
  for (let i = 1; i < context.nodes.length; i++) assert.ok(Math.abs(context.nodes[i].when - context.nodes[i-1].when - 0.1) < 0.000001);
  assert.equal(player.underruns, 0); assert.ok(context.nodes.every(node => !node.stopped));
  context.currentTime = player.nextTime + 0.2; player.play(chunk);
  assert.equal(player.underruns, 1); assert.ok(player.bufferDelay > 0.2);
  player.stop(); assert.ok(context.nodes.every(node => node.stopped));
});

test('multiplexed camera audio uses gain control without opening extra HTTP connections', async () => {
  const mocks = browserMocks(), gains = [];
  mocks.Context.prototype.createGain = () => { const gain = { gain: { value: 1 }, connect() {} }; gains.push(gain); return gain; };
  const player = new CameraAudio(mocks); player.setVolume(0.25);
  await player.start({ external: true }); assert.equal(mocks.sources.length, 0); assert.equal(gains[0].gain.value, 0.25);
  player.play(packet); assert.equal(mocks.contexts[0].nodes.length, 1);
  player.setVolume(0); assert.equal(gains[0].gain.value, 0); player.stop();
});

test('Smooth audio tolerates a delayed one-second batch without cutting off scheduled sound', async () => {
  const mocks = browserMocks(), player = new CameraAudio(mocks);
  await player.start({ external: true, bufferDelay: 0.9 });
  const chunk = { pcm: Buffer.alloc(3200).toString('base64'), samples: 1600, sampleRate: 16000 }, context = mocks.contexts[0];
  for (let i = 0; i < 10; i++) player.play(chunk);
  const end = player.nextTime;
  context.currentTime = 2.4;
  for (let i = 0; i < 10; i++) player.play(chunk);
  assert.equal(context.nodes[10].when, end); assert.equal(player.underruns, 0);
  assert.ok(context.nodes.every(node => !node.stopped)); player.stop();
});
