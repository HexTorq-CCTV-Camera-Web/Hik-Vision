// Optional synthetic browser acceptance. Requires the explicit browser fixture
// and playwright-core installed below .local/browser-qa, never real user data.
import {chromium} from '../.local/browser-qa/node_modules/playwright-core/index.mjs';
import assert from 'node:assert/strict';
import {Client} from './qa-http-helper.mjs';
const root=new Client();assert.equal((await root.login('platform@example.test')).status,200);
const request=(await root.request('/api/platform/workspaces')).body.workspaces.find(w=>w.email==='alpha@example.test');
if(request.status==='pending')await root.request(`/api/platform/requests/${request.id}/approve`,{});
const admin=new Client();await admin.login('alpha@example.test');await admin.request('/api/provider/recovery/disable',{});
const browser=await chromium.launch({executablePath:process.env.QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
let stage='start',page;const errors=[];
try{
  page=await browser.newPage({viewport:{width:1280,height:900}});let fault=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/status',async route=>{
    const response=await route.fetch(),body=await response.json();
    if(fault)Object.assign(body,{connected:false,sdkConnected:false,needsReconnect:true,authorizationState:'reconnect-required',recovery:{webEnabled:true,playbackEnabled:false,running:true,web:{},playback:{}}});
    await route.fulfill({response,json:body});
  });
  await page.goto('http://127.0.0.1:8007/');
  await page.locator('#login-email').fill('alpha@example.test');await page.locator('#login-password').fill('synthetic-password-42');await page.locator('#login-form button[type=submit]').click();
  await page.locator('#workspace').waitFor({state:'visible'});await page.waitForFunction(()=>!document.getElementById('connect').disabled);
  stage='connect';await page.evaluate(()=>document.getElementById('connect').click());await page.locator('#provider-dialog').waitFor({state:'visible'});
  assert.equal(await page.locator('#provider-auto-reconnect').isChecked(),false);
  await page.locator('#provider-account').fill('alpha');await page.locator('#provider-password').fill('synthetic-provider-password');await page.locator('#provider-auto-reconnect').check();await page.locator('#provider-submit').click();
  await page.getByRole('button',{name:'Open all 2 cameras on ALPHA recorder, online'}).click();
  stage='initial feeds';await page.locator('.camera-tile:visible select[aria-label=Playback]').first().waitFor({state:'visible'});
  await page.waitForFunction(()=>document.getElementById('group-status').textContent.includes('2 live'));
  for(const selector of await page.locator('.camera-tile:visible select[aria-label=Playback]').all())await selector.selectOption('mjpeg');
  await page.waitForFunction(()=>[...document.querySelectorAll('.camera-tile:not([hidden]) img')].filter(x=>x.naturalWidth===640).length>=2);
  await page.locator('.camera-tile:visible button[aria-label="Stop camera"]').nth(1).click();
  await page.waitForFunction(()=>document.getElementById('group-status').textContent.includes('1 live'));
  const before=await page.evaluate(async()=>await(await fetch('/api/status')).json());assert.equal(before.automaticReconnect,true);
  stage='expire';fault=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>!document.getElementById('account-recovery').hidden);
  stage='recover';fault=false;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.getElementById('account-recovery').hidden);
  await page.waitForFunction(()=>document.getElementById('group-status').textContent.includes('1 live'));
  const states=await page.evaluate(async()=>await(await fetch('/api/live/status?all=1')).json());assert.equal(states.filter(x=>x.state==='playing').length,1);
  stage='forget';await page.waitForFunction(()=>!document.getElementById('connect').disabled);await page.evaluate(()=>document.getElementById('connect').click());
  await page.locator('#provider-forget-recovery').click();await page.waitForFunction(()=>document.getElementById('provider-notice').textContent.includes('saved sign-in password has been removed'));
  const after=await page.evaluate(async()=>await(await fetch('/api/status')).json());assert.equal(after.automaticReconnect,false);assert.equal(after.connected,true);assert.equal(after.connectionId,before.connectionId);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log(JSON.stringify({optIn:'passed',recoveryBanner:'passed',sameAccountViewResume:'passed',manualStopPreserved:'passed',forgetSecret:'passed',currentGrantKept:'passed',mobile:'390px no overflow',scriptErrors:0}));
}catch(error){console.log(JSON.stringify({failedStage:stage,scriptErrors:errors}));throw error;}
finally{await browser.close();}
