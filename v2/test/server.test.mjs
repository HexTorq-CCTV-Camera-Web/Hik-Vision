import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Accounts } from '../lib/accounts.mjs';
import { Vault } from '../lib/vault.mjs';
import { HikError } from '../lib/hik-connect.mjs';
import { createApp } from '../server.mjs';

const grant = { sessionId: 'synthetic-web-secret', sdkAccessToken: 'synthetic-sdk-secret', sdkExpiresAt: Date.now() + 3600000,
  accountUserId: 'synthetic-id', origin: 'https://iindia.hik-connect.com', user: { username: 'synthetic-user' } };
const device = { id: 'shared-test', serial: 'test', name: 'Test recorder', status: 'online', channels: [{ number: 1, name: 'Test channel' }] };
async function fixture(t, options = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'hik-http-test-'));
  const accounts = await Accounts.open(new Vault(directory, { protect: async bytes => bytes }));
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
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  return { accounts, call, starts: () => receiverStarts, stops: () => receiverStops };
}
const setup = async call => (await call('/api/auth/setup', { method: 'POST', data: { username: 'owner', password: 'synthetic-password-42' } })).cookie;

test('all account/device/media APIs require viewer authentication; hostile origins cannot set up or import accounts', async t => {
  const { call } = await fixture(t);
  assert.equal((await call('/api/status')).status, 401);
  assert.equal((await call('/api/live/video')).status, 401);
  assert.equal((await call('/api/live/audio-events')).status, 401);
  assert.equal((await call('/api/connect/browser', { method: 'POST' })).status, 401);
  assert.equal((await call('/api/auth/setup', { method: 'POST', headers: { Origin: 'https://hostile.invalid' } })).status, 403);
  const cookie = await setup(call);
  assert.equal((await call('/api/connect/browser', { method: 'POST', cookie, headers: { Origin: 'https://hostile.invalid' } })).status, 403);
});
test('linking persists credentials without exposing them and logout revokes the local session', async t => {
  const { call, accounts } = await fixture(t);
  const cookie = await setup(call);
  const linked = await call('/api/connect/browser', { method: 'POST', cookie });
  assert.equal(linked.status, 200); assert.equal(linked.body.sdkConnected, true);
  assert.ok(!JSON.stringify(linked.body).includes('synthetic-sdk-secret'));
  assert.equal(accounts.provider().sessionId, grant.sessionId);
  await call('/api/auth/logout', { method: 'POST', cookie });
  assert.equal((await call('/api/devices', { cookie })).status, 401);
  assert.equal(accounts.provider().sessionId, grant.sessionId);
});
test('device permission checks and SDK expiry prevent unauthorized receiver starts', async t => {
  const { call, accounts, starts } = await fixture(t);
  const cookie = await setup(call);
  await call('/api/connect/browser', { method: 'POST', cookie });
  await call('/api/devices', { cookie });
  assert.equal((await call('/api/live/start', { method: 'POST', cookie, data: { deviceId: 'shared-test', channel: 2, quality: 'hd' } })).status, 403);
  assert.equal(starts(), 0);
  await accounts.saveProvider({ ...grant, sdkExpiresAt: Date.now() - 1 });
  assert.equal((await call('/api/live/start', { method: 'POST', cookie, data: { deviceId: 'shared-test', channel: 1, quality: 'hd' } })).status, 409);
  assert.equal(starts(), 0);
});
test('disconnect stops playback and deletes the persisted grant', async t => {
  const { call, accounts, starts, stops } = await fixture(t);
  const cookie = await setup(call);
  await call('/api/connect/browser', { method: 'POST', cookie }); await call('/api/devices', { cookie });
  assert.equal((await call('/api/live/start', { method: 'POST', cookie, data: { deviceId: 'shared-test', channel: 1, quality: 'hd' } })).status, 200);
  assert.equal(starts(), 1);
  await call('/api/disconnect', { method: 'POST', cookie });
  assert.ok(stops() >= 1); assert.equal(accounts.provider(), null);
});
test('expired provider access does not sign the user out of the viewer', async t => {
  const { call, accounts } = await fixture(t, { hik: { devices: async () => { throw new HikError('synthetic-expiry', 401); }, sharing: async () => ({ devices: [] }) } });
  const cookie = await setup(call); await call('/api/connect/browser', { method: 'POST', cookie });
  assert.equal((await call('/api/devices', { cookie })).status, 409);
  assert.equal((await call('/api/auth/status', { cookie })).body.authenticated, true);
  assert.equal(accounts.provider().needsReconnect, true);
});
test('reimporting the same web account preserves a still-valid SDK grant, another account cannot inherit it', async t => {
  let next = grant;
  const { call, accounts } = await fixture(t, { connectBrowser: async () => next });
  const cookie = await setup(call);
  await call('/api/connect/browser', { method: 'POST', cookie });
  next = { sessionId: 'renewed-web-secret', origin: grant.origin, accountUserId: grant.accountUserId };
  await call('/api/connect/browser', { method: 'POST', cookie });
  assert.equal(accounts.provider().sdkAccessToken, grant.sdkAccessToken);
  next = { ...next, accountUserId: 'different-account' };
  await call('/api/connect/browser', { method: 'POST', cookie });
  assert.equal(accounts.provider().sdkAccessToken, undefined);
});

