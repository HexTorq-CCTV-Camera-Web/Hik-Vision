import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnPooled, closeReceiverPools } from '../lib/pool-runner.mjs';

test('camera output stays separate; one SDK context serves the same grant and other grants stay isolated', async () => {
  const children = [];
  const create = (grant, serial) => {
    const child = spawnPooled(fileURLToPath(new URL('./echo-receiver.sh', import.meta.url))); children.push(child);
    const messages = [], waiters = []; let pending = '';
    child.stdout.on('data', data => {
      pending += data; const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines) { const value = JSON.parse(line); const waiter = waiters.shift(); waiter ? waiter(value) : messages.push(value); }
    });
    child.stdin.on('error', () => {});
    child.stdin.write(JSON.stringify({ accessToken: grant, serial }) + '\n');
    return { child, next: () => messages.length ? Promise.resolve(messages.shift()) : new Promise(resolve => waiters.push(resolve)) };
  };
  try {
    const a = create('synthetic-grant-A', 'camera-A'), b = create('synthetic-grant-A', 'camera-B');
    const firstA = await a.next(), firstB = await b.next();
    assert.equal(firstA.camera, 'camera-A'); assert.equal(firstB.camera, 'camera-B');
    assert.equal(firstA.pid, firstB.pid);
    const other = create('synthetic-grant-B', 'camera-C');
    const firstC = await other.next(); assert.notEqual(firstC.pid, firstA.pid);
    a.child.stdin.end();
    b.child.stdin.write('{"command":"preview"}\n');
    assert.equal((await b.next()).camera, 'camera-B');
  } finally {
    for (const child of children) child.stdin.end();
    closeReceiverPools();
  }
});
