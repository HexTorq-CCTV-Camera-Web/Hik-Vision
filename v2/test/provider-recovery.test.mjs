import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Accounts } from '../lib/accounts.mjs';
import { HikError } from '../lib/hik-connect.mjs';
import { createApp } from '../server.mjs';

const grant = { sessionId: 'synthetic-web-secret', sdkAccessToken: 'synthetic-sdk-secret', sdkExpiresAt: Date.now() + 3600000,
  accountUserId: 'synthetic-id', origin: 'https://iindia.hik-connect.com', user: { username: 'synthetic-user' } };
const device = { id: 'shared-test', serial: 'test', name: 'Test recorder', status: 'online', channels: [{ number: 1, name: 'Test channel' }] };
async function fixture(t, options = {}) {
  let saved = null;
  const accounts = await Accounts.open({ open: async () => {}, load: async () => saved, save: async value => { saved = structuredClone(value); } });
  let receiverStarts = 0, receiverStops = 0;
  const server = createApp({ accounts, connectBrowser: async () => grant, maxStreams: 4,
    hik: { devices: async () => [], sharing: async () => ({ state: 'records-found', devices: [device] }) },
    createLive: () => { receiverStarts++; return { state: 'playing', ready: Promise.resolve({ state: 'playing' }), stop() { receiverStops++; this.state = 'stopped'; }, status() { return { state: this.state }; } }; }, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (route, { method = 'GET', data = {}, cookie = '', headers = {} } = {}) => {
    const response = await fetch(base + route, { method, headers: { ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-Hik-Local': '1' } : {}), Cookie: cookie, ...headers }, ...(method === 'POST' ? { body: JSON.stringify(data) } : {}) });
    return { status: response.status, body: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], setCookie: response.headers.get('set-cookie') };
  };
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { accounts, call, starts: () => receiverStarts, stops: () => receiverStops };
}
const setup = async call => (await call('/api/auth/setup', { method: 'POST', data: { username: 'owner', password: 'synthetic-password-42' } })).cookie;

test('status separates web expiry, playback expiry and viewer login without leaking grants', async t => {
  const { call, accounts } = await fixture(t); const cookie = await setup(call);
  assert.equal((await call('/api/status', { cookie })).body.authorizationState, 'disconnected');
  await call('/api/connect/browser', { method: 'POST', cookie });
  const ready = (await call('/api/status', { cookie })).body;
  assert.equal(ready.authorizationState, 'ready'); assert.equal(ready.automaticRenewal, false);
  assert.ok(ready.connectionId); assert.ok(!JSON.stringify(ready).includes(grant.sessionId));
  await accounts.saveProvider({ ...accounts.provider(), sdkExpiresAt: Date.now() - 1 });
  assert.equal((await call('/api/status', { cookie })).body.authorizationState, 'playback-required');
  const blocked = await call('/api/live/start', { method: 'POST', cookie });
  assert.equal(blocked.body.code, 'playback-auth-required');
  await accounts.saveProvider({ ...accounts.provider(), needsReconnect: true });
  const expired = (await call('/api/status', { cookie })).body;
  assert.equal(expired.authorizationState, 'reconnect-required'); assert.equal(expired.sdkConnected, false);
  assert.equal((await call('/api/devices', { cookie })).body.code, 'provider-auth-required');
  assert.equal((await call('/api/auth/status', { cookie })).body.authenticated, true);
});

test('account switching isolates preferences and credentials; disconnect and re-login restore only that account settings', async t => {
  let next = grant; const { call, accounts } = await fixture(t, { connectBrowser: async () => next }); const cookie = await setup(call);
  const a = await call('/api/connect/browser', { method: 'POST', cookie });
  await call('/api/preferences', { method: 'POST', cookie, data: { favourites: ['account-a-camera'], groups: { a: 'Entrance' } } });
  next = { sessionId: 'account-b-web', origin: grant.origin, accountUserId: 'account-b', user: { username: 'B' } };
  const b = await call('/api/connect/browser', { method: 'POST', cookie });
  assert.notEqual(a.body.connectionId, b.body.connectionId); assert.equal(b.body.sdkConnected, false);
  assert.equal(accounts.provider().sdkAccessToken, undefined);
  assert.deepEqual((await call('/api/preferences', { cookie })).body, {});
  await call('/api/preferences', { method: 'POST', cookie, data: { favourites: ['account-b-camera'] } });
  await call('/api/disconnect', { method: 'POST', cookie });
  assert.deepEqual((await call('/api/preferences', { cookie })).body, {});
  next = { sessionId: 'account-a-new-web', origin: grant.origin, accountUserId: grant.accountUserId };
  await call('/api/connect/browser', { method: 'POST', cookie });
  assert.deepEqual((await call('/api/preferences', { cookie })).body.favourites, ['account-a-camera']);
  assert.equal(accounts.provider().sdkAccessToken, undefined);
});

test('stale tabs cannot save preferences, stop playback or disconnect a newly connected account', async t => {
  let next = grant; const { call } = await fixture(t, { connectBrowser: async () => next }); const cookie = await setup(call);
  const a = await call('/api/connect/browser', { method: 'POST', cookie });
  next = { ...grant, sessionId: 'another-account-web', accountUserId: 'another-account' };
  const b = await call('/api/connect/browser', { method: 'POST', cookie });
  for (const route of ['/api/preferences', '/api/live/stop-all', '/api/disconnect']) {
    const result = await call(route, { method: 'POST', cookie, headers: { 'X-Hik-Connection': a.body.connectionId } });
    assert.equal(result.status, 409); assert.equal(result.body.code, 'account-changed');
  }
  for (const path of ['/api/live/events', '/api/live/audio-events']) assert.equal((await call(path + '?connection=' + a.body.connectionId, { cookie })).body.code, 'account-changed');
  assert.equal((await call('/api/preferences', { method: 'POST', cookie, headers: { 'X-Hik-Connection': 'none' } })).body.code, 'account-changed');
  assert.equal((await call('/api/status', { cookie })).body.connectionId, b.body.connectionId);
});

test('an in-flight old device response cannot publish cameras after account replacement', async t => {
  let release, entered; const started = new Promise(resolve => { entered = resolve; });
  let next = grant;
  const { call } = await fixture(t, { connectBrowser: async () => next,
    hik: { devices: async () => { entered(); return new Promise(resolve => { release = resolve; }); }, sharing: async () => ({ devices: [] }) } });
  const cookie = await setup(call); await call('/api/connect/browser', { method: 'POST', cookie });
  const old = call('/api/devices', { cookie }); await started;
  next = { ...grant, sessionId: 'new-web', accountUserId: 'new-user' };
  await call('/api/connect/browser', { method: 'POST', cookie }); release([device]);
  const result = await old; assert.equal(result.body.code, 'account-changed'); assert.equal(result.body.devices, undefined);
});

test('a failed replacement login preserves the working account and playback grant', async t => {
  const { call, accounts } = await fixture(t, { connectPersonal: async () => { throw new Error('private-login-failure'); } });
  const cookie = await setup(call); await call('/api/connect/browser', { method: 'POST', cookie });
  const before = accounts.provider();
  const failed = await call('/api/connect/personal', { method: 'POST', cookie, data: { account: 'wrong-user', password: 'wrong-password' } });
  assert.equal(failed.status, 500); assert.deepEqual(accounts.provider(), before);
  assert.ok(!JSON.stringify(failed.body).includes('private-login-failure'));
});

test('provider outage is not recorded as authorization expiry', async t => {
  const { call, accounts } = await fixture(t, { hik: { devices: async () => { throw new HikError('Provider temporarily unavailable', 503); }, sharing: async () => ({ devices: [] }) } });
  const cookie = await setup(call); await call('/api/connect/browser', { method: 'POST', cookie });
  assert.equal((await call('/api/devices', { cookie })).status, 503);
  assert.notEqual(accounts.provider().needsReconnect, true);
  assert.equal((await call('/api/status', { cookie })).body.authorizationState, 'ready');
});

test('disconnect cannot race and resurrect a pending account sign-in', async t => {
  let finish, entered; const started = new Promise(resolve => { entered = resolve; });
  const { call } = await fixture(t, { connectBrowser: async () => { entered(); return new Promise(resolve => { finish = resolve; }); } });
  const cookie = await setup(call); const pending = call('/api/connect/browser', { method: 'POST', cookie }); await started;
  assert.equal((await call('/api/disconnect', { method: 'POST', cookie })).body.code, 'account-change-in-progress');
  finish(grant); assert.equal((await pending).status, 200);
  await call('/api/disconnect', { method: 'POST', cookie });
  assert.equal((await call('/api/status', { cookie })).body.authorizationState, 'disconnected');
});
