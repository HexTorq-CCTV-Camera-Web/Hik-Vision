import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { PreviewCache } from '../lib/previews.mjs';
import { PreviewLoader } from '../public/preview-loader.mjs';
import { NativeLive } from '../lib/live.mjs';

test('snapshots are deduplicated across tabs and expire five minutes after capture', async () => {
  let now = 100, calls = 0; const cache = new PreviewCache({now: () => now});
  const capture = async () => ({capturedAt:now,jpeg:String(++calls)});
  const [a,b] = await Promise.all([cache.get('camera',capture),cache.get('camera',capture)]);
  assert.equal(a,b); assert.equal(calls,1);
  now += 299999; await cache.get('camera',capture); assert.equal(calls,1);
  now++; await cache.get('camera',capture); assert.equal(calls,2);
});
test('only one snapshot connects at a time and invalidating an account cancels queued capture', async () => {
  const cache = new PreviewCache(); let release, second=0;
  const first = cache.get('one', () => new Promise(resolve => release=resolve));
  const next = cache.get('two', async () => {second++;return {capturedAt:Date.now()};});
  await Promise.resolve(); await Promise.resolve(); assert.equal(second,0);
  const rejectedFirst = assert.rejects(first), rejectedNext = assert.rejects(next);
  cache.clear(); release({capturedAt:Date.now()}); await Promise.all([rejectedFirst,rejectedNext]); assert.equal(second,0); assert.equal(cache.values.size,0);
  await cache.get('two',async()=>({capturedAt:Date.now()})); assert.equal(cache.values.size,1);
});
test('automatic browser preview loading needs no selected tile and throttles each online camera', async () => {
  let now=100, calls=0, applied=0; const camera={key:'one',device:{status:'online'}};
  const loader = new PreviewLoader({now:()=>now,load:async()=>{calls++;return {capturedAt:now};},apply:()=>applied++});
  loader.sync([camera,{key:'offline',device:{status:'offline'}}]); await Promise.resolve(); await Promise.resolve();
  assert.equal(calls,1); assert.equal(applied,1);
  now+=299999; await loader.pump(); assert.equal(calls,1);
  now++; await loader.pump(); assert.equal(calls,2); loader.clear();
});
test('native snapshot returns only a valid image, reuses it, and cancels waits when stopped', async () => {
  const child=new EventEmitter(); child.stdout=new PassThrough(); child.stderr=new PassThrough(); child.stdin=new PassThrough(); child.kill=()=>child.emit('close');child.stdin.on('finish',()=>child.emit('close'));
  const live=new NativeLive({sessionId:'synthetic'},{id:'one',serial:'TEST'},1,'sd',{runner:()=>child,previewOnly:true});
  const emit=value=>child.stdout.write(JSON.stringify(value)+'\n');
  const pending=live.preview(); emit({stage:'preview',jpeg:'invalid',width:320,height:180}); assert.equal(live.lastPreview,undefined);
  emit({stage:'preview',jpeg:'/9j/2Q==',width:320,height:180}); const image=await pending;
  assert.equal(image.width,320); assert.equal(await live.preview(),image);assert.equal(live.listenerCount('preview'),0);
  const wait=live.preview({maxAge:0}); const rejection=assert.rejects(wait,/ended/); live.stop(); await rejection; assert.equal(live.listenerCount('preview'),0);
});
