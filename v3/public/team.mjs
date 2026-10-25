import { requestApi } from './api.mjs';
const $=id=>document.getElementById(id);
const node=(tag,cls,text)=>{const el=document.createElement(tag);el.className=cls||'';if(text!==undefined)el.textContent=text;return el;};
let model={users:[],devices:[]},editing=null;
function notice(text=''){$('team-notice').textContent=text;$('team-notice').hidden=!text;}
function render(){
  $('team-count').textContent=String(model.users.length);$('team-list').replaceChildren();
  if(!model.users.length)$('team-list').append(node('p','saas-empty','No members yet. Add someone to your workspace, then assign their recorders.'));
  for(const user of model.users){const row=node('article','team-member'),identity=node('div','team-member-identity');identity.append(node('strong','',user.fullName),node('small','',user.email),node('span','',`${user.grants.filter(g=>g.view).length} recorders assigned`));
    const badge=node('span','saas-status '+user.status,user.status),actions=node('div','team-member-actions'),edit=node('button','secondary','Permissions'),suspend=node('button','secondary',user.status==='active'?'Suspend':'Restore');edit.type=suspend.type='button';
    edit.onclick=()=>openEditor(user.id);suspend.onclick=async()=>{suspend.disabled=true;try{await requestApi('/api/team/'+user.id,'POST',{body:{status:user.status==='active'?'suspended':'active'}});notice('Member access updated. Existing sessions were signed out.');await loadTeam();}catch(error){notice(error.message);}finally{suspend.disabled=false;}};
    actions.append(edit,suspend);row.append(identity,badge,actions);$('team-list').append(row);
  }
}
function openEditor(id){
  const user=model.users.find(user=>user.id===id);if(!user)return;editing=id;$('team-editor').hidden=false;$('team-editor-name').textContent=user.fullName;$('team-editor-email').textContent=user.email;$('team-grants').replaceChildren();
  if(!model.devices.length)$('team-grants').append(node('p','saas-empty','Connect Hik-Connect and refresh your camera library before assigning recorders.'));
  for(const device of model.devices){const grant=user.grants.find(g=>g.deviceId===device.id),row=node('article','grant-row');row.dataset.deviceId=device.id;row.dataset.channels=JSON.stringify(grant?.channels??null);const name=node('div','grant-name');name.append(node('strong','',device.name),node('small','',grant?.channels?`${grant.channels.length} selected channels`:`${device.channels.length} cameras${device.available?'':' / Not currently available'}`));row.append(name);
    const inputs={};for(const[key,label]of[['view','View'],['download','Download'],['record','Record']]){const field=node('label','grant-checkbox'),input=node('input');input.type='checkbox';input.dataset.permission=key;input.checked=grant?.[key]===true;field.append(input,document.createTextNode(label));row.append(field);inputs[key]=input;}
    const sync=()=>{for(const key of ['download','record']){inputs[key].disabled=!inputs.view.checked;if(!inputs.view.checked)inputs[key].checked=false;}};inputs.view.onchange=sync;sync();$('team-grants').append(row);
  }
  $('team-editor').scrollIntoView({block:'start',behavior:'smooth'});
}
export async function loadTeam(){
  if(globalThis.__principal?.role!=='admin')return;
  $('team-refresh').disabled=true;
  try{model=await requestApi('/api/team');render();if(editing){if(model.users.some(user=>user.id===editing))openEditor(editing);else $('team-editor').hidden=true;}}
  catch(error){notice(error.message);}finally{$('team-refresh').disabled=false;}
}
$('team-refresh').onclick=()=>void loadTeam();$('team-editor-close').onclick=()=>{editing=null;$('team-editor').hidden=true;};
$('team-create-form').onsubmit=async event=>{event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;const password=$('team-password').value;$('team-password').value='';try{const result=await requestApi('/api/team','POST',{body:{fullName:$('team-name').value.trim(),email:$('team-email').value.trim(),password}});event.target.reset();notice('Member created. Assign recorders below. Share the temporary password privately; the member must change it on first sign-in.');await loadTeam();openEditor(result.id);}catch(error){notice(error.message);}finally{button.disabled=false;}};
$('team-save-grants').onclick=async()=>{if(!editing)return;const button=$('team-save-grants');button.disabled=true;try{const grants=[...$('team-grants').querySelectorAll('.grant-row')].map(row=>({deviceId:row.dataset.deviceId,channels:JSON.parse(row.dataset.channels),...Object.fromEntries([...row.querySelectorAll('input')].map(input=>[input.dataset.permission,input.checked]))}));await requestApi('/api/team/'+editing,'POST',{body:{grants}});notice('Permissions saved. This member must sign in again.');await loadTeam();}catch(error){notice(error.message);}finally{button.disabled=false;}};
$('team-reset-form').onsubmit=async event=>{event.preventDefault();if(!editing)return;const button=event.target.querySelector('button');button.disabled=true;try{await requestApi('/api/team/'+editing,'POST',{body:{password:$('team-reset-password').value}});event.target.reset();notice('Temporary password reset. Existing sessions were signed out.');await loadTeam();}catch(error){notice(error.message);}finally{$('team-reset-password').value='';button.disabled=false;}};