test('desktop playback credentials are saved only after a shared-channel authorization succeeds', async t => {
  let allowed = false;
  const { call, accounts } = await fixture(t, {
    connectBrowser: async () => ({ ...grant, sdkAccessToken: undefined, sdkExpiresAt: undefined }),
    desktopToken: async () => 'synthetic-desktop-secret',
    verifySdk: async (token, selected, channel) => {
      assert.equal(token, 'synthetic-desktop-secret'); assert.equal(selected.id, device.id); assert.equal(channel, 1);
      if (!allowed) throw new Error('synthetic-private-error');
      return { validatedAt: Date.now() };
    }
  });
  const cookie = await setup(call);
  await call('/api/connect/browser', { method: 'POST', cookie });
  const failed = await call('/api/connect/desktop', { method: 'POST', cookie });
  assert.equal(failed.status, 500); assert.ok(!JSON.stringify(failed.body).includes('synthetic-private-error'));
  assert.equal(accounts.provider().sdkAccessToken, undefined);
  allowed = true;
  const saved = await call('/api/connect/desktop', { method: 'POST', cookie });
  assert.equal(saved.status, 200); assert.equal(saved.body.sdkConnected, true);
  assert.ok(!JSON.stringify(saved.body).includes('synthetic-desktop-secret'));
  assert.equal(accounts.provider().sdkExpiresAt, null);
  assert.equal(accounts.provider().sdkSource, 'installed-client');
});

test('offline cameras cannot start a native receiver', async t => {
  const { call, starts } = await fixture(t, { hik: { devices: async () => [], sharing: async () => ({ devices: [{ ...device, status: 'offline' }] }) } });
  const cookie = await setup(call); await call('/api/connect/browser', { method: 'POST', cookie });
  await call('/api/devices', { cookie });
  const response = await call('/api/live/start', { method: 'POST', cookie, data: { deviceId: device.id, channel: 1, quality: 'hd' } });
  assert.equal(response.status, 409); assert.match(response.body.error, /offline/); assert.equal(starts(), 0);
});

test('smooth delivery is explicitly validated and forwarded only after authorization', async t => {
  let options;
  const { call } = await fixture(t, { createLive: (_provider, _device, _channel, _quality, input) => {
    options = input;
    return { state: 'playing', ready: Promise.resolve({ state: 'playing' }), status() { return { state: this.state }; }, stop() { this.state = 'stopped'; } };
  } });
  const cookie = await setup(call);
  await call('/api/connect/browser', { method: 'POST', cookie }); await call('/api/devices', { cookie });
  const start = (delivery, channel = 1) => call('/api/live/start', { method: 'POST', cookie, data: { deviceId: device.id, channel, quality: 'hd', delivery } });
  assert.equal((await start('unknown')).status, 400);
  assert.equal(options, undefined);
  assert.equal((await start('smooth', 2)).status, 403);
  assert.equal(options, undefined);
  assert.equal((await start('smooth')).status, 200);
  assert.equal(options.delivery, 'smooth');
});

