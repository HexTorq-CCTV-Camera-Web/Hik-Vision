import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { NativeLive } from '../lib/live.mjs';

async function receiver(t, { confirm = true, stopResult = 0, supported = true } = {}) {
  const commands = []; let child, killed = false;
  const send = event => child.stdout.write(JSON.stringify(event) + '\n');
  const runner = () => {
    child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { if (!killed) { killed = true; child.emit('close', 0); } };
    child.stdin.on('finish', () => child.kill());
    child.stdin.on('data', bytes => {
      const input = JSON.parse(bytes.toString());
      if (input.accessToken) queueMicrotask(() => { send({ stage: 'camera-capabilities', supportTalk: supported }); send({ stage: 'frame', jpeg: Buffer.from([255,216,255,217]).toString('base64'), width: 1, height: 1 }); });
      else {
        commands.push(input.command);
        if (input.command === 'talk-start' && confirm) queueMicrotask(() => send({ stage: 'playback-event', event: 16 }));
        if (input.command === 'talk-stop') send({ stage: 'talk-result', action: 'stop', result: stopResult });
      }
    });
    return child;
  };
  const live = new NativeLive({ sdkAccessToken: 'synthetic' }, { id: 'test', name: 'Test', serial: 'TEST' }, 1, 'sd', { runner });
  t.after(() => live.stop()); await live.ready;
  return { live, commands, send, killed: () => killed };
}
test('talk is confirmed asynchronously and release cannot be undone by a late SDK start event', async t => {
  const { live, commands, send } = await receiver(t, { confirm: false });
  const pending = live.startTalk(); const rejected = assert.rejects(pending, /stopped/);
  live.stopTalk(); await rejected;
  send({ stage: 'playback-event', event: 16 });
  assert.equal(live.talkWanted, false); assert.equal(live.talkState, 'stopped'); assert.ok(commands.includes('talk-stop'));
});
test('lost browser heartbeats stop the microphone session automatically', async t => {
  const { live, commands } = await receiver(t);
  await live.startTalk(); assert.equal(live.talkState, 'talking');
  await new Promise(resolve => setTimeout(resolve, 1650));
  assert.ok(commands.includes('talk-stop')); assert.equal(live.talkState, 'stopped');
});
test('a failed microphone stop kills the receiver instead of leaving capture running', async t => {
  const { live, killed } = await receiver(t, { stopResult: 1 });
  await live.startTalk(); live.stopTalk(); assert.equal(killed(), true);
});
test('a camera without reported talk support cannot start microphone capture', async t => {
  const { live, commands } = await receiver(t, { supported: false });
  await assert.rejects(live.startTalk(), /support/); assert.ok(!commands.includes('talk-start'));
});
