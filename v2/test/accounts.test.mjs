import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { Vault, protectWindows } from '../lib/vault.mjs';
import { Accounts } from '../lib/accounts.mjs';
import { acquireInstance } from '../lib/instance.mjs';
const protect = async bytes => bytes; // Only the OS wrapping is mocked; AES-GCM is real.
async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'hik-product-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return { directory, accounts: await Accounts.open(new Vault(directory, { protect })) };
}
test('Windows DPAPI protects the key for the current Windows account', { skip: process.platform !== 'win32' }, async () => {
  const key = randomBytes(32), wrapped = await protectWindows(key, 'protect');
  assert.notDeepEqual(wrapped, key); assert.deepEqual(await protectWindows(wrapped, 'unprotect'), key);
});
test('Windows prevents simultaneous server writers to the same vault', { skip: process.platform !== 'win32' }, async () => {
  const directory = path.join(tmpdir(), 'hik-instance-' + randomBytes(8).toString('hex'));
  const guard = await acquireInstance(directory);
  try { await assert.rejects(acquireInstance(directory), /already running/); }
  finally { await new Promise(resolve => guard.close(resolve)); }
  const reopened = await acquireInstance(directory);
  await new Promise(resolve => reopened.close(resolve));
});
test('encrypted credentials and hashed viewer sessions survive reopening the account store', async t => {
  const { directory, accounts } = await fixture(t);
  const token = await accounts.setup('owner', 'synthetic-password-42');
  await accounts.saveProvider({ sessionId: 'synthetic-cloud-secret', sdkAccessToken: 'synthetic-sdk-secret' });
  const bytes = await readFile(path.join(directory, 'accounts.vault'), 'utf8');
  for (const secret of [token, 'synthetic-cloud-secret', 'synthetic-sdk-secret', 'synthetic-password-42']) assert.ok(!bytes.includes(secret));
  assert.ok(!accounts.state.sessions.some(session => session.hash === token));
  const restored = await Accounts.open(new Vault(directory, { protect }));
  assert.ok(restored.authorize(token)); assert.equal(restored.provider().sessionId, 'synthetic-cloud-secret');
  await restored.logout(token); assert.equal(restored.authorize(token), null);
  assert.equal((await Accounts.open(new Vault(directory, { protect }))).authorize(token), null);
});
test('tampering or losing the key does not reset the existing account store', async t => {
  const { directory, accounts } = await fixture(t);
  await accounts.setup('owner', 'synthetic-password-42');
  const target = path.join(directory, 'accounts.vault');
  const envelope = JSON.parse(await readFile(target, 'utf8'));
  const data = Buffer.from(envelope.data, 'base64'); data[0] ^= 1; envelope.data = data.toString('base64');
  await writeFile(target, JSON.stringify(envelope));
  await assert.rejects(Accounts.open(new Vault(directory, { protect })), /not reset or overwritten/);
  await rm(path.join(directory, 'key.dpapi'));
  await assert.rejects(Accounts.open(new Vault(directory, { protect })), /key is missing/);
});
test('password changes revoke other sessions while preserving the encrypted provider grant', async t => {
  const { accounts } = await fixture(t);
  const first = await accounts.setup('owner', 'synthetic-password-42');
  const second = await accounts.login('owner', 'synthetic-password-42');
  await accounts.saveProvider({ sessionId: 'synthetic-cloud-secret' });
  const replacement = await accounts.changePassword(first, 'synthetic-password-42', 'different-password-42');
  assert.equal(accounts.authorize(first), null); assert.equal(accounts.authorize(second), null);
  assert.ok(accounts.authorize(replacement)); assert.equal(accounts.provider().sessionId, 'synthetic-cloud-secret');
  await assert.rejects(accounts.login('owner', 'synthetic-password-42'), /incorrect/);
});
test('setup races yield one owner and failed disk writes do not commit in-memory changes', async t => {
  const { accounts } = await fixture(t);
  const results = await Promise.allSettled([accounts.setup('first', 'synthetic-password-42'), accounts.setup('second', 'synthetic-password-42')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  accounts.vault.save = async () => { throw new Error('synthetic-disk-failure'); };
  await assert.rejects(accounts.saveProvider({ sessionId: 'not-committed' }));
  assert.equal(accounts.provider(), null);
});
