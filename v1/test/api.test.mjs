import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestApi } from '../public/api.mjs';

test('network failures explain how to restart the local server', async () => {
  await assert.rejects(requestApi('/api/status', 'GET', { request: async () => { throw new TypeError('Failed to fetch'); } }), /Run npm start in hikvision\/v1/);
});
test('timeouts explain the Chrome approval step separately from an unreachable server', async () => {
  await assert.rejects(requestApi('/api/connect/browser', 'POST', { request: async () => { throw new DOMException('Timeout', 'TimeoutError'); } }), /approval prompt/);
});
test('server errors retain their recovery instructions and expired sessions clear the UI', async () => {
  let cleared = false;
  await assert.rejects(requestApi('/api/devices', 'GET', {
    request: async () => Response.json({ error: 'Sign in again.' }, { status: 401 }), onUnauthorized: () => { cleared = true; }
  }), /Sign in again/);
  assert.equal(cleared, true);
});
test('unexpected server content gives a useful error without exposing its body', async () => {
  await assert.rejects(requestApi('/api/status', 'GET', { request: async () => new Response('<html>private upstream content</html>') }), /unexpected response/);
});