test('global website sessions can use a verified India desktop playback grant without bypassing channel permissions', async t => {
  const { call, starts } = await fixture(t, {
    connectBrowser: async () => ({ ...grant, origin: 'https://www.hik-connect.com', sdkAccessToken: undefined, sdkExpiresAt: undefined }),
    desktopToken: async () => 'synthetic-desktop-secret',
    verifySdk: async () => ({ validatedAt: Date.now() })
  });
  const cookie = await setup(call);
  await call('/api/connect/browser', { method: 'POST', cookie });
  await call('/api/devices', { cookie });
  const start = channel => call('/api/live/start', { method: 'POST', cookie, data: { deviceId: device.id, channel, quality: 'hd' } });
  assert.equal((await start(1)).status, 409);
  assert.equal(starts(), 0);
  assert.equal((await call('/api/connect/desktop', { method: 'POST', cookie })).status, 200);
  await call('/api/devices', { cookie });
  assert.equal((await start(2)).status, 403);
  assert.equal(starts(), 0);
  assert.equal((await start(1)).status, 200);
  assert.equal(starts(), 1);
});

test('HTTPS hosting uses Secure cookies and cannot create its owner remotely', async t => {
  const { call, accounts } = await fixture(t, { publicOrigin: 'https://cameras.example.invalid' });
  assert.equal((await call('/api/auth/setup', { method: 'POST', headers: { Origin: 'https://cameras.example.invalid' } })).status, 403);
  await accounts.setup('owner', 'synthetic-password-42');
  const response = await call('/api/auth/login', { method: 'POST', data: { username: 'owner', password: 'synthetic-password-42' }, headers: { Origin: 'https://cameras.example.invalid' } });
  assert.equal(response.status, 200); assert.match(response.setCookie, /; Secure/);
});

test('the viewer cap applies across browser sessions and stopping a stream frees a slot', async t => {
  const { call, accounts, starts } = await fixture(t);
  const first = await setup(call); await call('/api/connect/browser', { method: 'POST', cookie: first });
  const cookies = [first];
  for (let i = 0; i < 4; i++) cookies.push('hik_product=' + await accounts.login('owner', 'synthetic-password-42'));
  for (const cookie of cookies) await call('/api/devices', { cookie });
  for (const cookie of cookies.slice(0, 4)) assert.equal((await call('/api/live/start', { method: 'POST', cookie, data: { deviceId: device.id, channel: 1, quality: 'hd' } })).status, 200);
  const rejected = await call('/api/live/start', { method: 'POST', cookie: cookies[4], data: { deviceId: device.id, channel: 1, quality: 'hd' } });
  assert.equal(rejected.status, 409); assert.equal(starts(), 4);
  await call('/api/live/stop', { method: 'POST', cookie: cookies[0] });
  assert.equal((await call('/api/live/start', { method: 'POST', cookie: cookies[4], data: { deviceId: device.id, channel: 1, quality: 'hd' } })).status, 200);
});

test('separate tiles keep independent receivers and enforce each requested channel permission', async t => {
  const { call, starts } = await fixture(t, { maxStreams: 16 });
  const cookie = await setup(call); await call('/api/connect/browser', { method: 'POST', cookie }); await call('/api/devices', { cookie });
  for (const slot of [0,15]) assert.equal((await call('/api/live/start', { method: 'POST', cookie, data: { slot, deviceId: device.id, channel: 1, quality: 'sd' } })).status, 200);
  assert.equal(starts(), 2);
  await call('/api/live/stop', { method: 'POST', cookie, data: { slot: 15 } });
  assert.equal((await call('/api/live/status?slot=0', { cookie })).body.state, 'playing');
  assert.equal((await call('/api/live/status?slot=15', { cookie })).body.state, 'stopped');
  assert.equal((await call('/api/live/status?slot=32', { cookie })).status, 400);
  assert.equal((await call('/api/live/audio-focus', { method: 'POST', cookie, data: { slots: [32] } })).status, 400);
});

