import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferedRotation, rotationPages } from '../public/rotation.mjs';
function fixture() {
  let clock = 0, timer, prep = [], swaps = [], reports = [];
  const controller = new BufferedRotation({ now: () => clock, schedule: fn => timer = fn, cancel: () => timer = null,
    prepare: async page => { prep.push(page); return page; }, ready: entry => entry.live,
    swap: page => swaps.push(page), report: status => reports.push(status) });
  return { controller, prep, swaps, reports, async advance(ms) { clock += ms; const fn = timer; timer = null; fn?.(); await Promise.resolve(); }, async flush() { await Promise.resolve(); } };
}
test('preloads immediately, holds the old batch past deadline until every picture is ready, then wraps', async () => {
  const f = fixture(), pages = [[{live:true}], [{live:false}]];
  f.controller.start(pages, 0, 15000); await f.flush();
  assert.equal(f.prep[0], pages[1]); assert.equal(f.swaps.length, 0);
  await f.advance(15000); assert.equal(f.swaps.length, 0); assert.equal(f.reports.at(-1).phase, 'waiting');
  pages[1][0].live = true; await f.advance(250);
  assert.equal(f.swaps[0], pages[1]); assert.equal(f.prep[1], pages[0]);
  await f.advance(15000); assert.equal(f.swaps[1], pages[0]); f.controller.stop();
});
test('ready pages stay hidden until the viewing interval expires; stopping cannot swap later', async () => {
  const f = fixture(); f.controller.start([[{live:true}],[{live:true}]],0,1000); await f.flush();
  await f.advance(999); assert.equal(f.swaps.length,0);
  f.controller.stop(); await f.advance(10); assert.equal(f.swaps.length,0);
});
test('late preparation from a cancelled rotation cannot commit', async () => {
  let finish, swaps = 0;
  const c = new BufferedRotation({ prepare: () => new Promise(resolve => finish = resolve), ready: () => true, swap: () => swaps++ });
  c.start([[1],[2]],0,0); c.stop(); finish([2]); await Promise.resolve(); assert.equal(swaps,0);
});
test('pages preserve a short final batch and refuse a redundant single page', () => {
  assert.deepEqual(rotationPages([1,2,3,4,5],4),[[1,2,3,4],[5]]);
  assert.equal(fixture().controller.start([[1]],0,1000),false);
});
