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
    emit({ stage: 'audio', ...packet, samples: 4 }); assert.equal(live.status().audioSamples, 0);
    emit({ stage: 'audio', ...packet }); assert.equal(live.status().audio, true);
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
  assert.equal(node.when, 1.12);
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
  assert.ok(player.nodes.size <= 10); assert.ok(mocks.contexts[0].nodes.some(node => node.stopped));
  mocks.sources[0].onerror(); assert.equal(player.enabled, false); assert.match(error, /connection ended/);
});
