// Explicit test-only service. Real PostgreSQL, synthetic users/cameras; no SDK login.
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { postgresFixture } from '../test/helpers.mjs';
import { Cameras } from '../lib/cameras.mjs';
import { TenantStorage } from '../lib/storage.mjs';
import { MediaHub } from '../lib/media.mjs';
import { createSaas } from '../server.mjs';
import { NativeLive } from '../vendor/windows-sdk/lib/live.mjs';
import { PortalError } from '../vendor/windows-sdk/lib/personal-client.mjs';
if(process.env.HIK_SAAS_TEST_FIXTURE!=='1')throw new Error('Set HIK_SAAS_TEST_FIXTURE=1 for this isolated synthetic fixture.');
const cleanup=[],fixture=await postgresFixture({after:fn=>cleanup.push(fn)}),{db,auth,workspaces,cipher}=fixture;
const directory=await mkdtemp(path.join(tmpdir(),'saas-browser-fixture-'));
const password='synthetic-password-42';
const platform=await auth.bootstrap({email:'platform@example.test',fullName:'Test platform owner',password});
for(const name of ['alpha','beta'])await auth.signup({email:name+'@example.test',fullName:'Test '+name+' admin',workspaceName:name.toUpperCase()+' workspace',password});
const frames=JSON.parse((await promisify(execFile)('python',[fileURLToPath(new URL('../vendor/windows-sdk/tools/test-frames.py',import.meta.url))])).stdout);
function runner(){
  const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();let timer,input='',count=0,closed=false;
  const emit=value=>{if(!closed)child.stdout.write(JSON.stringify(value)+'\n');};
  const stop=()=>{if(closed)return;closed=true;clearInterval(timer);child.emit('close',0);};child.kill=stop;child.stdin.on('finish',stop);
  child.stdin.on('data',bytes=>{input+=bytes;const lines=input.split('\n');input=lines.pop();for(const line of lines){const value=JSON.parse(line);if(value.accessToken){emit({stage:'audio-stream',available:true});const tick=()=>{if(!count)emit({stage:'preview',jpeg:frames[0],width:640,height:360});emit({stage:'frame',jpeg:frames[count++%2],width:640,height:360,codec:'h264'});emit({stage:'audio',sampleRate:16000,samples:1600,pcm:Buffer.alloc(3200).toString('base64')});};tick();timer=setInterval(tick,125);}if(value.command==='preview')emit({stage:'preview',jpeg:frames[0],width:640,height:360});}});return child;
}
const cameras=new Cameras(db,cipher,{personal:async input=>{if(!['alpha','beta'].includes(input.account)||input.password!=='synthetic-provider-password')throw new PortalError('Synthetic sign-in rejected.');return{credentials:{sessionId:'synthetic-web-'+input.account,accountUserId:input.account,origin:'https://iindia.hik-connect.com',sdkAccessToken:'synthetic-sdk-'+input.account,sdkExpiresAt:Date.now()+3600000,user:{email:input.account+'@hik.example.test'}}};},hik:{devices:async()=>[],sharing:async provider=>({devices:[{id:'same-device-id',serial:'synthetic',name:provider.accountUserId.toUpperCase()+' recorder',status:'online',source:'shared',channels:[{number:1,name:'Gate'},{number:2,name:'Office'}]}]})}});
const storage=await new TenantStorage(directory,db).open(),hub=new MediaHub(auth,cameras,{createLive:(credentials,device,channel,quality,options)=>new NativeLive(credentials,device,channel,quality,{...options,runner})});
const {server,health}=createSaas({db,auth,workspaces,cipher,cameras,storage,hub,rateLimit:100});
if(process.env.HIK_SAAS_HEALTH_FIXTURE==='1'){
  const tenants=(await workspaces.platform(platform.token)).workspaces,alpha=tenants.find(w=>w.email==='alpha@example.test'),beta=tenants.find(w=>w.email==='beta@example.test');
  await health.report('fixture:failed-stream',{tenantId:alpha.tenantId,code:'stream-timeout',recorderName:'Synthetic entrance recorder',channel:1});
  await health.report('fixture:server-error',{code:'server-request-failed',details:{httpStatus:500,component:'Recording management'}});
  await health.report('fixture:storage-warning',{tenantId:beta.tenantId,code:'storage-usage',details:{usedBytes:950*1024**2,maxBytes:1024**3,usedPercent:92.8}});
  await health.report('fixture:resolved-stream',{tenantId:alpha.tenantId,code:'stream-interrupted',recorderName:'Synthetic recovered recorder',channel:2});
  await health.resolve('fixture:resolved-stream');
}
server.listen(8007,'127.0.0.1',()=>console.log('Synthetic SaaS browser fixture: http://127.0.0.1:8007/'));
let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{if(stopping)return;stopping=true;server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});for(const fn of cleanup)await fn();});
