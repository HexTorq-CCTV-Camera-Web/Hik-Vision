// Each authorized channel must yield a freshly decoded preview. No pictures are saved.
import { Vault } from './lib/vault.mjs';
import { Accounts } from './lib/accounts.mjs';
import { createApp } from './server.mjs';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const saved = await (await new Vault('/home/mohan/cam/data').open()).load();
let state = { version: 1, owner: null, sessions: [], provider: saved.provider };
const accounts = await Accounts.open({ async open() {}, async load() { return structuredClone(state); }, async save(value) { state = structuredClone(value); } });
const token = await accounts.setup('channel-check', randomBytes(24).toString('hex'));
const server = createApp({ accounts, publicOrigin: 'http://127.0.0.1:21002', maxStreams: 16 });
await new Promise(resolve => server.listen(21002, '127.0.0.1', resolve));
const api = async path => {
  const response = await fetch('http://127.0.0.1:21002' + path, {
    headers: { Cookie: 'hik_product=' + token }, signal: AbortSignal.timeout(45000) });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error || 'Request failed'), { status: response.status });
  return data;
};
const report = [];
const wanted = process.env.HIK_CHECK_NAMES?.split(',');
const output = wanted ? '/home/mohan/cam/channel-results-extra.json' : '/home/mohan/cam/channel-results.json';
try {
  const { devices } = await api('/api/devices');
  for (const device of devices.filter(device => device.status === 'online' && (!wanted || wanted.includes(device.name)))) {
    for (const channel of device.channels) {
      let result;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const started = Date.now();
        try {
          const image = await api('/api/previews/frame?deviceId=' + encodeURIComponent(device.id) + '&channel=' + channel.number);
          const bytes = Buffer.from(image.jpeg || '', 'base64');
          result = { recorder: device.name, channel: channel.number, attempt,
            passed: bytes[0] === 255 && bytes[1] === 216 && image.width > 0 && image.height > 0,
            width: image.width, height: image.height, bytes: bytes.length,
            seconds: +((Date.now() - started) / 1000).toFixed(1) };
          if (result.passed) break;
        } catch (error) {
          result = { recorder: device.name, channel: channel.number, attempt, passed: false, status: error.status || null };
        }
      }
      report.push(result); console.log(JSON.stringify(result));
      await writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
    }
  }
} finally {
  server.close(); server.closeAllConnections();
  console.log(JSON.stringify({ total: report.length, passed: report.filter(item => item.passed).length, failed: report.filter(item => !item.passed).length }));
}
