// Disposable fixture only. Uses a separate headless profile, not real Chrome data.
import {chromium} from '../.local/browser-qa/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Client} from './qa-http-helper.mjs';
const root=new Client();assert.equal((await root.login('platform@example.test')).status,200);
for(const request of(await root.request('/api/platform/workspaces')).body.workspaces)if(request.status==='pending')await root.request(`/api/platform/requests/${request.id}/approve`,{});
const alpha=new Client(),beta=new Client();await alpha.login('alpha@example.test');await beta.login('beta@example.test');
for(const[name,client]of[['alpha',alpha],['beta',beta]]){await client.request('/api/connect/personal',{account:name,password:'synthetic-provider-password'});await client.request('/api/devices');}
let target=(await alpha.request('/api/team',{email:'audit-browser-member@example.test',fullName:'Audit QA <script>alert(1)</script>',password:'synthetic-password-42'})).body.id;
if(!target)target=(await alpha.request('/api/team')).body.users.find(u=>u.email==='audit-browser-member@example.test')?.id;
assert.ok(target);
for(let i=0;i<55;i++)await alpha.request('/api/team/'+target,{grants:[{deviceId:'same-device-id',view:true,download:i%2===0,record:false}]});
await beta.request('/api/team',{email:'beta-private@example.test',fullName:'Beta Private Member',password:'synthetic-password-42'});
const bytes=Buffer.concat([Buffer.from([0x1a,0x45,0xdf,0xa3]),Buffer.alloc(28)]),id=randomUUID();
assert.equal((await alpha.request('/api/recordings',bytes,{raw:true,headers:{'Content-Type':'video/webm','X-Recording-Id':id,'X-Recording-Meta':encodeURIComponent(JSON.stringify({deviceId:'same-device-id',channel:1,duration:1000,audio:false}))}})).status,201);
assert.equal((await alpha.request(`/api/recordings/${id}/delete`,{})).status,200);
const member=new Client();if((await member.login('audit-browser-member@example.test','audit-browser-member-password-43')).status!==200){await member.login('audit-browser-member@example.test');await member.request('/api/auth/password',{currentPassword:'synthetic-password-42',newPassword:'audit-browser-member-password-43'});}
const browser=await chromium.launch({executablePath:process.env.QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const errors=[],dialogs=[];
async function login(email,password='synthetic-password-42'){
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());await d.dismiss();});
  await page.goto('http://127.0.0.1:8007/#/audit');await page.locator('#login-email').fill(email);await page.locator('#login-password').fill(password);await page.locator('#login-form button[type=submit]').click();return page;
}
try{
  const platform=await login('platform@example.test');await platform.locator('.audit-event').first().waitFor({state:'visible'});
  await platform.locator('#audit-search').fill('Audit QA');await platform.waitForFunction(()=>document.getElementById('audit-count').textContent==='50 events loaded');
  await platform.locator('#audit-more').click();await platform.waitForFunction(()=>document.querySelectorAll('.audit-event').length>50);
  assert.equal(await platform.locator('#audit-events script').count(),0);
  await platform.locator('.audit-details summary').first().click();assert.ok(await platform.locator('.audit-details[open] li').count());
  await platform.locator('#audit-clear').click();await platform.locator('#audit-category').selectOption('recordings');
  await platform.waitForFunction(()=>document.querySelectorAll('.audit-event').length>=2&&[...document.querySelectorAll('.audit-event h2')].every(h=>h.textContent.startsWith('Recording')));
  assert.match(await platform.locator('#audit-events').innerText(),/Recording deleted/);
  await platform.locator('#audit-from').fill('2030-01-01');await platform.locator('#audit-from').dispatchEvent('change');await platform.locator('#audit-empty').waitFor({state:'visible'});
  assert.ok(await platform.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const admin=await login('alpha@example.test');await admin.locator('.audit-event').first().waitFor({state:'visible'});
  assert.match(await admin.locator('#audit-scope').innerText(),/Your workspace/);
  await admin.locator('#audit-search').fill('Beta');await admin.locator('#audit-empty').waitFor({state:'visible'});assert.equal(await admin.locator('.audit-event').count(),0);
  await admin.locator('#audit-clear').click();await admin.locator('.audit-event').first().waitFor({state:'visible'});
  await admin.locator('#nav-team').click();await admin.locator('#team-page').waitFor({state:'visible'});await admin.locator('#nav-audit').click();await admin.locator('#audit-page').waitFor({state:'visible'});
  assert.ok(await admin.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const ordinary=await login('audit-browser-member@example.test','audit-browser-member-password-43');await ordinary.waitForURL('**/#/');assert.equal(await ordinary.locator('#nav-audit').isVisible(),false);
  assert.equal(await ordinary.evaluate(async()=>(await fetch('/api/audit')).status),403);
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
  console.log(JSON.stringify({platformAudit:'passed',workspaceAudit:'passed',memberDenied:'passed',filters:'passed',pagination:'passed',escapedTargetText:'passed',manualDeletion:'passed',navigation:'passed',mobile:'390px no overflow',scriptErrors:0}));
}finally{await browser.close();}
