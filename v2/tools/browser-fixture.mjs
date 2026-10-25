import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RecordingStore } from '../lib/recordings.mjs';
// Opt-in local test server. It never accesses real accounts, cameras or a mic.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.mjs';
import { HikError } from '../lib/hik-connect.mjs';
import { PortalError } from '../lib/personal-client.mjs';
import { Accounts } from '../lib/accounts.mjs';
import { NativeLive } from '../lib/live.mjs';
if (process.env.HIK_TEST_FIXTURE !== '1') throw new Error('Set HIK_TEST_FIXTURE=1 to run synthetic tests.');
const frames = JSON.parse((await promisify(execFile)(process.env.HIK_PYTHON || 'python', [fileURLToPath(new URL('./test-frames.py', import.meta.url))])).stdout);
let saved = null;
const accounts = await Accounts.open({ open: async () => {}, load: async () => saved, save: async state => { saved = structuredClone(state); } });
const grant = { sessionId: 'synthetic-web', sdkAccessToken: 'synthetic-sdk', sdkExpiresAt: Date.now() + 86400000,
  origin: 'https://iindia.hik-connect.com', accountUserId: 'synthetic', user: { username: 'SYNTHETIC TEST ACCOUNT', country: 'Test only' } };
const devices = ['A', 'B'].map(letter => ({ id: 'test-recorder-' + letter, serial: 'TEST' + letter, name: 'TEST RECORDER ' + letter, source: 'shared', status: 'online',
  channels: Array.from({ length: letter === 'B' ? 16 : 8 }, (_, index) => ({ number: index + 1, name: 'TEST Camera ' + (index + 1) })) }));
function runner() {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let interval, count = 0, closed = false, input = '';
  const send = event => { if (!closed) child.stdout.write(JSON.stringify(event) + '\n'); };
  const close = () => { if (closed) return; closed = true; clearInterval(interval); child.emit('close', 0); };
  child.kill = close; child.stdin.on('finish', close);
  child.stdin.on('data', bytes => {
    input += bytes; const lines = input.split('\n'); input = lines.pop();
    for (const line of lines) {
      const value = JSON.parse(line);
      if (value.accessToken) {
        send({ stage: 'camera-capabilities', supportTalk: true }); send({ stage: 'audio-stream', available: true });
        const tick = () => { if (!count) send({ stage: 'preview', jpeg: frames[0], width: 640, height: 360 }); send({ stage: 'frame', jpeg: frames[count++ % 2], width: 640, height: 360, displayWidth: 640, codec: 'h264' }); send({ stage: 'audio', sampleRate: 16000, samples: 1600, pcm: Buffer.alloc(3200).toString('base64') }); };
        tick(); interval = setInterval(tick, 125);
      } else if (value.command === 'talk-start') { send({ stage: 'talk-result', action: 'start', result: 0 }); send({ stage: 'playback-event', event: 16 }); }
      else if (value.command === 'talk-stop') { send({ stage: 'talk-result', action: 'stop', result: 0 }); send({ stage: 'playback-event', event: 17 }); }
    }
  });
  return child;
}
const recordingDirectory = await mkdtemp(path.join(tmpdir(), 'hik-recordings-fixture-'));
const recordings = await new RecordingStore(recordingDirectory, { reserveBytes: 0 }).open();
const server = createApp({ accounts, recordings, connectBrowser: async () => grant,
  connectPersonal: async input => {
    if (input.password !== 'synthetic-password' || !['synthetic-a', 'synthetic-b', 'synthetic-web-only', 'synthetic-expired'].includes(input.account)) throw new PortalError('Synthetic sign-in rejected.');
    const id = input.account === 'synthetic-a' ? 'synthetic' : input.account;
    return { credentials: { ...grant, sessionId: input.account + '-session', accountUserId: id, user: { username: input.account, country: 'Test only' }, ...(input.account === 'synthetic-web-only' ? { sdkAccessToken: undefined, sdkExpiresAt: undefined } : {}) } };
  },
  hik: { devices: async provider => { if (provider.sessionId === 'synthetic-expired-session') throw new HikError('Synthetic expired sign-in', 401); return []; }, sharing: async () => ({ state: 'records-found', mappingPending: false, devices }) },
  createLive: (credentials, device, channel, quality, options) => new NativeLive(credentials, device, channel, quality, { ...options, runner }) });
server.listen(8005, '127.0.0.1', () => console.log('TEST ONLY: synthetic camera fixture at http://localhost:8005/ (no account, camera or microphone access)'));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { server.close(); server.closeAllConnections(); });

server.on('close', () => { void rm(recordingDirectory, { recursive: true, force: true }); });
