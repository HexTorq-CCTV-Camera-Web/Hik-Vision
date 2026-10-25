import test from 'node:test';
import assert from 'node:assert/strict';
import { captureRecoveryView,canResumeRecovery } from '../public/provider-resume.mjs';
import { retryableStreamError } from '../public/view-model.mjs';
test('recovery view preserves manual stops and only resumes the same foreground recorder account',()=>{
  const tile=(id,wanted)=>({id,wanted,camera:{key:'camera-'+id},quality:'sd',qualityMode:'auto',fit:'fill',delivery:'smooth'});
  const plan=captureRecoveryView({accountId:'account-a',route:'recorder-a',grid:4,selectedId:0,expanded:null,audioWanted:true,tiles:[tile(0,true),tile(1,false)]});
  assert.equal(plan.tiles[0].wanted,true);assert.equal(plan.tiles[1].wanted,false);assert.equal(plan.tiles[0].delivery,'smooth');assert.equal(plan.tiles[0].fit,'fill');
  assert.equal(canResumeRecovery(plan,{accountId:'account-a',route:'recorder-a',hidden:false}),true);
  for(const context of [{accountId:'account-b',route:'recorder-a'},{accountId:'account-a',route:'recorder-b'},{accountId:'account-a',route:null},{accountId:'account-a',route:'recorder-a',hidden:true}])assert.equal(canResumeRecovery(plan,context),false);
});
test('initial authorization-blocked cameras retain watch intent; user-stopped cameras do not',()=>{
  const plan=captureRecoveryView({accountId:'a',route:'r',grid:4,tiles:[{id:0,camera:{key:'a'},state:'authorization',wanted:false},{id:1,camera:{key:'b'},state:'stopped',wanted:false}]});
  assert.equal(plan.tiles[0].wanted,true);assert.equal(plan.tiles[1].wanted,false);
  assert.equal(retryableStreamError({code:'authorization-updated'}),true);
  assert.equal(retryableStreamError({code:'playback-auth-required'}),false);
});
