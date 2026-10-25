import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Vault } from '../lib/vault.mjs';
import { acquireInstance } from '../lib/instance.mjs';

test('Linux refuses an account key readable by another user', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hik-linux-permissions-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await new Vault(directory).open();
  await chmod(path.join(directory, 'key.local'), 0o644);
  await assert.rejects(new Vault(directory).open(), /mode 600/);
});
test('the Linux socket prevents simultaneous vault writers and releases on close', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hik-linux-instance-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const first = await acquireInstance(directory);
  try { await assert.rejects(acquireInstance(directory), /already running/); }
  finally { await new Promise(resolve => first.close(resolve)); }
  const second = await acquireInstance(directory);
  await new Promise(resolve => second.close(resolve));
});
