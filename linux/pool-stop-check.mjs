import { Vault } from './lib/vault.mjs';
import { createHikClient } from './lib/hik-connect.mjs';
import { NativeLive } from './lib/live.mjs';
import { closeReceiverPools } from './lib/pool-runner.mjs';
const state = await (await new Vault('/home/mohan/cam/data').open()).load();
const sharing = await createHikClient().sharing(state.provider);
const device = sharing.devices.find(device => device.status === 'online' && device.channels.length > 1);
if (!device) throw new Error('No online recorder.');
const lives = [], frames = [0, 0];
try {
  for (let i = 0; i < 2; i++) {
    const live = new NativeLive(state.provider, device, device.channels[i].number, 'sd', { delivery: 'smooth' });
    lives.push(live); live.watchFrames(() => frames[i]++);
  }
  const results = await Promise.allSettled(lives.map(live => live.ready));
  console.log(JSON.stringify({ recorder: device.name, started: results.map(result => result.status), errors: lives.map(live => live.status().error) }));
  await new Promise(resolve => setTimeout(resolve, 3000));
  const before = [...frames]; lives[0].stop();
  await new Promise(resolve => setTimeout(resolve, 7000));
  console.log(JSON.stringify({ recorder: device.name, before, after: frames,
    unaffectedCameraContinues: frames[1] > before[1], status: lives[1].status().state }));
} finally { for (const live of lives) live.stop(); closeReceiverPools(); }
