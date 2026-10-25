import test from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { connectionFeedback } from '../public/connection-feedback.mjs';
import { requestApi } from '../public/api.mjs';
import { retryableStreamError } from '../public/view-model.mjs';
import { createHikClient, unwrap, HikError } from '../lib/hik-connect.mjs';
import { Accounts } from '../lib/accounts.mjs';
import { createApp } from '../server.mjs';
import { NativeLive, LiveError } from '../lib/live.mjs';

test('connection feedback separates recorder, channel, authorization, server and cloud failures', () => {
  for (const [code, kind, retry] of [
    ['recorder-offline', 'offline', true], ['channel-unavailable', 'channel', false],
    ['provider-auth-required', 'authorization', false], ['playback-auth-required', 'authorization', false],
    ['server-unreachable', 'server', true], ['server-timeout', 'server', true], ['provider-unavailable', 'provider', true],
    ['provider-access-denied', 'provider', false], ['sdk-start-failed', 'video', true], ['receiver-unavailable', 'server', false],
  ]) {
    const result = connectionFeedback({ code }); assert.equal(result.kind, kind, code); assert.equal(result.retry, retry, code);
    assert.ok(result.title); assert.ok(result.detail); assert.ok(result.actionLabel);
    assert.equal(retryableStreamError({ code }), retry, code);
  }
  assert.equal(connectionFeedback({ code: 'server-unreachable' }, { recorderStatus: 'offline' }).kind, 'server');
  assert.equal(connectionFeedback({ code: 'channel-unavailable' }, { recorderStatus: 'offline' }).kind, 'channel');
  assert.equal(connectionFeedback({}, { recorderStatus: 'offline' }).kind, 'offline');
  assert.equal(connectionFeedback({}, { browserOnline: false }).title, 'No internet connection');
});
test('API network, timeout and malformed responses receive actionable codes', async () => {
  await assert.rejects(requestApi('/test', 'GET', { request: async () => { throw new TypeError('fetch failed'); } }), error => error.code === 'server-unreachable');
  await assert.rejects(requestApi('/test', 'GET', { request: async () => { throw Object.assign(new Error(), { name: 'TimeoutError' }); } }), error => error.code === 'server-timeout');
  await assert.rejects(requestApi('/test', 'GET', { request: async () => new Response('<html>gateway failure</html>', { status: 502 }) }), error => error.code === 'server-error');
  await assert.rejects(requestApi('/test', 'GET', { request: async () => new Response('not json') }), error => error.code === 'server-response-error');
  await assert.rejects(requestApi('/test', 'GET', { request: async () => Response.json({ error: 'cloud down', code: 'provider-unavailable' }, { status: 502 }) }), error => error.code === 'provider-unavailable');
});
test('provider business and access failures are not indiscriminately treated as expired sessions', () => {
  for (const value of [null, 'bad response', []]) assert.throws(() => unwrap(value), error => error.code === 'provider-response-error');
  assert.throws(() => unwrap({ meta: { code: 401 } }), error => error.status === 401 && error.code === 'provider-auth-required');
  assert.throws(() => unwrap({ meta: { code: 403 } }), error => error.status === 403 && error.code === 'provider-access-denied');
  assert.throws(() => unwrap({ meta: { code: 503 } }), error => error.status === 502 && error.code === 'provider-response-error');
  assert.throws(() => unwrap({ success: false }), error => error.status !== 401);
  assert.throws(() => unwrap({ resultCode: 'unknown' }), error => error.status !== 401);
});
test('provider transport failures preserve their distinction from explicit HTTP 401', async () => {
  for (const [status, code] of [[401, 'provider-auth-required'], [403, 'provider-access-denied'], [503, 'provider-unavailable']]) {
    const client = createHikClient({ request: async () => new Response('', { status }) });
    await assert.rejects(client.devices({ sessionId: 'synthetic' }), error => error.code === code);
  }
  const client = createHikClient({ request: async () => { throw Object.assign(new Error(), { name: 'TimeoutError' }); } });
  await assert.rejects(client.devices({ sessionId: 'synthetic' }), error => error.code === 'provider-timeout');
});
test('receiver status and rejected startup carry specific non-authorization failure codes', async () => {
  for (const [event, code] of [
    [{ stage: 'decode-timeout' }, 'stream-timeout'], [{ stage: 'decoder-ended' }, 'decode-failed'],
    [{ stage: 'device-details', result: -1 }, 'sdk-start-failed'], [{ stage: 'initialize', result: -1 }, 'receiver-unavailable'],
    [{ stage: 'playback-event', event: 0 }, 'playback-rejected'],
  ]) {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => child.emit('close', 0); child.stdin.on('finish', () => child.emit('close', 0));
    const live = new NativeLive({ sdkAccessToken: 'synthetic' }, { id: 'test', serial: 'test', name: 'test' }, 1, 'sd', { runner: () => child });
    const rejected = assert.rejects(live.ready, error => error.code === code); child.stdout.write(JSON.stringify(event) + '\n'); await rejected;
    assert.equal(live.status().errorCode, code); assert.notEqual(connectionFeedback({ code }).kind, 'authorization');
  }
});
test('HTTP camera errors distinguish missing channels, offline recorders and receiver rejection without revoking grants', async t => {
  let saved = null; const accounts = await Accounts.open({ open: async () => {}, load: async () => saved, save: async state => { saved = structuredClone(state); } });
  const device = { id: 'test', serial: 'test', name: 'Test', status: 'offline', channels: [{ number: 1, name: 'Entrance' }] };
  const server = createApp({ accounts, connectBrowser: async () => ({ sessionId: 'test', sdkAccessToken: 'test-sdk', sdkExpiresAt: Date.now() + 100000, accountUserId: 'test-user', origin: 'https://iindia.hik-connect.com' }),
    hik: { devices: async () => [device], sharing: async () => ({ devices: [] }) }, createLive: () => ({ ready: Promise.reject(new LiveError('Camera rejected start', 502, 'sdk-start-failed')), stop() {} }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (route, data, cookie = '') => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hik-Local': '1', Cookie: cookie }, body: JSON.stringify(data) });
  const setup = await post('/api/auth/setup', { username: 'owner', password: 'synthetic-password-42' }); const cookie = setup.headers.get('set-cookie').split(';')[0];
  await post('/api/connect/browser', {}, cookie); await fetch(base + '/api/devices', { headers: { Cookie: cookie } });
  assert.equal((await (await post('/api/live/start', { deviceId: 'test', channel: 1, quality: 'sd' }, cookie)).json()).code, 'recorder-offline');
  assert.equal((await (await post('/api/live/start', { deviceId: 'test', channel: 2, quality: 'sd' }, cookie)).json()).code, 'channel-unavailable');
  device.status = 'online'; await fetch(base + '/api/devices', { headers: { Cookie: cookie } });
  assert.equal((await (await post('/api/live/start', { deviceId: 'test', channel: 1, quality: 'sd' }, cookie)).json()).code, 'sdk-start-failed');
  const status = await (await fetch(base + '/api/status', { headers: { Cookie: cookie } })).json(); assert.equal(status.authorizationState, 'ready');
  assert.notEqual(accounts.provider().needsReconnect, true);
});
