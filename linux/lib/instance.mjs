import net from 'node:net';
import path from 'node:path';
import { unlink } from 'node:fs/promises';
import { AccountError } from './accounts.mjs';
export function acquireInstance(directory) {
  const file = path.join(directory, 'viewer.sock');
  const attempt = retry => new Promise((resolve, reject) => {
    const guard = net.createServer(socket => socket.destroy());
    guard.once('error', error => {
      if (error.code !== 'EADDRINUSE' || !retry) return reject(new AccountError('A viewer is already running for this account store.', 503));
      const probe = net.connect(file); probe.once('connect', () => { probe.destroy(); reject(new AccountError('A viewer is already running for this account store.', 503)); });
      probe.once('error', async error => { if (error.code !== 'ECONNREFUSED') return reject(error); await unlink(file).catch(() => {}); attempt(false).then(resolve, reject); });
    });
    guard.listen(file, () => resolve(guard));
  });
  return attempt(true);
}
