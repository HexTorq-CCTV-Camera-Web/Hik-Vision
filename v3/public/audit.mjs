import {requestApi} from './api.mjs';
const $=id=>document.getElementById(id),node=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!==undefined)el.textContent=text;return el;};
const actions={
  'admin.requested':['Workspace requested','workspaces'],'workspace.approve':['Workspace approved','workspaces'],'workspace.reject':['Workspace rejected','workspaces'],'workspace.suspend':['Workspace suspended','workspaces'],'workspace.restore':['Workspace restored','workspaces'],
  'member.created':['Member created','users'],'member.updated':['Member updated','users'],'member.permissions_changed':['Camera permissions updated','users'],'member.suspended':['Member suspended','users'],'member.restored':['Member restored','users'],'member.password_reset':['Member password reset','users'],'user.password_reset':['Password reset by superadmin','users'],
  'provider.connected':['Hik-Connect connection saved','accounts'],'provider.disconnected':['Hik-Connect disconnected','accounts'],'provider.recovered':['Camera access recovered','accounts'],'provider.recovery_attention':['Camera recovery needs attention','accounts'],'provider.recovery_disabled':['Automatic recovery disabled','accounts'],
  'recording.delete_requested':['Recording deletion requested','recordings'],'recording.deleted':['Recording deleted','recordings'],'recording.delete_failed':['Recording deletion needs review','recordings'],'recording.cleanup_requested':['Automatic cleanup requested','recordings'],'recording.cleaned':['Recording removed by cleanup','recordings'],'recording.cleanup_failed':['Automatic cleanup needs review','recordings'],'recording.policy_changed':['Recording policy changed','recordings']
};
let cursor=null,revision=0,count=0,searchTimer,loadedQuery='';
function query(){
  const params=new URLSearchParams(),q=$('audit-search').value.trim(),category=$('audit-category').value;
  if(q)params.set('q',q);if(category)params.set('category',category);
  for(const[key,id]of[['from','audit-from'],['to','audit-to']])if($(id).value){const date=new Date($(id).value+'T00:00:00');if(key==='to')date.setDate(date.getDate()+1);params.set(key,date.toISOString());}
  return params;
}
function renderEvent(event){
  const [label,category]=actions[event.action]||['Activity recorded','other'],row=node('article','audit-event'),mark=node('span','audit-marker '+category,label.charAt(0));mark.setAttribute('aria-hidden','true');
  const content=node('div','audit-event-content'),heading=node('div','audit-event-heading'),time=node('time');time.dateTime=event.createdAt;time.textContent=new Date(event.createdAt).toLocaleString();
  heading.append(node('h2','',label),time);content.append(heading);
  const target=event.target.name||[event.details.recorderName,event.details.cameraName].filter(Boolean).join(' / ');
  if(target)content.append(node('p','audit-target',target));
  const who=node('p','audit-who');who.append(node('strong','',event.actor.name),document.createTextNode(' / '+event.workspace));content.append(who);
  const details=node('details','audit-details'),summary=node('summary','','View details'),list=node('ul');
  for(const text of [event.target.email,event.actor.email,...(event.details.changes||[]),event.details.reason?({retention:'Retention period ended','storage-limit':'Storage limit reached'}[event.details.reason]||event.details.reason):null,`Event #${event.id}`].filter(Boolean))list.append(node('li','',text));
  details.append(summary,list);content.append(details);row.append(mark,content);return row;
}
export async function loadAudit({append=false}={}){
  if(!['superadmin','admin'].includes(window.__principal?.role))return;
  clearTimeout(searchTimer);const request=++revision;
  $('audit-notice').hidden=true;$('audit-loading').hidden=false;$('audit-events').setAttribute('aria-busy','true');$('audit-refresh').disabled=true;$('audit-more').disabled=true;
  if(!append){cursor=null;count=0;$('audit-events').replaceChildren();$('audit-empty').hidden=true;$('audit-more').hidden=true;}
  try{
    const params=query(),signature=params.toString();
    if(append&&signature!==loadedQuery){append=false;cursor=null;count=0;$('audit-events').replaceChildren();$('audit-empty').hidden=true;}
    if(!append)loadedQuery=signature;
    if(append&&cursor)params.set('before',cursor);
    const result=await requestApi('/api/audit?'+params);if(request!==revision)return;
    for(const event of result.events)$('audit-events').append(renderEvent(event));
    count+=result.events.length;cursor=result.nextCursor;$('audit-more').hidden=!cursor;$('audit-empty').hidden=count!==0;
    $('audit-count').textContent=`${count} event${count===1?'':'s'}${cursor?' loaded':''}`;
    $('audit-scope').textContent=result.scope==='platform'?'All workspaces / platform administration':'Your workspace / administrator activity';
    $('audit-checked').textContent='Updated '+new Date().toLocaleTimeString();
  }catch(error){if(request===revision){$('audit-notice').textContent=error.message;$('audit-notice').hidden=false;}}
  finally{if(request===revision){$('audit-loading').hidden=true;$('audit-refresh').disabled=false;$('audit-more').disabled=false;$('audit-events').setAttribute('aria-busy','false');}}
}
$('audit-refresh').onclick=()=>void loadAudit();$('audit-more').onclick=()=>void loadAudit({append:true});
for(const id of ['audit-category','audit-from','audit-to'])$(id).onchange=()=>void loadAudit();
$('audit-search').oninput=()=>{clearTimeout(searchTimer);$('audit-count').textContent='Searching...';$('audit-more').disabled=true;searchTimer=setTimeout(()=>void loadAudit(),300);};
$('audit-clear').onclick=()=>{for(const id of ['audit-search','audit-category','audit-from','audit-to'])$(id).value='';void loadAudit();};
