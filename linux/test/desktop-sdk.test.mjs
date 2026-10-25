import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { desktopTokenFromLog, validateSdkAccess } from '../lib/desktop-sdk.mjs';

test('desktop credential extraction requires the observed SDK operation, India domain and token key', () => {
  const prefix = 'COpenSDKUnited::GetLoginParams';
  const token = 'at.synthetic_credential_123456789';
  assert.equal(desktopTokenFromLog(`${prefix} Key=3 Value=https://iindiaopen.ezvizlife.com\n${prefix} Key=5 Value=${token}`), token);
  assert.equal(desktopTokenFromLog(`${prefix} Key=5 Value=${token}`), null);
  assert.equal(desktopTokenFromLog(`${prefix} Key=3 Value=https://iindiaopen.ezvizlife.com.evil.invalid\n${prefix} Key=5 Value=${token}`), null);
  assert.equal(desktopTokenFromLog(`OtherFunction Key=3 Value=https://iindiaopen.ezvizlife.com\nOtherFunction Key=5 Value=${token}`), null);
});
test('SDK validation is read-only and requires successful device authorization and child exit', async () => {
  let input;
  const fake = (exitCode = 0) => () => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin.on('data', bytes => { input = JSON.parse(bytes.toString()); });
    queueMicrotask(() => { child.stdout.write('{"stage":"device-details","result":0,"responseBytes":120}\n'); child.emit('close', exitCode); });
    return child;
  };
  const result = await validateSdkAccess('synthetic-token', { serial: 'test' }, 3, { runner: fake() });
  assert.ok(result.validatedAt > 0); assert.equal(input.play, false); assert.equal(input.channel, 3);
  assert.ok(!JSON.stringify(result).includes('synthetic-token'));
  await assert.rejects(validateSdkAccess('synthetic-token', { serial: 'test' }, 3, { runner: fake(1) }), /did not authorize/);
});
