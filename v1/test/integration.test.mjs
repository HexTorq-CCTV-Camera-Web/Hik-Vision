import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { createApp } from '../server.mjs';
import { createHikClient, HikError } from '../lib/hik-connect.mjs';
import { selectPortal, localDebugUrl, readBrowserSession } from '../lib/browser-session.mjs';

const credentials = { sessionId: 'test-secret-that-must-not-leak', origin: 'https://iindia.hik-connect.com', user: { username: 'test-account', country: 'India' } };
const action = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hik-Local': '1' }, body: '{}' };
async function serve(t, options = {}) {
  const server = createApp({ connectBrowser: async () => credentials,
    hik: { devices: async () => [], sharing: async () => ({ state: 'empty', mappingPending: false }) }, ...options });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return 'http://127.0.0.1:' + server.address().port;
}
async function connect(base) {
  const response = await fetch(base + '/api/connect/browser', action);
  return { response, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
test('selects only the official signed-in portal, ignoring unrelated tabs and lookalike hosts', () => {
  const portal = { type: 'page', url: 'https://www.hik-connect.com/views/main/index.html#/common/personal/DeviceManagement' };
  assert.equal(selectPortal([{ type: 'page', url: 'https://www.hik-connect.com.evil.test/views/main/' },
    { type: 'page', url: 'https://example.test/' }, portal]), portal);
  assert.equal(selectPortal([{ type: 'page', url: 'https://www.hik-connect.com/views/login/index.html' }]), undefined);
  assert.throws(() => localDebugUrl('http://remote.example:9222'), /local/);
  assert.throws(() => localDebugUrl('https://127.0.0.1:9222'), /local/);
});
test('Chrome bridge reports missing portal rather than reading an unrelated tab', async () => {
  await assert.rejects(() => readBrowserSession({ request: async () => Response.json([{ type: 'page', url: 'https://example.test' }]) }), /Open the signed-in/);
});
test('modern Chrome browser endpoint attaches only the Hik-Connect target and detaches after inspection', async () => {
  const calls = [];
  class Socket extends EventTarget {
    constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
    send(text) {
      const message = JSON.parse(text); calls.push(message);
      let result;
      if (message.method === 'Target.getTargets') result = { targetInfos: [{ type: 'page', url: 'https://example.test', targetId: 'other' }, { type: 'page', url: 'https://www.hik-connect.com/views/main/index.html', targetId: 'hik' }] };
      else if (message.method === 'Target.attachToTarget') result = { sessionId: 'cdp-target-session' };
      else if (message.method === 'Runtime.evaluate') result = { result: { value: credentials } };
      else result = {};
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ id: message.id, result }) })));
    }
    close() {}
  }
  const session = await readBrowserSession({ request: async () => new Response('', { status: 404 }), Socket,
    readActivePort: async () => '9222\n/devtools/browser/example-id\n' });
  assert.equal(session.sessionId, credentials.sessionId);
  assert.equal(calls.find(call => call.method === 'Target.attachToTarget').params.targetId, 'hik');
  assert.equal(calls.find(call => call.method === 'Runtime.evaluate').sessionId, 'cdp-target-session');
  assert.equal(calls.at(-1).method, 'Target.detachFromTarget');
});
test('serves only public app files and advertises the live playback integration', async t => {
  const base = await serve(t);
  for (const file of ['/', '/styles.css', '/app.mjs', '/favicon.svg']) assert.equal((await fetch(base + file)).status, 200, file);
  for (const file of ['/.env', '/.env.example', '/README.md', '/server.mjs', '/native/probe.py', '/lib/browser-session.mjs', '/%2e%2e%5cserver.mjs']) assert.equal((await fetch(base + file)).status, 404, file);
  assert.equal((await (await fetch(base + '/api/health')).json()).playbackReady, true);
});
test('browser connection uses an opaque HttpOnly cookie and never returns the cloud token', async t => {
  const base = await serve(t); const { response, cookie } = await connect(base);
  assert.equal(response.status, 200); assert.match(response.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.ok(!(await response.text()).includes(credentials.sessionId)); assert.ok(!cookie.includes(credentials.sessionId));
  const status = await (await fetch(base + '/api/status', { headers: { cookie } })).json();
  assert.equal(status.connected, true); assert.equal(status.user.username, 'test-account');
  assert.ok(!JSON.stringify(status).includes(credentials.sessionId));
});
test('empty authenticated devices are a successful result, and a different browser remains disconnected', async t => {
  const base = await serve(t); const { cookie } = await connect(base);
  const devices = await fetch(base + '/api/devices', { headers: { cookie } }); assert.equal(devices.status, 200);
  assert.deepEqual((await devices.json()).devices, []);
  assert.equal((await fetch(base + '/api/devices')).status, 401);
  await fetch(base + '/api/disconnect', { ...action, headers: { ...action.headers, cookie } });
  assert.equal((await fetch(base + '/api/devices', { headers: { cookie } })).status, 401);
});
test('cross-origin and forged-host requests cannot trigger Chrome access', async t => {
  let accessed = 0;
  const base = await serve(t, { connectBrowser: async () => { accessed++; return credentials; } });
  assert.equal((await fetch(base + '/api/connect/browser', { method: 'POST' })).status, 403);
  assert.equal((await fetch(base + '/api/connect/browser', { ...action, headers: { ...action.headers, Origin: 'https://evil.test' } })).status, 403);
  const forgedHostStatus = await new Promise((resolve, reject) => {
    const req = http.request(base + '/api/connect/browser', { method: 'POST', headers: { ...action.headers, Host: 'evil.test' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end('{}');
  });
  assert.equal(forgedHostStatus, 403);
  assert.equal(accessed, 0);
});
test('expired cloud authentication clears the workspace session', async t => {
  const base = await serve(t, { hik: { devices: async () => { throw new HikError('Session expired', 401); }, sharing: async () => ({ state: 'empty' }) } });
  const { cookie } = await connect(base);
  assert.equal((await fetch(base + '/api/devices', { headers: { cookie } })).status, 401);
  assert.equal((await (await fetch(base + '/api/status', { headers: { cookie } })).json()).connected, false);
});
test('unexpected errors never disclose cloud tokens or error stacks', async t => {
  const base = await serve(t, { connectBrowser: async () => { throw new Error('Chrome secret: ' + credentials.sessionId); } });
  const response = await fetch(base + '/api/connect/browser', action);
  assert.equal(response.status, 502); assert.ok(!(await response.text()).includes(credentials.sessionId));
});
test('cloud adapter accepts the captured empty owned/shared responses and uses session headers', async () => {
  const calls = [];
  const hik = createHikClient({ request: async (url, options) => {
    calls.push({ url, options });
    return Response.json({ meta: { code: 200 }, data: { resultCode: '0', success: true, data: url.includes('/devices/') ? [] : null } });
  } });
  assert.deepEqual(await hik.devices(credentials), []);
  assert.deepEqual(await hik.sharing(credentials), { state: 'empty', mappingPending: false });
  assert.equal(calls[0].options.headers.sessionId, credentials.sessionId);
  assert.ok(calls.every(call => call.url.startsWith('https://iindia.hik-connect.com/v3/hcweb/')));
});
test('device pagination deduplicates serials and does not fabricate channels or playback URLs', async () => {
  const hik = createHikClient({ request: async url => {
    const offset = Number(new URL(url).searchParams.get('offset'));
    return Response.json({ meta: { code: 200 }, data: { resultCode: '0', data: offset === 0
      ? Array.from({ length: 10 }, (_, i) => ({ deviceSerial: 'serial-' + i, deviceName: 'DVR ' + i }))
      : [{ deviceSerial: 'serial-9' }, { deviceSerial: 'serial-10' }] } });
  } });
  const devices = await hik.devices(credentials);
  assert.equal(devices.length, 11); assert.equal(devices[0].channelsReady, false); assert.equal(devices[0].playbackReady, false);
});
test('unknown sharing records remain pending, and unknown device schemas are rejected', async () => {
  const hik = createHikClient({ request: async () => Response.json({ meta: { code: 200 }, data: { resultCode: '0', data: { unexpected: true } } }) });
  assert.deepEqual(await hik.sharing(credentials), { state: 'records-found', mappingPending: true });
  await assert.rejects(() => hik.devices(credentials), /schema update/);
});

test('India portal is recognized and lookalike regional origins are rejected', () => {
  const page = { type: 'page', url: 'https://iindia.hik-connect.com/views/main/index.html#/common/personal/OtherShareDevices' };
  assert.equal(selectPortal([page]), page);
  assert.equal(selectPortal([{ ...page, url: 'https://iindia.hik-connect.com.evil.test/views/main/' }]), undefined);
  const modern = { type: 'page', url: 'https://iindia.hik-connect.com/views/login/index.html#/portal' };
  assert.equal(selectPortal([{ type: 'page', url: 'https://www.hik-connect.com/views/login/index.html#/portal' }, modern]), modern);
  assert.equal(selectPortal([{ ...modern, url: 'https://iindia.hik-connect.com/views/login/index.html#/login' }]), undefined);
});

test('shared India device records use the signed-in regional server without exposing NAT addresses', async () => {
  let requested;
  const hik = createHikClient({ request: async (url, options) => {
    if (url.endsWith('/share/accept/device')) {
      assert.equal(options.method, 'POST');
      assert.equal(options.body, 'deviceId=test-share');
      return Response.json({ resultCode: '0', shareDevice: { subSerial: 'TEST123', devName: 'Verified recorder', shareCameras: [
        { channelNo: 1, cameraName: 'Camera 01' }, { channelNo: 2, cameraName: 'Camera 02' }
      ] } });
    }
    requested = { url, options };
    return Response.json({ meta: { code: 200 }, data: { resultCode: '0', data: [
      { shareId: 'test-share', subSerial: 'TEST123', devDomain: 'Test recorder', status: 2, natIp: '192.0.2.1', natPort: 1000 },
      { subSerial: 'TEST456', devDomain: 'Other recorder', status: 99 },
      { subSerial: 'TEST789', devDomain: 'Online recorder', status: 1 }
    ] } });
  } });
  const result = await hik.sharing({ ...credentials, origin: 'https://iindia.hik-connect.com' });
  assert.equal(requested.url, 'https://iindia.hik-connect.com/v3/hcweb/share/domains');
  assert.match(requested.options.headers.Referer, /^https:\/\/iindia\.hik-connect\.com\//);
  assert.equal(result.devices.length, 3);
  assert.equal(result.devices[0].status, 'offline');
  assert.equal(result.devices[1].status, 'unknown');
  assert.equal(result.devices[2].status, 'online');
  assert.equal(result.devices[0].source, 'shared');
  assert.equal(result.devices[0].name, 'Verified recorder');
  assert.equal(result.devices[0].channelsReady, true);
  assert.deepEqual(result.devices[0].channels.map(c => c.number), [1, 2]);
  assert.ok(!JSON.stringify(result).includes('192.0.2.1'));
  assert.equal(result.mappingPending, false);
  await assert.rejects(hik.sharing({ ...credentials, origin: 'https://evil.test' }), /Unsupported/);
});

test('local device response includes verified shared records', async t => {
  const device = { id: 'shared-test', source: 'shared', name: 'Shared recorder', status: 'offline' };
  const base = await serve(t, { hik: { devices: async () => [], sharing: async () => ({ state: 'records-found', mappingPending: false, devices: [device] }) } });
  const { cookie } = await connect(base);
  const result = await (await fetch(base + '/api/devices', { headers: { cookie } })).json();
  assert.deepEqual(result.devices, [device]);
  assert.equal(result.playbackReady, true);
});

test('live playback requires a connected account and a discovered permitted channel', async t => {
  let started = 0, stopped = 0;
  const device = { id: 'shared-test', serial: 'TEST123', name: 'Shared recorder', source: 'shared', status: 'online', channels: [{ number: 1, name: 'Camera 01' }] };
  const base = await serve(t, { hik: { devices: async () => [], sharing: async () => ({ state: 'records-found', devices: [device] }) },
    createLive: (_session, selected, channel, quality) => {
      started++; assert.equal(selected.serial, 'TEST123'); assert.equal(channel, 1); assert.equal(quality, 'hd');
      return { ready: Promise.resolve({ state: 'playing', width: 960, height: 1088 }), stop: () => { stopped++; }, status: () => ({ state: 'playing' }) };
    } });
  const selection = { deviceId: 'shared-test', channel: 1, quality: 'hd' };
  const post = (cookie, value = selection) => fetch(base + '/api/live/start', { ...action, headers: { ...action.headers, ...(cookie ? { cookie } : {}) }, body: JSON.stringify(value) });
  assert.equal((await post()).status, 401);
  const { cookie } = await connect(base);
  assert.equal((await post(cookie)).status, 403);
  await fetch(base + '/api/devices', { headers: { cookie } });
  assert.equal((await post(cookie, { ...selection, channel: 2 })).status, 403);
  assert.equal((await post(cookie, { ...selection, quality: 'arbitrary' })).status, 400);
  assert.equal(started, 0);
  const response = await post(cookie); assert.equal(response.status, 200);
  assert.equal((await response.json()).state, 'playing');
  assert.equal(started, 1);
  assert.equal((await fetch(base + '/api/live/status')).status, 401);
  assert.equal((await fetch(base + '/api/live/audio')).status, 401);
  assert.equal((await fetch(base + '/api/live/audio', { headers: { cookie, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  await fetch(base + '/api/disconnect', { ...action, headers: { ...action.headers, cookie } });
  assert.equal(stopped, 1);
  assert.equal((await fetch(base + '/api/live/video', { headers: { cookie } })).status, 401);
});

test('offline recorders cannot start a native receiver', async t => {
  const device = { id: 'offline', serial: 'TEST123', status: 'offline', channels: [{ number: 1 }] };
  const base = await serve(t, { hik: { devices: async () => [], sharing: async () => ({ devices: [device] }) }, createLive: () => { throw new Error('Must not run'); } });
  const { cookie } = await connect(base); await fetch(base + '/api/devices', { headers: { cookie } });
  const response = await fetch(base + '/api/live/start', { ...action, headers: { ...action.headers, cookie }, body: JSON.stringify({ deviceId: 'offline', channel: 1, quality: 'hd' }) });
  assert.equal(response.status, 409); assert.match((await response.json()).error, /offline/);
});
