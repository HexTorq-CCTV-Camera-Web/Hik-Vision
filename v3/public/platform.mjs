import { requestApi } from './api.mjs';
const $=id=>document.getElementById(id);
const node=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls||'';if(text!==undefined)el.textContent=text;return el;};
let workspaces=[],selectedWorkspace=null,selectedUser=null,usersRequest=0;
function userNotice(message=''){$('platform-users-notice').textContent=message;$('platform-users-notice').hidden=!message;}
function clearReset(){selectedUser=null;$('platform-reset-form').reset();$('platform-reset-form').hidden=true;}
async function showUsers(item){
  const request=++usersRequest;selectedWorkspace=item;clearReset();userNotice();
  $('platform-users-panel').hidden=false;$('platform-users-title').textContent=item.workspaceName+' / Users';
  $('platform-users-list').replaceChildren();$('platform-users-loading').hidden=false;
  $('platform-users-panel').scrollIntoView({block:'start',behavior:'smooth'});
  try{
    const result=await requestApi(`/api/platform/workspaces/${item.tenantId}/users`);if(request!==usersRequest)return;
    for(const user of result.users){
      const row=node('article','team-member'),identity=node('div','team-member-identity');
      identity.append(node('strong','',user.fullName),node('small','',user.email),node('span','',`${user.role==='admin'?'Workspace admin':'Member'} / ${user.status}${user.mustChangePassword?' / Password change required':''}`));
      const reset=node('button','secondary','Reset password');reset.type='button';reset.setAttribute('aria-label',`Reset password for ${user.email}`);
      reset.onclick=()=>{clearReset();userNotice();selectedUser=user;$('platform-reset-name').textContent='Reset password / '+user.fullName;$('platform-reset-email').textContent=user.email;$('platform-reset-form').hidden=false;$('platform-reset-password').focus();};
      row.append(identity,reset);$('platform-users-list').append(row);
    }
  }catch(error){if(request===usersRequest)userNotice(error.message);}
  finally{if(request===usersRequest)$('platform-users-loading').hidden=true;}
}
function render(){
  const selected=$('platform-filter').value,list=workspaces.filter(item=>!selected||item.status===selected);$('platform-list').replaceChildren();$('platform-count').textContent=`${list.length} workspace${list.length===1?'':'s'}`;
  $('platform-stats').replaceChildren();for(const[label,status]of[['Awaiting approval','pending'],['Active','active'],['Suspended','suspended']]){const card=node('article');card.append(node('span','',label),node('strong','',String(workspaces.filter(w=>w.status===status).length)));$('platform-stats').append(card);}
  if(!list.length){const empty=node('div','saas-empty');empty.append(node('h2','','No requests in this view.'),node('p','','New workspace requests appear here when administrators sign up.'));$('platform-list').append(empty);}
  for(const item of list){
    const card=node('article','workspace-request'),identity=node('div','request-identity');identity.append(node('strong','',item.workspaceName),node('span','',item.fullName),node('a','',item.email),node('small','',new Date(item.createdAt).toLocaleString()));
    const status=node('span','saas-status '+item.status,item.status==='pending'?'Awaiting approval':item.status),actions=node('div','request-actions');
    const choices=item.status==='pending'?[['approve','Approve workspace'],['reject','Reject']]:item.status==='active'?[['suspend','Suspend workspace']]:item.status==='suspended'?[['restore','Restore workspace']]:[];
    for(const[action,label]of choices){const button=node('button',action==='approve'||action==='restore'?'saas-primary':'secondary',label);button.type='button';button.onclick=async()=>{for(const b of actions.querySelectorAll('button'))b.disabled=true;try{await requestApi(`/api/platform/requests/${item.id}/${action}`,'POST',{body:{}});await loadPlatform();}catch(error){$('platform-notice').textContent=error.message;$('platform-notice').hidden=false;}finally{for(const b of actions.querySelectorAll('button'))b.disabled=false;}};actions.append(button);}
    const users=node('button','secondary','Manage users');users.type='button';users.onclick=()=>void showUsers(item);actions.append(users);
    card.append(identity,status,actions);$('platform-list').append(card);
  }
}
export async function loadPlatform(){
  $('platform-refresh').disabled=true;$('platform-notice').hidden=true;
  try{workspaces=(await requestApi('/api/platform/workspaces')).workspaces;render();}
  catch(error){$('platform-notice').textContent=error.message;$('platform-notice').hidden=false;}
  finally{$('platform-refresh').disabled=false;}
}
$('platform-refresh').onclick=()=>void loadPlatform();$('platform-filter').onchange=render;
$('platform-users-close').onclick=()=>{usersRequest++;selectedWorkspace=null;clearReset();userNotice();$('platform-users-panel').hidden=true;};
$('platform-reset-cancel').onclick=()=>{clearReset();userNotice();};
$('platform-reset-form').onsubmit=async event=>{
  event.preventDefault();if(!selectedUser||!selectedWorkspace)return;userNotice();
  if($('platform-reset-password').value!==$('platform-reset-confirm').value){userNotice('The temporary passwords do not match.');return;}
  const user=selectedUser,workspace=selectedWorkspace,request=usersRequest,button=$('platform-reset-submit');button.disabled=true;
  try{
    await requestApi(`/api/platform/users/${user.id}/password`,'POST',{body:{password:$('platform-reset-password').value}});
    if(request!==usersRequest)return;
    await showUsers(workspace);
    if(selectedWorkspace?.tenantId===workspace.tenantId)userNotice(`Temporary password set for ${user.email}. Their sessions are signed out. Share it directly; they must choose a new password at next login. Approval and suspension status were preserved.`);
  }catch(error){if(request===usersRequest)userNotice(error.message);}
  finally{$('platform-reset-password').value='';$('platform-reset-confirm').value='';button.disabled=false;}
};
