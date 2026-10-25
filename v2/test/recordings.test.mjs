import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { RecordingStore } from '../lib/recordings.mjs';
import { Accounts } from '../lib/accounts.mjs';
import { createApp } from '../server.mjs';

const video = (length = 32) => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(length - 4)]);
const metadata = { cameraName: 'Entrance', recorderName: 'Test recorder', duration: 3000, audio: true };
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'hik-recording-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await new RecordingStore(directory, { reserveBytes: 0, ...options }).open();
  const upload = (bytes = video(), extra = {}) => store.ingest(Readable.from([bytes]), { type: 'video/webm', metadata, contentLength: bytes.length, ...extra });
  return { directory, store, upload };
}
test('saved clips and retention settings survive a fresh storage instance', async t => {
  const { directory, store, upload } = await fixture(t);
  const { clip } = await upload();
  await store.settings({ retentionDays: 30, maxBytes: 1073741824 });
  const reopened = await new RecordingStore(directory, { reserveBytes: 0 }).open();
  const result = await reopened.list();
  assert.equal(result.clips[0].id, clip.id); assert.equal(result.clips[0].audio, true);
  assert.equal(result.storage.retentionDays, 30); assert.equal(result.storage.usedBytes, 32);
  assert.equal(result.storage.maxBytes, 1073741824);
});
test('retention cleanup expires clips at the selected period and preserves newer clips', async t => {
  let now = 1700000000000;
  const { store, upload, directory } = await fixture(t, { now: () => now });
  const oldest = await upload(); now += 6 * 86400000; const newest = await upload();
  now += 86400000; assert.equal(await store.cleanup(), 1);
  const result = await store.list(); assert.deepEqual(result.clips.map(clip => clip.id), [newest.clip.id]);
  assert.ok(!(await readdir(directory)).includes(oldest.clip.id + '.webm'));
  assert.equal(result.storage.usedBytes, 32);
  for (const retentionDays of [1, 7, 30, 90]) assert.equal((await store.settings({ retentionDays, maxBytes: 1073741824 })).storage.retentionDays, retentionDays);
  await assert.rejects(store.settings({ retentionDays: 365, maxBytes: 1073741824 }));
});
test('storage capacity removes the oldest recording before committing a new one', async t => {
  let now = 1700000000000;
  const { store, upload } = await fixture(t, { maxBytes: 60, now: () => now++ });
  const first = await upload(), second = await upload();
  assert.equal(second.removed, 1); assert.notEqual(first.clip.id, second.clip.id);
  assert.deepEqual((await store.list()).clips.map(clip => clip.id), [second.clip.id]);
  assert.ok((await store.list()).storage.usedBytes <= 60);
});
test('bad and interrupted uploads leave saved clips intact and no temporary files', async t => {
  const { store, upload, directory } = await fixture(t, { maxBytes: 60 });
  const first = await upload();
  await assert.rejects(upload(Buffer.alloc(32)), /not a supported/);
  await assert.rejects(upload(video(61)), /exceeds/);
  const broken = Readable.from((async function* () { yield video(); throw new Error('lost upload'); })());
  await assert.rejects(store.ingest(broken, { type: 'video/webm', metadata }), /could not be saved/);
  assert.deepEqual((await store.list()).clips.map(clip => clip.id), [first.clip.id]);
  assert.ok((await readdir(directory)).every(name => !name.endsWith('.part')));
  await assert.rejects(upload(video(), { id: '../../outside' }), /identifier/);
  await assert.rejects(upload(video(), { metadata: { ...metadata, cameraName: 'bad\nheader' } }), /details/);
});
test('retrying a completed upload with the same ID is idempotent', async t => {
  const { store, upload } = await fixture(t);
  const first = await upload(), repeated = await upload(video(), { id: first.clip.id });
  assert.equal(first.clip.id, repeated.clip.id); assert.equal((await store.list()).storage.clipCount, 1);
});
test('parallel uploads remain within the capacity and disk reserve rejects without cleanup', async t => {
  const { store, upload } = await fixture(t, { maxBytes: 70 });
  await Promise.all([upload(), upload(), upload()]);
  assert.equal((await store.list()).storage.clipCount, 2); assert.equal((await store.list()).storage.usedBytes, 64);
  store.reserveBytes = 1024; store.freeDiskBytes = async () => 10;
  await assert.rejects(upload(), error => error.status === 507);
  assert.equal((await store.list()).storage.clipCount, 2);
});
test('a failed index commit does not publish a partial recording', async t => {
  const { store, upload, directory } = await fixture(t); await upload();
  const original = store.commit.bind(store); store.commit = async () => { throw new Error('disk failure'); };
  await assert.rejects(upload(), /could not be saved/); store.commit = original;
  assert.equal((await store.list()).storage.clipCount, 1);
  assert.equal((await readdir(directory)).filter(name => name.endsWith('.webm')).length, 1);
});
test('recordings endpoints protect files, support seeking and work without a provider session', async t => {
  const { store } = await fixture(t); let saved = null;
  const accounts = await Accounts.open({ open: async () => {}, load: async () => saved, save: async state => { saved = structuredClone(state); } });
  const server = createApp({ accounts, recordings: store }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'X-Hik-Local': '1', 'Content-Type': 'application/json', ...headers }, body });
  assert.equal((await fetch(base + '/api/recordings')).status, 401);
  const setup = await post('/api/auth/setup', JSON.stringify({ username: 'owner', password: 'synthetic-password-42' }));
  const cookie = setup.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie, 'Content-Type': 'video/webm', 'X-Recording-Meta': encodeURIComponent(JSON.stringify(metadata)) };
  assert.equal((await post('/api/recordings', video(), { ...headers, Origin: 'https://hostile.invalid' })).status, 403);
  const response = await post('/api/recordings', video(), headers); assert.equal(response.status, 201);
  const { clip } = await response.json();
  assert.equal((await fetch(base + clip.url)).status, 401);
  const partial = await fetch(base + clip.url, { headers: { Cookie: cookie, Range: 'bytes=0-3' } });
  assert.equal(partial.status, 206); assert.equal(partial.headers.get('content-range'), 'bytes 0-3/32'); assert.deepEqual(Buffer.from(await partial.arrayBuffer()), video().subarray(0, 4));
  const suffix = await fetch(base + clip.url, { headers: { Cookie: cookie, Range: 'bytes=-4' } }); assert.equal((await suffix.arrayBuffer()).byteLength, 4);
  assert.equal((await fetch(base + clip.url, { headers: { Cookie: cookie, Range: 'bytes=100-200' } })).status, 416);
  const head = await fetch(base + clip.downloadUrl, { method: 'HEAD', headers: { Cookie: cookie } }); assert.equal(head.status, 200); assert.equal(head.headers.get('content-length'), '32'); assert.match(head.headers.get('content-disposition'), /^attachment/);
  assert.equal((await post('/api/recordings/settings', JSON.stringify({ retentionDays: 90, maxBytes: 1073741824 }), { Cookie: cookie })).status, 200);
  assert.equal((await post('/api/recordings/' + clip.id + '/delete', '{}', { Cookie: cookie })).status, 200);
  assert.equal((await fetch(base + clip.url, { headers: { Cookie: cookie } })).status, 404);
});
