export function captureRecoveryView({accountId,route,grid,selectedId,expanded,tiles,audioWanted}){
  return {accountId,route,grid,selectedId,expanded,audioWanted,
    tiles:tiles.slice(0,16).filter(t=>t.camera).map(t=>({id:t.id,key:t.camera.key,wanted:t.wanted===true||t.state==='authorization',quality:t.quality,qualityMode:t.qualityMode,fit:t.fit,delivery:t.delivery}))};
}
export function canResumeRecovery(plan,{accountId,route,hidden}){return Boolean(plan&&plan.accountId===accountId&&plan.route===route&&route&&!hidden);}
