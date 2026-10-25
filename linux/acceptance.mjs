// Real-camera acceptance harness. Private listener, isolated in-memory viewer state.
import { Vault } from './lib/vault.mjs';
import { Accounts } from './lib/accounts.mjs';
import { createApp } from './server.mjs';
import { randomBytes } from 'node:crypto';

const saved = await (await new Vault('/home/mohan/cam/data').open()).load();
let state = { version: 1, owner: null, sessions: [], provider: saved.provider };
const memory = { async open() {}, async load() { return structuredClone(state); }, async save(next) { state = structuredClone(next); } };
const accounts = await Accounts.open(memory);
const password = randomBytes(24).toString('hex');
const token = await accounts.setup('acceptance', password);
const server = createApp({ accounts, publicOrigin: 'http://127.0.0.1:21001', maxStreams: 16 });
await new Promise(resolve => server.listen(21001, '127.0.0.1', resolve));
const api = async (path, data, authenticated = true) => {
  const response = await fetch('http://127.0.0.1:21001' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(authenticated ? { Cookie: 'hik_product=' + token } : {}),
      'Content-Type': 'application/json', 'X-Hik-Local': '1' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }), signal: AbortSignal.timeout(45000)
  });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error('HTTP ' + response.status), { status: response.status });
  return result;
};
const report = [];
const measure = async (device, channel, quality, slot, seconds = 6) => {
  const started = Date.now();
  const status = await api('/api/live/start', { deviceId: device.id, channel, quality, slot, delivery: 'smooth' });
  await new Promise(resolve => setTimeout(resolve, seconds * 1000));
  const current = await api('/api/live/status?slot=' + slot);
  return { recorder: device.name, channel, quality, slot, readySeconds: +((Date.now() - started) / 1000 - seconds).toFixed(1),
    state: current.state, width: current.width, height: current.height, codec: current.codec,
    audioState: current.audioState, audioSamples: current.audioSamples, videoStats: current.videoStats };
};
try {
  try { await api('/api/devices', undefined, false); report.push({ test: 'unauthorized', passed: false }); }
  catch (error) { report.push({ test: 'unauthorized', passed: error.status === 401 }); }
  const { devices } = await api('/api/devices');
  console.log(JSON.stringify({ test: 'device-list', recorders: devices.map(d => ({ name: d.name, status: d.status, channels: d.channels.length })) }));
  const online = devices.filter(d => d.status === 'online' && d.channels.length);
  for (const device of online) {
    try { const result = await measure(device, device.channels[0].number, 'sd', 0); report.push(result); console.log(JSON.stringify(result)); }
    catch (error) { const result = { recorder: device.name, quality: 'sd', failed: true, status: error.status || null }; report.push(result); console.log(JSON.stringify(result)); }
    await api('/api/live/stop', { slot: 0 });
  }
  if (online.length) {
    try { const result = await measure(online[0], online[0].channels[0].number, 'hd', 0, 8); report.push(result); console.log(JSON.stringify(result)); }
    catch (error) { console.log(JSON.stringify({ test: 'hd', failed: true, status: error.status || null })); }
    await api('/api/live/stop-all', {});
    const device = online[0];
    const results = await Promise.allSettled(device.channels.slice(0, 4).map((channel, slot) => measure(device, channel.number, 'sd', slot, 8)));
    const parallel = results.map((result, slot) => result.status === 'fulfilled' ? result.value : { slot, failed: true, status: result.reason.status || null });
    console.log(JSON.stringify({ test: 'four-concurrent', results: parallel })); report.push({ test: 'four-concurrent', results: parallel });
    await api('/api/live/stop-all', {});
    const reconnect = await measure(device, device.channels[0].number, 'sd', 0, 5);
    console.log(JSON.stringify({ test: 'stop-and-reconnect', ...reconnect })); report.push({ test: 'stop-and-reconnect', ...reconnect });
  }
} finally {
  await api('/api/live/stop-all', {}).catch(() => {});
  server.close(); server.closeAllConnections();
  const { writeFile } = await import('node:fs/promises');
  await writeFile('/home/mohan/cam/acceptance-results.json', JSON.stringify(report, null, 2), { mode: 0o600 });
}
