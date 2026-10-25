import {loadHealth} from './health.mjs';
import {loadAudit} from './audit.mjs';
import { requestApi } from './api.mjs';
import { loading } from './loading.mjs';
import { loadPlatform } from './platform.mjs';
import { loadTeam } from './team.mjs';
const $=id=>document.getElementById(id);
const action=(route,input)=>requestApi(route,'POST',{body:input});
function feedback(id,message=''){ $(id).textContent=message;$(id).hidden=!message; }
function mode(value){
  for(const name of ['login','signup','root'])$(name+'-form').hidden=name!==value;
  $('signup-pending').hidden=true;$('auth-tabs').hidden=value==='root';feedback('saas-auth-notice');
  $('show-login').classList.toggle('active',value==='login');$('show-signup').classList.toggle('active',value==='signup');
}
$('show-login').onclick=$('pending-login').onclick=()=>mode('login');$('show-signup').onclick=()=>mode('signup');
for(const name of ['login','signup','root'])$(name+'-form').onsubmit=async event=>{
  event.preventDefault();const button=event.target.querySelector('button[type=submit]');button.disabled=true;const finish=loading(name==='signup'?'Submitting workspace request...':'Signing in...');feedback('saas-auth-notice');
  const input={email:$(name+'-email').value.trim(),password:$(name+'-password').value};
  if(name!=='login')input.fullName=$(name+'-name').value.trim();if(name==='signup')input.workspaceName=$('signup-workspace').value.trim();
  try{
    await action('/api/auth/'+({root:'setup',signup:'signup',login:'login'})[name],input);
    if(name==='signup'){$('signup-form').reset();$('signup-form').hidden=true;$('auth-tabs').hidden=true;$('signup-pending').hidden=false;}
    else location.reload();
  }catch(error){feedback('saas-auth-notice',error.message);}
  finally{delete input.password;$(name+'-password').value='';button.disabled=false;finish();}
};
const finishInitial=loading('Opening your workspace...');
try{
  const status=await requestApi('/api/auth/status');
  if(!status.authenticated){$('saas-auth').hidden=false;mode(status.setupRequired?'root':'login');}
  else{
    const user=window.__principal=status.user;document.body.dataset.role=user.role;
    $('nav-account').hidden=false;$('viewer-logout').hidden=false;$('session-name').textContent=user.fullName;$('session-email').textContent=user.email;
    $('session-role').textContent=user.role==='superadmin'?'Platform superadmin':`${user.role==='admin'?'Workspace admin':'Team member'} / ${user.tenantName}`;
    const reload=()=>location.reload();window.addEventListener('viewer-auth-required',reload);
    $('viewer-logout').onclick=async()=>{
      if(document.querySelector('.record-indicator:not([hidden]),.recording-save-state.unsaved')){feedback('password-notice','Stop active recordings and wait until clips are saved before signing out.');return;}
      try{await action('/api/auth/logout',{});reload();}catch(error){feedback('password-notice',error.message);}
    };
    $('password-form').onsubmit=async event=>{event.preventDefault();const button=$('password-submit');button.disabled=true;try{await action('/api/auth/password',{currentPassword:$('current-password').value,newPassword:$('new-password').value});reload();}catch(error){feedback('password-notice',error.message);}finally{$('current-password').value='';$('new-password').value='';button.disabled=false;}};
    $('nav-account').addEventListener('toggle',()=>{if(!$('nav-account').open){$('current-password').value='';$('new-password').value='';}});
    document.addEventListener('click',event=>{if(!$('nav-account').contains(event.target))$('nav-account').open=false;});
    if(user.mustChangePassword){
      $('first-password-page').hidden=false;$('nav-account-status').textContent='Password required';
      $('first-password-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;try{await action('/api/auth/password',{currentPassword:$('first-current').value,newPassword:$('first-new').value});reload();}catch(error){$('first-password-notice').textContent=error.message;}finally{$('first-current').value='';$('first-new').value='';button.disabled=false;}};
    }else if(user.role==='superadmin'){
      $('platform-dashboard').hidden=false;$('nav-account-status').textContent='Superadmin';$('workspace-nav').hidden=false;
      for(const link of $('workspace-nav').children)link.hidden=true;$('nav-team').hidden=false;$('nav-team').textContent='Workspaces';$('nav-team').href='#/platform';$('nav-team').setAttribute('aria-current','page');
      $('nav-audit').hidden=false;$('nav-health').hidden=false;
      const route=async()=>{const audit=location.hash==='#/audit',health=location.hash==='#/health';$('platform-dashboard').hidden=audit||health;$('audit-page').hidden=!audit;$('health-page').hidden=!health;for(const[id,active]of[['nav-team',!audit&&!health],['nav-audit',audit],['nav-health',health]]){if(active)$(id).setAttribute('aria-current','page');else $(id).removeAttribute('aria-current');}document.title=health?'Health / Camera workspace':audit?'Audit log / Camera workspace':'Workspaces / Camera workspace';if(health)await loadHealth();else if(audit)await loadAudit();else await loadPlatform();};
      window.addEventListener('hashchange',()=>void route());await route();if(location.hash!=='#/health')void loadHealth({background:true});
    }else{
      $('workspace').hidden=false;
      window.saasApplyPermissions=()=>{
        const admin=user.role==='admin';$('nav-team').hidden=!admin;$('nav-settings').hidden=!admin;$('nav-audit').hidden=!admin;$('nav-health').hidden=true;
        if(!admin){$('nav-account-status').textContent='Member';$('account-recovery').hidden=true;
          const connection=window.saasConnectionStatus;
          const message=connection?.noAssignments?'No cameras assigned yet. Ask your workspace administrator for access.':connection&&!connection.connected?'Your workspace administrator needs to connect the camera account.':connection&&!connection.sdkConnected?'Camera playback needs attention from your workspace administrator.':'';
          feedback('workspace-access-notice',message);
          if(!$('device-empty').hidden){$('empty-title').textContent='Your assigned cameras will appear here.';$('empty-detail').textContent='Your workspace administrator controls your camera access.';}
        }
      };
      await import('./app.mjs');window.saasApplyPermissions();
      if(location.hash==='#/team'&&user.role==='admin')await loadTeam();
      if(location.hash==='#/audit'&&user.role==='admin')await loadAudit();
      if(location.hash==='#/health'||user.role==='member'&&['#/team','#/settings','#/audit'].includes(location.hash))location.hash='#/';
      window.addEventListener('hashchange',()=>{if(location.hash==='#/health'||user.role==='member'&&['#/team','#/settings','#/audit'].includes(location.hash))location.hash='#/';});
    }
    setInterval(async()=>{if(document.hidden)return;try{const fresh=await requestApi('/api/auth/status');if(!fresh.authenticated||fresh.user.id!==user.id||fresh.user.role!==user.role||fresh.user.mustChangePassword!==user.mustChangePassword)reload();}catch{}},15000);
  }
}catch(error){$('saas-auth').hidden=false;mode('login');feedback('saas-auth-notice','The workspace is unavailable. '+error.message);}
finally{finishInitial();}
