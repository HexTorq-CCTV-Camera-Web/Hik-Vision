import test from 'node:test';
import assert from 'node:assert/strict';
import { constants, createHash, generateKeyPairSync, privateDecrypt } from 'node:crypto';
import { PersonalClient, encryptPortalPassword, parsePublicKey } from '../lib/personal-client.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = publicKey.export({ type: 'spki', format: 'pem' });
function reply(body, status = 200) { return { ok: status === 200, status, json: async () => body }; }

test('password envelope contains the observed hash and seconds timestamp, with randomized RSA padding', () => {
  const encrypted = encryptPortalPassword('synthetic-password', publicKey, 1792713600123);
  const encoded = privateDecrypt({ key: privateKey, padding: constants.RSA_NO_PADDING }, Buffer.from(encrypted, 'base64'));
  assert.equal(encoded[0], 0); assert.equal(encoded[1], 2);
  const separator = encoded.indexOf(0, 2);
  assert.ok(separator >= 10);
  const digest = createHash('md5').update('synthetic-password').digest('hex');
  assert.equal(encoded.subarray(separator + 1).toString(), digest + ',1792713600');
  assert.notEqual(encrypted, encryptPortalPassword('synthetic-password', publicKey, 1792713600123));
});

test('accepts the public-key encodings observed by JSEncrypt; rejects malformed keys', () => {
  assert.equal(parsePublicKey(pem).asymmetricKeyDetails.modulusLength, 2048);
  assert.equal(parsePublicKey(publicKey.export({ type: 'spki', format: 'der' }).toString('base64')).asymmetricKeyType, 'rsa');
  assert.throws(() => parsePublicKey('not-a-key'));
});

test('uses encrypted login, keeps the session in memory, and exposes only a device count summary', async () => {
  const calls = [];
  const request = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/publickey')) return reply({ publicKey: pem });
    if (url.endsWith('/login/v6')) return reply({ meta: { code: 200 }, loginSession: { sessionId: 'synthetic-session' } });
    return reply({ meta: { code: 200 }, data: { data: [{ status: 1, subSerial: 'private-serial' }, { status: 2 }] } });
  };
  const client = new PersonalClient({ request });
  const result = await client.login({ account: 'test@example.invalid', password: 'synthetic-password' });
  assert.equal(result.state, 'signed-in');
  assert.ok(!JSON.stringify(result).includes('synthetic-session'));
  const login = calls[1];
  assert.equal(login.options.method, 'POST'); assert.equal(login.options.redirect, 'error');
  assert.ok(!login.options.body.includes('synthetic-password'));
  assert.equal(new URLSearchParams(login.options.body).get('account'), 'test@example.invalid');
  assert.deepEqual(await client.sharedSummary(), { sharedDevices: 2, online: 1, offline: 1 });
  assert.equal(calls[2].options.headers.sessionId, 'synthetic-session');
  client.close();
  await assert.rejects(client.sharedSummary(), /Sign in/);
});

test('does not follow regional redirection or perform an automatic second login', async () => {
  let requests = 0;
  const client = new PersonalClient({ request: async url => {
    requests++;
    return url.endsWith('/publickey') ? reply({ publicKey: pem })
      : reply({ meta: { code: 1100 }, loginArea: { webDomain: 'untrusted.invalid' }, encryptLoginInfo: { password: 'do-not-return' } });
  } });
  const result = await client.login({ account: 'test@example.invalid', password: 'synthetic-password' });
  assert.deepEqual(result, { state: 'region-required', origin: null, code: 1100 });
  assert.equal(requests, 2); assert.equal(client.sessionId, null);
});

test('does not log raw rejection data, retain an old session, or automatically retry login', async () => {
  let requests = 0;
  const client = new PersonalClient({ request: async url => {
    requests++;
    return url.endsWith('/publickey') ? reply({ publicKey: pem })
      : reply({ meta: { code: 1402, message: 'sensitive-response' }, accessToken: 'sensitive-token' });
  } });
  client.sessionId = 'previous-session';
  await assert.rejects(client.login({ account: 'test@example.invalid', password: 'synthetic-password' }), error => {
    assert.equal(error.code, 1402); assert.ok(!error.message.includes('sensitive')); return true;
  });
  assert.equal(requests, 2); assert.equal(client.sessionId, null);
});

test('rejects unobserved origins and clears the session after authorization failure', async () => {
  assert.throws(() => new PersonalClient({ origin: 'https://iindia.hik-connect.com.evil.invalid' }));
  const client = new PersonalClient({ request: async () => reply({}, 401) });
  client.sessionId = 'synthetic-session';
  await assert.rejects(client.sharedSummary(), error => error.status === 401);
  assert.equal(client.sessionId, null);
});
