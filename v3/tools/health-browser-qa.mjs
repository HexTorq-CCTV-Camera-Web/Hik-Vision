// Only the explicitly seeded health fixture on loopback 8007 is supported.
import assert from 'node:assert/strict';
import {chromium} from '../.local/browser-qa/node_modules/playwright-core/index.mjs';
import {Client} from './qa-http-helper.mjs';
const root=new Client();assert.equal((await root.login('platform@example.test')).status,200);
const initial=(await root.request('/api/platform/health?state=all')).body;
assert.ok(initial.alerts.some(a=>a.recorder==='Synthetic entrance recorder'));
for(const request of(await root.request('/api/platform/workspaces')).body.workspaces)if(request.status==='pending')await root.request(`/api/platform/requests/${request.id}/approve`,{});
const admin=new Client();await admin.login('alpha@example.test');
let member=(await admin.request('/api/team',{email:'health-member@example.test',fullName:'Health QA Member',password:'synthetic-password-42'})).body;
if(!member.id)member=(await admin.request('/api/team')).body.users.find(u=>u.email==='health-member@example.test');
const viewer=new Client();if((await viewer.login('health-member@example.test','health-member-password-43')).status!==200){await viewer.login('health-member@example.test');await viewer.request('/api/auth/password',{currentPassword:'synthetic-password-42',newPassword:'health-member-password-43'});}
const browser=await chromium.launch({executablePath:process.env.QA_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const errors=[];
async function login(email,password='synthetic-password-42'){
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8007/#/health');await page.locator('#login-email').fill(email);await page.locator('#login-password').fill(password);await page.locator('#login-form button[type=submit]').click();return page;
}
try{
 const platform=await login('platform@example.test');await platform.locator('.health-alert').first().waitFor({state:'visible'});
 assert.equal(await platform.locator('#nav-health').isVisible(),true);assert.equal(await platform.locator('#health-metrics article').count(),5);
 const failed=platform.locator('.health-alert').filter({hasText:'Synthetic entrance recorder'});const acknowledge=failed.getByRole('button',{name:'Acknowledge',exact:true});if(await acknowledge.count())await acknowledge.click();
 await platform.waitForFunction(()=>[...document.querySelectorAll('.health-alert')].some(a=>a.textContent.includes('Synthetic entrance recorder')&&a.textContent.includes('Active / acknowledged')));
 const server=platform.locator('.health-alert').filter({hasText:'Server request failed'});if(await server.count())await server.getByRole('button',{name:'Mark resolved',exact:true}).click();
 await platform.locator('#health-kind-filter').selectOption('storage');await platform.waitForFunction(()=>document.querySelectorAll('.health-alert').length===1&&document.querySelector('.health-alert').textContent.includes('Recording storage is nearly full'));
 await platform.locator('#health-state-filter').selectOption('resolved');await platform.locator('#health-kind-filter').selectOption('server');
 await platform.waitForFunction(()=>[...document.querySelectorAll('.health-alert')].some(a=>a.textContent.includes('Resolved by superadmin')));
 await platform.route('**/api/platform/health?*',route=>route.abort());await platform.locator('#health-refresh').click();
 await platform.waitForFunction(()=>document.getElementById('health-status').textContent==='Monitoring unavailable');assert.ok(await platform.locator('#health-error').isVisible());assert.equal(await platform.locator('#nav-health-count').innerText(),'!');
 await platform.unroute('**/api/platform/health?*');await platform.locator('#health-refresh').click();await platform.waitForFunction(()=>document.getElementById('health-error').hidden);
 assert.ok(await platform.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await platform.locator('#nav-audit').click();await platform.locator('#audit-page').waitFor({state:'visible'});await platform.locator('#nav-health').click();await platform.locator('#health-page').waitFor({state:'visible'});
 for(const[email,password]of[['alpha@example.test','synthetic-password-42'],['health-member@example.test','health-member-password-43']]){
  const page=await login(email,password);await page.waitForURL('**/#/');assert.equal(await page.locator('#nav-health').isVisible(),false);assert.equal(await page.locator('#health-page').isVisible(),false);assert.equal(await page.evaluate(async()=>(await fetch('/api/platform/health')).status),403);
 }
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({superadminOnly:'passed',acknowledge:'passed',serverResolution:'passed',filters:'passed',metrics:'passed',staleDataWarning:'passed',refreshRecovery:'passed',otherRolesDenied:'passed',mobile:'390px no overflow',scriptErrors:0}));
}finally{await browser.close();}
