/* Sezione SCADENZE: stesso atto e stessi task di fascicolo e Planner desktop. */
function effectiveScadenzeRows(){
  const data=snapshot?.scadenze;
  if(!data||data.schema!=='STUDIO_COSTA_SCADENZE'||data.schema_version!==1)return [];
  const pending=new Set(pendingMobileActions.filter(a=>a.action_type==='complete_task').map(a=>String(a.task_id||a.target_id)));
  return (data.deadline_rows||[]).filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(r.due_date||'')&&r.status==='DA_FARE'&&!pending.has(String(r.task_id))).sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.legal_due.localeCompare(b.legal_due)||String(a.client).localeCompare(String(b.client),'it'));
}
function filteredScadenzeRows(){
  let list=effectiveScadenzeRows();
  const all=$('scadenzeAllDates')?.checked!==false,start=$('scadenzeFrom')?.value||'',end=$('scadenzeTo')?.value||'';
  return all?list:list.filter(r=>(!start||r.due_date>=start)&&(!end||r.due_date<=end));
}
function renderScadenze(){
  const root=$('scadenzeContent');if(!root)return;
  const list=filteredScadenzeRows();
  companionDateDisplay('scadenzeFrom');companionDateDisplay('scadenzeTo');
  $('scadenzeCount').textContent=list.length+' PASSAGGI APERTI';
  const days=[...new Set(list.map(r=>r.due_date))];
  root.innerHTML=days.map(d=>`<section class="scadenze-day"><h3>${escapeHtml(fmtWeekday(d))} · ${escapeHtml(fmtDate(d))}</h3>${list.filter(r=>r.due_date===d).map(r=>{
    const kind=['TERMINE','PREPARAZIONE','PRUDENZIALE'].includes(r.kind)?r.kind:'PREPARAZIONE';
    return `<article class="scadenza-card scadenza-${kind.toLowerCase()}"><span class="scadenza-kind">${escapeHtml(kind==='TERMINE'?'SCADE · NOTIFICARE / DEPOSITARE':kind==='PRUDENZIALE'?'DATA INTERNA · NOTIFICARE / DEPOSITARE':'PREPARAZIONE')}</span><h3>${escapeHtml(r.title)}</h3><p><strong>${escapeHtml(r.client)}</strong>${r.rg?' · '+escapeHtml(r.rg):''}</p><p>TERMINE EFFETTIVO: <strong>${escapeHtml(fmtDate(r.legal_due))}</strong></p><div class="scadenza-actions">${r.practice_id?`<button data-practice="${escapeHtml(r.practice_id)}">APRI FASCICOLO</button>`:''}${kind!=='TERMINE'&&r.task_id?`<button data-scadenza-done="${escapeHtml(r.task_id)}">PASSAGGIO FATTO</button>`:'<small>REGISTRARE IL DEPOSITO EFFETTIVO NEL GESTIONALE</small>'}</div></article>`;
  }).join('')}</section>`).join('')||`<div class="empty">${snapshot?.scadenze?'NESSUNA SCADENZA APERTA NEL PERIODO':'IMPORTARE UN NUOVO .scmobile ESPORTATO DAL GESTIONALE 20.18 PER VISUALIZZARE LE SCADENZE'}</div>`;
  bindPracticeLinks(root);
  root.querySelectorAll('[data-scadenza-done]').forEach(button=>button.onclick=async()=>{
    const id=button.dataset.scadenzaDone;
    const task=(snapshot?.tasks||[]).find(t=>String(t.source_id??t.id)===id)||(snapshot?.events||[]).find(t=>t.source_type==='TASK'&&String(t.source_id)===id);
    if(!task){alert('AGGIORNARE IL FILE DEL GESTIONALE: ATTIVITÀ NON DISPONIBILE');return;}
    await queueMobileAction({action_type:'complete_task',task_id:id,target_id:id,new_status:'COMPLETATA',base_updated_at:task.updated_at||''});renderAll();renderScadenze();
  });
}
function exportScadenzeCsv(){
  const safe=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"';
  const rows=filteredScadenzeRows().map(r=>[fmtDate(r.due_date),r.client,r.rg,r.title,r.kind,fmtDate(r.legal_due)]);
  const csv='\ufeff'+[['DATA','NOMINATIVO','RG','ATTO / PASSAGGIO','TIPO','TERMINE EFFETTIVO'],...rows].map(r=>r.map(safe).join(';')).join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='SCADENZE.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