test('stopping a tile while startup is pending cannot resurrect its stream', async t => {
  let ready, started; const startedSignal = new Promise(resolve => { started = resolve; });
  const { call } = await fixture(t, { createLive: () => {
    const promise = new Promise(resolve => { ready = resolve; });
    const live = { state: 'connecting', ready: promise, stop() { this.state = 'stopped'; ready({ state: 'stopped' }); }, status() { return { state: this.state }; } };
    started(); return live;
  } });
  const cookie = await setup(call); await call('/api/connect/browser', { method: 'POST', cookie }); await call('/api/devices', { cookie });
  const pending = call('/api/live/start', { method: 'POST', cookie, data: { slot: 2, deviceId: device.id, channel: 1, quality: 'sd' } });
  await startedSignal; await call('/api/live/stop', { method: 'POST', cookie, data: { slot: 2 } });
  assert.equal((await pending).status, 409);
  assert.equal((await call('/api/live/status?slot=2', { cookie })).body.state, 'stopped');
});

test('viewer preferences persist without a provider connection and are never public', async t => {
  const { call, accounts } = await fixture(t); assert.equal((await call('/api/preferences')).status, 401);
  const cookie = await setup(call);
  const response = await call('/api/preferences', { method: 'POST', cookie, data: { grid: 9, favourites: ['shared-test:1'], volume: 0.4, layouts: [], groups: {} } });
  assert.equal(response.status, 200); assert.equal(accounts.preferences().grid, 9);
  assert.equal((await call('/api/preferences', { cookie })).body.favourites[0], 'shared-test:1');
});

test('bulk stop validates all slots before stopping and leaves the visible batch running', async t => {
  const { call, stops } = await fixture(t);
  const cookie = await setup(call); await call('/api/connect/browser', { method: 'POST', cookie }); await call('/api/devices', { cookie });
  for (const slot of [0,31]) assert.equal((await call('/api/live/start', { method: 'POST', cookie, data: { slot, deviceId: 'shared-test', channel: 1, quality: 'sd' } })).status, 200);
  const before = stops();
  assert.equal((await call('/api/live/stop-slots', { method: 'POST', cookie, data: { slots: [31,32] } })).status, 400);
  assert.equal(stops(),before);
  assert.equal((await call('/api/live/stop-slots', { method: 'POST', cookie, data: { slots: [31] } })).status, 200);
  assert.equal(stops(),before+1);
  const states = (await call('/api/live/status?all=1', { cookie })).body;
  assert.equal(states.find(state => state.slot === 0).state,'playing');
});

test('independent snapshots require permissions, cache results and stop their temporary receiver', async t => {
  let starts=0, stops=0;
  const image={jpeg:'/9j/2Q==',width:320,height:180,capturedAt:Date.now()};
  const {call}=await fixture(t,{createLive:(_p,_d,_c,_q,options)=>{
    starts++; assert.equal(options.previewOnly,true);
    return {state:'connecting',preview:async()=>image,stop:()=>stops++};
  }});
  assert.equal((await call('/api/previews/frame?deviceId=shared-test&channel=1')).status,401);
  const cookie=await setup(call);await call('/api/connect/browser',{method:'POST',cookie});await call('/api/devices',{cookie});
  assert.equal((await call('/api/previews/frame?deviceId=shared-test&channel=2',{cookie})).status,403);
  const one=await call('/api/previews/frame?deviceId=shared-test&channel=1',{cookie});
  const two=await call('/api/previews/frame?deviceId=shared-test&channel=1',{cookie});
  assert.equal(one.status,200);assert.deepEqual(one.body,image);assert.deepEqual(two.body,image);assert.equal(starts,1);assert.equal(stops,1);
});
test('snapshots reuse an already playing camera without stopping or replacing it', async t => {
  let starts=0, stops=0;
  const {call}=await fixture(t,{maxStreams:1,createLive:()=>{
    starts++; return {state:'playing',ready:Promise.resolve({state:'playing'}),status:()=>({state:'playing'}),deviceId:'shared-test',channel:1,
    preview:async()=>({jpeg:'/9j/2Q==',width:320,height:180,capturedAt:Date.now()}),stop:()=>stops++};
  }});
  const cookie=await setup(call);await call('/api/connect/browser',{method:'POST',cookie});await call('/api/devices',{cookie});
  await call('/api/live/start',{method:'POST',cookie,data:{deviceId:'shared-test',channel:1,quality:'sd'}});
  assert.equal((await call('/api/previews/frame?deviceId=shared-test&channel=1',{cookie})).status,200);
  assert.equal(starts,1); assert.equal(stops,0);
});
