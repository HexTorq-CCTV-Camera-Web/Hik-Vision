import test from 'node:test';
import assert from 'node:assert/strict';
import { signInPersonal, origins, PortalError } from '../lib/personal-client.mjs';
test('password-only login follows one explicit allowed regional redirect and closes each client', async () => {
  const visited=[],closed=[];
  class Client {
    constructor({origin}) { this.origin=origin; visited.push(origin); }
    async login(input) {
      assert.deepEqual(Object.keys(input).sort(),['account','password']);
      if(this.origin===origins[0]) return {state:'region-required',origin:origins[1]};
      this.sessionId='synthetic-session';this.account={accountUserId:'same-owner'};return {state:'signed-in'};
    }
    close() {closed.push(this.origin);this.sessionId=null;}
  }
  const result=await signInPersonal({account:'test',password:'synthetic-password'},{Client});
  assert.deepEqual(visited,origins);assert.deepEqual(closed,origins);assert.equal(result.credentials.origin,origins[1]);assert.equal(result.credentials.sessionId,'synthetic-session');assert.equal(result.credentials.password,undefined);
});
test('a rejected login is never retried or routed to another region', async () => {
  let calls=0,closed=0;
  class Client {async login(){calls++;throw new PortalError('Provider requests verification.');}close(){closed++;}}
  await assert.rejects(signInPersonal({account:'test',password:'synthetic-password'},{Client}),/verification/);
  assert.equal(calls,1);assert.equal(closed,1);
});
test('an untrusted region response cannot receive a password', async () => {
  let calls=0;
  class Client {async login(){calls++;return {state:'region-required',origin:'https://untrusted.invalid'};}close(){}}
  const result=await signInPersonal({account:'test',password:'synthetic-password'},{Client});
  assert.equal(calls,1);assert.equal(result.credentials,undefined);
});
