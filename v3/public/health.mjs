import {requestApi} from './api.mjs';
const $=id=>document.getElementById(id),el=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const bytes=n=>!Number.isFinite(n)?'Unavailable':n>=1024**3?(n/1024**3).toFixed(1)+' GB':(n/1024**2).toFixed(1)+' MB';
const time=value=>value?new Date(value).toLocaleString():'--';
const resolution={recovered:'Recovered','playback-stopped':'Playback stopped','storage-recovered':'Storage recovered','task-recovered':'Task recovered','manually-resolved':'Resolved by superadmin'};
let revision=0;
function metric(label,value,detail){const card=el('article');card.append(el('span','',label),el('strong','',value),el('small','',detail));return card;}
function render(model){
  $('health-status').textContent=!model.persistenceAvailable?'Monitoring data incomplete':model.counts.critical?'Critical issues need attention':model.counts.active?'Alerts need review':'No open alerts';$('health-status').dataset.state=model.counts.critical?'critical':!model.persistenceAvailable||model.counts.active?'warning':'healthy';
  $('nav-health').title=model.persistenceAvailable?'Superadmin health monitoring':'Monitoring data incomplete';$('nav-health').dataset.state=model.persistenceAvailable?'available':'unavailable';
  $('nav-health-count').hidden=model.persistenceAvailable&&model.counts.unacknowledged===0;$('nav-health-count').textContent=model.persistenceAvailable?String(model.counts.unacknowledged):'!';
  $('health-counters').replaceChildren(metric('Open alerts',String(model.counts.active),'Across all workspaces'),metric('Critical',String(model.counts.critical),'Needs prompt attention'),metric('Not acknowledged',String(model.counts.unacknowledged),'Review and acknowledge'));
  const m=model.metrics,mins=Math.floor(m.uptimeSeconds/60),uptime=mins>=1440?Math.floor(mins/1440)+'d '+Math.floor(mins%1440/60)+'h':Math.floor(mins/60)+'h '+mins%60+'m';
  $('health-metrics').replaceChildren(metric('Live streams',String(m.liveStreams),m.failedStreams+' failed receiver slots'),metric('Recording disk free',bytes(m.freeDiskBytes),'Physical free space'),metric('Node memory',bytes(m.nodeRssBytes),'Viewer process / RSS'),metric('Node CPU',Number.isFinite(m.nodeCpuPercent)?m.nodeCpuPercent.toFixed(1)+'%':'Measuring...','Share of available CPU'),metric('Server uptime',uptime,'Current viewer process'));
  $('health-alert-list').replaceChildren();$('health-empty').hidden=model.alerts.length!==0;
  for(const alert of model.alerts){
    const card=el('article','health-alert '+alert.severity+(alert.resolvedAt?' resolved':'')),head=el('div','health-alert-heading'),identity=el('div');
    identity.append(el('span','health-kind',alert.kind),el('h2','',alert.title));
    const state=alert.resolvedAt?resolution[alert.resolution]||'Resolved':alert.acknowledgedAt?'Active / acknowledged':'Active / needs review';head.append(identity,el('span','health-state',state));card.append(head);
    card.append(el('p','health-context',[alert.workspace,alert.recorder,alert.channel?'Camera '+alert.channel:null,alert.details.component].filter(Boolean).join(' / ')));
    const facts=[];if(Number.isFinite(alert.details.usedPercent))facts.push(alert.details.usedPercent.toFixed(1)+'% of recording policy storage used');if(Number.isFinite(alert.details.freeBytes))facts.push(bytes(alert.details.freeBytes)+' free');if(alert.details.httpStatus)facts.push('HTTP '+alert.details.httpStatus);if(facts.length)card.append(el('p','health-facts',facts.join(' / ')));
    card.append(el('p','health-dates',`First seen ${time(alert.firstSeen)} / Last seen ${time(alert.lastSeen)} / ${alert.observations} observation${alert.observations===1?'':'s'}`));
    if(alert.acknowledgedAt)card.append(el('p','health-dates',`Acknowledged by ${alert.acknowledgedBy||'Superadmin'} / ${time(alert.acknowledgedAt)}`));
    if(alert.resolvedAt)card.append(el('p','health-dates',`Cleared ${time(alert.resolvedAt)}`));
    const actions=el('div','health-alert-actions');
    const button=(text,action)=>{const b=el('button','secondary',text);b.type='button';b.dataset.healthAction=action;b.onclick=async()=>{b.disabled=true;try{await requestApi(`/api/platform/health/${alert.id}/${action}`,'POST',{body:{}});await loadHealth();}catch(error){$('health-error').textContent=error.message;$('health-error').hidden=false;}finally{b.disabled=false;}};actions.append(b);};
    if(!alert.resolvedAt&&!alert.acknowledgedAt)button('Acknowledge','acknowledge');
    if(!alert.resolvedAt&&alert.kind==='server')button('Mark resolved','resolve');
    if(actions.children.length)card.append(actions);$('health-alert-list').append(card);
  }
  $('health-list-count').textContent=`${model.alerts.length} matching alert${model.alerts.length===1?'':'s'} / latest 100 by priority`;
  $('health-storage-list').replaceChildren();
  for(const store of model.storage){const row=el('article','health-storage-row');row.append(el('strong','',store.workspace),el('span','',bytes(store.usedBytes)+' / '+bytes(store.maxBytes)+' policy limit'),el('small','',store.usedPercent.toFixed(1)+'% used'));$('health-storage-list').append(row);}
  if(!model.storage.length)$('health-storage-list').append(el('p','saas-hint','No workspace recording stores have been created yet.'));
  $('health-persistence').hidden=model.persistenceAvailable;$('health-updated').textContent='Last successful check '+time(model.checkedAt);$('health-sampled').textContent='Storage sampled '+time(model.sampledAt);
}
export async function loadHealth({background=false,refresh=false}={}){
  if(window.__principal?.role!=='superadmin')return;
  const current=++revision;if(!background)$('health-loading').hidden=false;$('health-refresh').disabled=true;
  try{
    const params=new URLSearchParams({state:$('health-state-filter').value,kind:$('health-kind-filter').value});
    if(refresh)params.set('fresh','1');
    const model=await requestApi('/api/platform/health?'+params);if(current!==revision)return;
    render(model);$('health-error').hidden=true;$('health-content').classList.remove('stale');
  }catch(error){if(current===revision){$('nav-health').dataset.state='unavailable';$('nav-health').title='Monitoring unavailable';$('nav-health-count').hidden=false;$('nav-health-count').textContent='!';$('health-status').textContent='Monitoring unavailable';$('health-status').dataset.state='critical';$('health-error').textContent='Health data could not be refreshed. Displayed readings may be out of date. '+error.message;$('health-error').hidden=false;$('health-content').classList.add('stale');for(const b of document.querySelectorAll('[data-health-action]'))b.disabled=true;}}
  finally{if(current===revision){$('health-refresh').disabled=false;$('health-loading').hidden=true;}}
}
$('health-refresh').onclick=()=>void loadHealth({refresh:true});for(const id of ['health-state-filter','health-kind-filter'])$(id).onchange=()=>void loadHealth();
setInterval(()=>{if(!document.hidden&&window.__principal?.role==='superadmin')void loadHealth({background:true});},30000);
