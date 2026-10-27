function mobilePlannerMinutes(s){const m=/^(\d{1,2}):(\d{2})$/.exec(String(s||''));if(!m)return null;const h=Number(m[1]),min=Number(m[2]);return h===24&&min===0?1440:(h<24&&min<60?h*60+min:null);}
function mobilePlannerTime(m){return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');}
function mobilePlannerDayNumber(day){return (new Date(day+'T12:00:00').getDay()+6)%7;}
function mobilePlannerMerge(rows){
  const result=[];for(const r of rows.sort((a,b)=>a[0]-b[0])){if(result.length&&r[0]<=result[result.length-1][1])result[result.length-1][1]=Math.max(result[result.length-1][1],r[1]);else result.push(r.slice())}return result;
}
function plannerTargetMap(){
  const mapping=new Map((snapshot?.plannerTaskTargets||[]).map(t=>[String(t.task_id),{...t}]));
  for(const action of pendingMobileActions.filter(a=>a.action_type==='planner_target_time')){
    const id=String(action.task_id||action.target_id);
    mapping.set(id,{...(mapping.get(id)||{task_id:id}),plan_date:action.plan_date||null,target_time:action.target_time||null});
  }
  return mapping;
}
function plannerTasksForDay(day,all){
  const targets=plannerTargetMap();
  const entries=all.filter(e=>e.source_type==='TASK'&&e.event_date===day).map(e=>({
    id:String(e.source_id),title:e.title||'Attività',deadline:Boolean(e.legal_deadline)||/SCADEN/.test(String(e.category||'').toUpperCase()),
    date:day,target_time:targets.get(String(e.source_id))?.target_time||e.start_time||'',
    original_date:e.event_date,base_updated_at:e.updated_at||'',category:e.category||''
  }));
  const found=new Set(entries.map(e=>e.id));
  for(const t of (snapshot?.plannerTaskTargets||[])){
    const id=String(t.task_id),target=targets.get(id)||t;
    const effectiveDay=t.due_date||t.start_date||target.plan_date||'';
    if(effectiveDay!==day||found.has(id))continue;
    const normal=String(t.status||'').toUpperCase();
    if(['COMPLETATA','COMPLETATO','DEPOSITATA','DEPOSITATO','ANNULLATA','ANNULLATO'].includes(normal))continue;
    entries.push({id,title:t.title||'Attività',deadline:!!t.legal_deadline||/SCADEN/.test(String(t.category||'').toUpperCase()),date:day,
      target_time:target.target_time||'',original_date:t.due_date||t.start_date||'',base_updated_at:t.updated_at||'',category:t.category||''});found.add(id);
  }
  for(const u of (snapshot?.plannerUndatedTasks||[])){
    const id=String(u.task_id),target=targets.get(id)||u;
    if((target.plan_date||'')!==day||found.has(id))continue;
    entries.push({id,title:u.title||'Attività',deadline:!!u.legal_deadline||/SCADEN/.test(String(u.category||'').toUpperCase()),
      date:day,target_time:target.target_time||'',original_date:'',base_updated_at:u.updated_at||'',category:u.category||''});found.add(id);
  }
  return entries;
}
function effectivePlannerBlocks(){
  const result=new Map((snapshot?.plannerBlocks||[]).map((b,i)=>[String(b.id??('legacy-'+i)),{...b,id:b.id??('legacy-'+i)}]));
  for(const action of pendingMobileActions){
    if(action.action_type==='planner_block_save')result.set(String(action.block_id||action.mobile_id),{...action,id:action.block_id||action.mobile_id});
    if(action.action_type==='planner_block_delete')result.delete(String(action.block_id||action.mobile_id));
  }
  return [...result.values()];
}
function workloadLabel(taskId,title){
  const t=(snapshot?.plannerTaskTargets||[]).find(x=>String(x.task_id)===String(taskId));
  const local=pendingMobileActions.filter(a=>a.action_type==='planner_workload'&&String(a.task_id)===String(taskId)).at(-1);
  let estimate=Number(local?.estimated_minutes||t?.estimated_minutes||0),chunk=Number(local?.chunk_minutes||t?.chunk_minutes||0);
  if(!estimate){const name=String(title||'').toLowerCase();estimate=name.includes('appello')?360:name.includes('costituzione')?240:name.includes('lettera')?15:name.includes('studio')?60:60;chunk=Math.min(120,estimate);}
  return `${estimate} min stimati${estimate>chunk?' · blocchi da '+chunk+' min':''}`;
}
function openPlannerBlockEditor(blockId=''){
  if(String(blockId).startsWith('legacy-')){alert('Per modificare questa voce, esporta un nuovo .scmobile dal desktop V15.6 e importalo nella Companion.');return;}
  const existing=effectivePlannerBlocks().find(b=>String(b.id)===String(blockId));
  const overlay=document.createElement('div');overlay.className='planner-target-overlay';overlay.id='plannerBlockOverlay';
  const times=Array.from({length:97},(_,i)=>mobilePlannerTime(i*15));
  const select=(id,val)=>`<select id="${id}">${times.map(t=>`<option value="${t}" ${t===(val||'')?'selected':''}>${t}</option>`).join('')}</select>`;
  overlay.innerHTML=`<div class="planner-target-sheet"><div class="planner-target-kicker">FAMIGLIA E TEMPO PERSONALE</div><h3>${existing?'Modifica impegno':'Nuovo impegno'}</h3>
  <label>Descrizione dell'impegno</label><input id="pbTitle" type="text" maxlength="80" placeholder="Es. prendere mio figlio a scuola" value="${escapeHtml(existing?.label||'')}">
  <label>Ripetizione</label><select id="pbRepeat"><option value="weekly" ${existing?.weekday!=null?'selected':''}>Ogni settimana</option><option value="once" ${existing&&existing.weekday==null?'selected':''}>Una sola data</option></select>
  <label>Giorno della settimana</label><select id="pbWeekday">${['Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato','Domenica'].map((d,i)=>`<option value="${i}" ${Number(existing?.weekday||0)===i?'selected':''}>${d}</option>`).join('')}</select>
  <label>Data singola</label><input type="date" id="pbDate" value="${escapeHtml(existing?.block_date||plannerLocalToday())}">
  <div class="planner-inline-fields"><div><label>Dalle</label>${select('pbFrom',existing?.start_time||'15:00')}</div><div><label>Alle</label>${select('pbTo',existing?.end_time||'16:00')}</div></div>
  <small>Questo orario occupa il Planner. Le modifiche vengono inviate al desktop tramite le risposte cifrate.</small>
  <div class="planner-target-buttons"><button id="pbCancel">Annulla</button><button id="pbSave">Salva impegno</button></div>${existing?'<button id="pbDelete" class="planner-delete">Elimina impegno</button>':''}</div>`;
  document.body.appendChild(overlay);
  const $b=id=>overlay.querySelector('#'+id);
  $b('pbCancel').onclick=()=>overlay.remove();
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove()});
  const repeat=()=>{const weekly=$b('pbRepeat').value==='weekly';$b('pbWeekday').disabled=!weekly;$b('pbDate').disabled=weekly;};
  $b('pbRepeat').onchange=repeat;repeat();
  const enqueue=async action=>{
    for(const old of pendingMobileActions.filter(a=>['planner_block_save','planner_block_delete'].includes(a.action_type)&&String(a.block_id||a.mobile_id)===String(action.block_id||action.mobile_id))){await storeDelete('pending_mobile_actions',old.action_id);}
    pendingMobileActions=pendingMobileActions.filter(a=>!(['planner_block_save','planner_block_delete'].includes(a.action_type)&&String(a.block_id||a.mobile_id)===String(action.block_id||action.mobile_id)));
    await queueMobileAction(action);overlay.remove();renderMobilePlanner($('plannerDate').value,calendarItems());
  };
  $b('pbSave').onclick=async()=>{
    const label=$b('pbTitle').value.trim(),start=$b('pbFrom').value,end=$b('pbTo').value;
    if(!label){alert('Scrivi una descrizione dell’impegno.');return;}
    if(mobilePlannerMinutes(end)<=mobilePlannerMinutes(start)){alert('L’orario di fine deve essere successivo a quello di inizio.');return;}
    const weekly=$b('pbRepeat').value==='weekly';
    if(!weekly&&!$b('pbDate').value){alert('Seleziona la data.');return;}
    await enqueue({action_type:'planner_block_save',block_id:existing&&Number(existing.id)>0?existing.id:null,mobile_id:existing?.mobile_id||(!existing?uid():(Number(existing.id)>0?'':existing.id)),weekday:weekly?Number($b('pbWeekday').value):null,block_date:weekly?null:$b('pbDate').value,start_time:start,end_time:end,label,base_label:existing?.label||'',base_start_time:existing?.start_time||'',base_end_time:existing?.end_time||''});
  };
  if(existing)$b('pbDelete').onclick=async()=>{if(confirm('Eliminare questo impegno?'))await enqueue({action_type:'planner_block_delete',block_id:Number(existing.id)>0?existing.id:null,mobile_id:existing.mobile_id||existing.id,base_label:existing.label,base_start_time:existing.start_time,base_end_time:existing.end_time});};
}
function plannerChecklistForDay(day){
  const lists=new Map((snapshot?.checklists||[]).map(l=>[String(l.checklist_id),l]));
  const estimates=new Map((snapshot?.plannerChecklistEstimates||[]).map(x=>[String(x.checklist_item_id),x]));
  const slots=(snapshot?.plannerChecklistSessions||[]);
  return (snapshot?.checklistItems||[]).filter(i=>!['COMPLETATA','COMPLETATO','ANNULLATA','ANNULLATO'].includes(String(i.status||'').toUpperCase())).map(i=>{
    const list=lists.get(String(i.checklist_id))||{};
    const due=i.due_date||list.date||'';
    const est=estimates.get(String(i.checklist_item_id))||{};
    const planned=slots.filter(s=>String(s.checklist_item_id)===String(i.checklist_item_id));
    const scheduled=planned.reduce((sum,x)=>Math.max(0,(mobilePlannerMinutes(x.end_time)||0)-(mobilePlannerMinutes(x.start_time)||0))+sum,0);
    return {...i, due, listTitle:list.title||'Checklist', duration:Number(est.estimated_minutes||60), scheduled, planned};
  }).filter(i=>i.due===day);
}
function mobileChecklistPlanHtml(day){
  const items=plannerChecklistForDay(day);
  if(!items.length)return '';
  const total=items.reduce((n,i)=>n+Math.max(0,i.duration-i.scheduled),0);
  return `<div class="mobile-planner-checklists"><div class="mobile-planner-task-title">CHECKLIST E TEMPO NECESSARIO <b>${items.length}</b></div>
   ${items.map(i=>`<div class="mobile-checklist-work"><span>${escapeHtml(i.listTitle)} · ${escapeHtml(i.due_time?'entro '+i.due_time:'nessun orario assegnato')}</span>
       <strong>${escapeHtml(i.title)}</strong><small>${i.duration} min stimati · ${i.scheduled} min pianificati · ${Math.max(0,i.duration-i.scheduled)} min ancora da collocare</small></div>`).join('')}
   ${total?`<div class="planner-capacity-warning">${total} minuti di checklist non ancora collocati. Pianifica sul desktop e aggiorna l'archivio cifrato.</div>`:''}
   </div>`;
}
function companionDayProfile(day){
  return (snapshot?.plannerComputedDays||[]).find(row=>row.date===day)||null;
}
function effectivePlannerExceptions(){
  const x=new Map((snapshot?.plannerBlockExceptions||[]).map(e=>[String(e.block_id)+'@'+e.exception_date,{...e}]));
  for(const a of pendingMobileActions.filter(a=>a.action_type==='planner_block_exception_save'||a.action_type==='planner_block_exception_remove')){
    const k=String(a.block_id)+'@'+a.exception_date;
    if(a.action_type==='planner_block_exception_remove')x.delete(k);
    else x.set(k,{...a});
  }
  return x;
}
function openPlannerExceptionEditor(blockId,day){
  const existing=effectivePlannerBlocks().find(x=>String(x.id)===String(blockId));
  if(!existing||existing.weekday==null)return openPlannerBlockEditor(blockId);
  const ex=effectivePlannerExceptions().get(String(blockId)+'@'+day)||{};
  const overlay=document.createElement('div');overlay.className='planner-target-overlay';overlay.id='plannerExceptionOverlay';
  const times=Array.from({length:97},(_,i)=>mobilePlannerTime(i*15));
  const select=(id,value)=>`<select id="${id}">${times.map(t=>`<option value="${t}" ${t===value?'selected':''}>${t}</option>`).join('')}</select>`;
  overlay.innerHTML=`<div class="planner-target-sheet"><div class="planner-target-kicker">ECCEZIONE DI UN SOLO GIORNO</div><h3>${escapeHtml(fmtDate(day))}</h3>
    <p>Modifica «${escapeHtml(existing.label||'Impegno personale')}» solo per questo giorno. La ricorrenza degli altri giorni non cambia.</p>
    <label>Descrizione</label><input id="peTitle" maxlength="80" value="${escapeHtml(ex.label||existing.label||'')}">
    <div class="planner-inline-fields"><div><label>Dalle</label>${select('peStart',ex.start_time||existing.start_time)}</div><div><label>Alle</label>${select('peEnd',ex.end_time||existing.end_time)}</div></div>
    <div class="planner-target-buttons"><button id="peCancel">Annulla</button><button id="peSave">Salva per questo giorno</button></div>
    <button id="peDisable" class="planner-delete">Sospendi solo questa data</button><button id="peRestore" class="planner-propose">Ripristina la ricorrenza</button></div>`;
  document.body.appendChild(overlay);
  const el=id=>overlay.querySelector('#'+id);
  const submit=async(mode)=>{
    const start=el('peStart').value,end=el('peEnd').value;
    if(mode==='save'&&mobilePlannerMinutes(end)<=mobilePlannerMinutes(start)){alert('L’ora finale deve essere successiva all’inizio.');return;}
    const key=String(blockId)+'@'+day;
    for(const old of pendingMobileActions.filter(a=>['planner_block_exception_save','planner_block_exception_remove'].includes(a.action_type)&&String(a.block_id)+'@'+a.exception_date===key))await storeDelete('pending_mobile_actions',old.action_id);
    pendingMobileActions=pendingMobileActions.filter(a=>!(['planner_block_exception_save','planner_block_exception_remove'].includes(a.action_type)&&String(a.block_id)+'@'+a.exception_date===key));
    await queueMobileAction({action_type:mode==='restore'?'planner_block_exception_remove':'planner_block_exception_save',
      block_id:Number(blockId),target_id:String(blockId),exception_date:day,disabled:mode==='disable',
      start_time:start,end_time:end,label:el('peTitle').value.trim()||existing.label});
    overlay.remove();renderMobilePlanner($('plannerDate').value,calendarItems());renderHome();
  };
  el('peCancel').onclick=()=>overlay.remove();el('peSave').onclick=()=>submit('save');
  el('peDisable').onclick=()=>submit('disable');el('peRestore').onclick=()=>submit('restore');
}
function mobilePlannerSegments(day,events){
  const dayNo=mobilePlannerDayNumber(day);
  const ranges=(snapshot?.plannerWindows||[]).filter(w=>Number(w.weekday)===dayNo).map(w=>[mobilePlannerMinutes(w.start_time),mobilePlannerMinutes(w.end_time),Boolean(Number(w.preferred))]).filter(r=>r[0]!==null&&r[1]>r[0]);
  const exceptions=effectivePlannerExceptions();
  const blocks=effectivePlannerBlocks().filter(b=>b.block_date===day||(b.block_date==null&&Number(b.weekday)===dayNo)).flatMap(b=>{
    const ex=exceptions.get(String(b.id)+'@'+day);
    if(ex&&Boolean(Number(ex.disabled))||ex&&ex.disabled===true)return [];
    return [{...b,...(ex||{})}];
  });
  const computed=companionDayProfile(day);
  const changed=pendingMobileActions.some(a=>['planner_block_save','planner_block_delete','planner_block_exception_save','planner_block_exception_remove','planner_work_sessions'].includes(a.action_type));
  if(computed&&!changed){
    const plannedBlocks=computed.busy.filter(x=>x.private&&x.source==='Blocco personale').map(x=>({
      id:x.block_id,weekday:dayNo,block_date:null,label:x.label,start_time:x.start_time,end_time:x.end_time}));
    return {ranges,blocks:plannedBlocks,busy:computed.busy.map(x=>[mobilePlannerMinutes(x.start_time),mobilePlannerMinutes(x.end_time)]),
      available:computed.available.map(x=>[mobilePlannerMinutes(x[0]),mobilePlannerMinutes(x[1]),x[2]==='preferred']),
      total:computed.available.reduce((n,x)=>n+mobilePlannerMinutes(x[1])-mobilePlannerMinutes(x[0]),0),
      warnings:computed.warnings||[],computedBusy:computed.busy};
  }
  // An assigned 'entro le' time is never turned into an artificial busy hour.
  const pendingBusy=pendingMobileActions.filter(a=>a.action_type==='planner_work_sessions').flatMap(a=>(a.slots||[]).filter(slot=>slot[0]===day).map(([d,from,to])=>({start_time:mobilePlannerTime(from),end_time:mobilePlannerTime(to)})));
  const checklistSlots=(snapshot?.plannerChecklistSessions||[]).filter(s=>s.plan_date===day);
  const travel=(computed?.busy||[]).filter(x=>x.source==='Trasferimento udienza').map(x=>({start_time:x.start_time,end_time:x.end_time}));
  const baseline=computed ? computed.busy.filter(e=>e.source!=='Blocco personale'&&e.source!=='Checklist pianificata') : events.filter(e=>e.event_date===day&&e.start_time);
  const busy=[...baseline,...(computed?[]:travel),...blocks,...pendingBusy,...checklistSlots].map(e=>[mobilePlannerMinutes(e.start_time),mobilePlannerMinutes(e.end_time)]).filter(r=>r[0]!==null).map(r=>[r[0],r[1]===null?Math.min(r[0]+60,1440):r[1]]).filter(r=>r[1]>r[0]);
  const merged=mobilePlannerMerge(busy),available=[];
  for(const [a,b,preferred] of ranges){let cursor=a;for(const [x,y] of merged){if(y<=cursor||x>=b)continue;if(x>cursor)available.push([cursor,Math.min(x,b),preferred]);cursor=Math.max(cursor,Math.min(y,b));if(cursor>=b)break;}if(cursor<b)available.push([cursor,b,preferred]);}
  return {ranges,busy,available,total:available.reduce((n,r)=>n+r[1]-r[0],0),blocks,warnings:computed?.warnings||[]};
}
async function plannerMoveLocalTomorrow(id){
  const task=localTasks.find(t=>String(t.id)===String(id));
  if(!task||task.category==='UDIENZA'){alert('Questa voce non può essere spostata qui.');return;}
  if(task.status==='COMPLETATA'){alert('Attività già completata.');return;}
  const next=addDays(task.date||plannerLocalToday(),1);
  const tomorrow=addDays(plannerLocalToday(),1);
  const destination=next>tomorrow?next:tomorrow;
  const candidate={...task,date:destination,updated_at:new Date().toISOString()};
  const clashes=calendarItems().filter(e=>String(e.id)!==String(id)).filter(e=>overlaps(candidate,e));
  if(clashes.length){
    alert('Il nuovo orario si sovrappone a un altro impegno. Apri la scheda e scegli un orario alternativo.');
    openLocalTask(id);return;
  }
  await storePut('local_tasks',candidate);
  localTasks=localTasks.map(t=>String(t.id)===String(id)?candidate:t);
  for(const a of pendingMobileActions.filter(a=>String(a.mobile_uid||'')===String(id)&&a.action_type==='upsert_task')){
    await storeDelete('pending_mobile_actions',a.action_id);
  }
  pendingMobileActions=pendingMobileActions.filter(a=>!(String(a.mobile_uid||'')===String(id)&&a.action_type==='upsert_task'));
  if(!candidate.private)await queueMobileAction({action_type:'upsert_task',mobile_uid:id,target_id:id,payload:candidate});
  renderAll();
  if($('plannerDate')){$('plannerDate').value=destination;renderMobilePlanner(destination,calendarItems());}
}
// V20.2: importazione organizzativa da testo strutturato, completamente offline.
function plannerBatchBusy(day){
  const info=mobilePlannerSegments(day,calendarItems());
  const occupied=(info.busy||[]).map(([a,b])=>[a,b]);
  // Quando il snapshot calcolato è presente, il motore legacy può non aver
  // incluso nuove attività salvate localmente: vanno sommate esplicitamente.
  for(const event of calendarItems().filter(e=>e.event_date===day && e.source_type==='LOCAL' && e.occupies_calendar!==false)){
    const a=mobilePlannerMinutes(event.start_time);
    const end=mobilePlannerMinutes(event.end_time);
    if(a!==null)occupied.push([a,end!==null&&end>a?end:Math.min(1440,a+60)]);
  }
  return occupied;
}
function plannerBatchWindows(day){
  const weekday=mobilePlannerDayNumber(day);
  return (snapshot?.plannerWindows||[]).filter(w=>Number(w.weekday)===weekday).map(w=>[
    mobilePlannerMinutes(w.start_time),mobilePlannerMinutes(w.end_time),Boolean(Number(w.preferred))
  ]).filter(([a,b])=>a!==null&&b!==null&&b>a);
}
function openPlannerBatchPaste(){
  $('plannerBatchOverlay')?.remove();
  const el=document.createElement('div');el.id='plannerBatchOverlay';el.className='planner-batch-overlay';
  el.setAttribute('role','dialog');el.setAttribute('aria-modal','true');el.setAttribute('aria-label','Incolla attività da programmare');
  el.innerHTML=`<div class="planner-batch-sheet">
    <header><div><small>IL MIO PLANNER</small><h2>Incolla e organizza</h2></div><button type="button" id="pbClose" aria-label="Chiudi">✕</button></header>
    <p>Prepara l'elenco con ChatGPT, incollalo qui e controlla la proposta prima di salvarla. Le attività senza orario vengono distribuite automaticamente, anche nei giorni successivi.</p>
    <label for="plannerBatchText">Attività da organizzare</label>
    <textarea id="plannerBatchText" rows="7" autocapitalize="sentences" spellcheck="true" placeholder="OGGI | LIBERO | 1 ora | Depositare visibilità\nOGGI | LIBERO | 2 ore | Controllo RG\nOGGI | 08:45 | 30 min | Telefonata | APPUNTAMENTO\nDOMANI | LIBERO | 20 min | Istanza gratuito patrocinio"></textarea>
    <small class="planner-batch-format">Una riga: GIORNO | ORA oppure LIBERO | DURATA | DESCRIZIONE | TIPO facoltativo. Date sempre GG/MM/AAAA. Le scadenze processuali non vengono modificate.</small>
    <div class="planner-batch-report" id="plannerBatchReport" aria-live="polite">Ancora nessuna proposta. Premi «Trova orari».</div>
    <footer><button type="button" id="pbSuggest">Trova orari</button><button type="button" id="pbConfirm" disabled>Conferma e salva</button></footer>
  </div>`;
  document.body.append(el);
  const $b=id=>el.querySelector('#'+id);
  let lastText='',lastPlans=null,lastItems=null;
  const close=()=>el.remove();$b('pbClose').onclick=close;
  el.addEventListener('click',e=>{if(e.target===el)close();});
  function resetPreview(){lastText='';lastPlans=null;lastItems=null;$b('pbConfirm').disabled=true;}
  $b('plannerBatchText').oninput=resetPreview;
  function compute(){
    const text=$b('plannerBatchText').value.trim();
    const {items,errors}=PlannerBatchCosta.parse(text,PlannerBatchCosta.iso(new Date()));
    if(errors.length)return {items,errors,plans:{},issues:{}};
    const {plans,issues}=PlannerBatchCosta.arrange(items,plannerBatchBusy,plannerBatchWindows,new Date());
    return {items,errors,plans,issues};
  }
  $b('pbSuggest').onclick=()=>{
    const result=compute();resetPreview();
    const {items,errors,plans,issues}=result;
    if(errors.length){$b('plannerBatchReport').innerHTML=`<strong>Correggi ${errors.length} righe:</strong>${errors.map(x=>`<p class="pb-error">${escapeHtml(x)}</p>`).join('')}`;return;}
    const defers=Object.entries(plans).flatMap(([line,slots])=>{
      const item=items.find(x=>x.line===Number(line));return slots.filter(([day])=>day>item.preferred_day);
    }).length;
    let html=`<strong>Proposta: ${Object.keys(plans).length}/${items.length} attività collocabili</strong>`;
    for(const item of items){
      const slots=plans[item.line]||[];
      html+=`<div class="pb-row"><strong>${escapeHtml(item.title)}</strong><small>${item.minutes} min · ${escapeHtml(item.kind)}</small>`;
      html+=issues[item.line]?`<div class="pb-error">${escapeHtml(issues[item.line])}</div>`:
        `<div class="pb-sessions">${slots.map(([day,a,b])=>`<span>${escapeHtml(fmtDate(day))} · ${mobilePlannerTime(a)}–${mobilePlannerTime(b)}</span>`).join('')}</div>`;
      html+='</div>';
    }
    if(defers)html+=`<p class="pb-warning">${defers} sessioni spostate a giorni successivi per mancanza di spazio.</p>`;
    if(Object.keys(issues).length)html+='<p class="pb-error">Risolvi i conflitti prima della conferma. Gli impegni familiari non vengono spostati automaticamente.</p>';
    $b('plannerBatchReport').innerHTML=html;
    if(Object.keys(issues).length===0){lastText=$b('plannerBatchText').value.trim();lastPlans=plans;lastItems=items;$b('pbConfirm').disabled=false;}
  };
  $b('pbConfirm').onclick=async()=>{
    if(!lastItems||lastText!==$b('plannerBatchText').value.trim()){
      alert('Il testo è cambiato. Premi di nuovo «Trova orari».');return;
    }
    const current=compute();
    if(current.errors.length||Object.keys(current.issues).length||JSON.stringify(current.plans)!==JSON.stringify(lastPlans)){
      alert('Gli orari sono cambiati o ci sono nuovi conflitti. Controlla la nuova proposta.');$b('pbSuggest').click();return;
    }
    const tasks=[];
    for(const item of lastItems){
      const slots=lastPlans[item.line];
      for(let ix=0;ix<slots.length;ix++){
        const [date,start,end]=slots[ix];
        const title=item.title+(slots.length>1?` · sessione ${ix+1}/${slots.length}`:'');
        const startTime=mobilePlannerTime(start),endTime=mobilePlannerTime(end);
        if(localTasks.some(t=>t.date===date&&t.title===title&&t.start_time===startTime&&t.end_time===endTime)){
          alert(`Attività già presente sul telefono: ${title} (${fmtDate(date)}). Nessun duplicato creato.`);return;
        }
        tasks.push({id:uid(),title,category:item.kind==='PERSONALE'?'PERSONALE':item.kind==='APPUNTAMENTO'?'APPUNTAMENTO':item.kind==='TELEFONATA'?'TELEFONATA':'ATTIVITÀ',
          practice_id:'',date,start_time:startTime,end_time:endTime,all_day:false,location:'',notes:`Pianificazione da elenco: ${item.minutes} minuti totali, giorno richiesto ${item.preferred_day}.`,
          priority:item.priority==='NORMALE'?'MEDIA':item.priority,occupies_calendar:true,private:false,status:'DA_FARE',
          created_at:new Date().toISOString(),updated_at:new Date().toISOString(),device_id:deviceId()});
      }
    }
    if(!confirm(`Registrare ${tasks.length} sessioni? Le scadenze giuridiche restano invariate. Le nuove attività saranno locali fino all'esportazione delle modifiche cifrate verso il desktop.`))return;
    $b('pbConfirm').disabled=true;
    let saved=0;
    try{
      for(const task of tasks){
        await storePut('local_tasks',task);localTasks.push(task);saved++;
        await queueMobileAction({action_type:task.category==='APPUNTAMENTO'?'upsert_appointment':'upsert_task',mobile_uid:task.id,target_id:task.id,payload:task});
      }
      close();renderAll();
      alert(`${saved} sessioni registrate nella Companion. Esporta poi le modifiche cifrate .scmr per importarle sul desktop.`);
    }catch(error){
      alert(`${saved} sessioni salvate, ma l'operazione è stata interrotta: ${error.message}. Verifica l'elenco prima di riprovare per evitare duplicati.`);
      renderAll();
    }
  };
  $b('plannerBatchText').focus();
}
function renderMobilePlanner(anchor,all){
  const day=anchor||plannerLocalToday();
  const configured=(snapshot?.plannerWindows||[]).length>0;
  const names=['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
  const info=mobilePlannerSegments(day,all),events=all.filter(e=>e.event_date===day),tasks=plannerTasksForDay(day,all);
  const rows=info.available.map(([a,b,p])=>`<div class="mobile-planner-slot ${p?'preferred':''}"><span>${mobilePlannerTime(a)}–${mobilePlannerTime(b)}</span><b>${p?'★ Preferita per lavorare':'Disponibile'}</b></div>`).join('');
  const otherEvents=events.filter(e=>e.source_type!=='TASK');
  const appointments=info.computedBusy?info.computedBusy.filter(e=>!e.private&&e.source!=='Checklist pianificata').map(e=>`<div class="mobile-planner-commitment ${e.source==='Trasferimento udienza'?'travel':''}"><span>${escapeHtml(e.start_time||'Senza ora')}–${escapeHtml(e.end_time||'')}</span><strong>${escapeHtml(e.label||e.source||'Impegno')}</strong></div>`).join(''):
    otherEvents.map(e=>`<button class="mobile-planner-commitment" data-planner-event="${escapeHtml(e.uid||e.id||'')}" data-planner-practice="${escapeHtml(e.practice_id||'')}"><span>${escapeHtml(e.start_time||'Senza ora')}</span><strong>${escapeHtml(e.title||e.type||'Impegno')} ›</strong></button>`).join('');
  const waitingSessions=pendingMobileActions.filter(a=>a.action_type==='planner_work_sessions').flatMap(a=>(a.slots||[]).filter(slot=>slot[0]===day).map(slot=>`<div class="mobile-planner-commitment work"><span>${mobilePlannerTime(slot[1])}–${mobilePlannerTime(slot[2])} · IN ATTESA DEL DESKTOP</span><strong>Sessione di lavoro programmata</strong></div>`)).join('');
  const checklistBooked=(snapshot?.plannerChecklistSessions||[]).filter(s=>s.plan_date===day).map(s=>`<div class="mobile-planner-commitment work"><span>CHECKLIST · ${escapeHtml(s.start_time)}–${escapeHtml(s.end_time)}</span><strong>${escapeHtml(s.title||'Attività checklist')}</strong></div>`).join('');
  const privates=info.blocks.map(b=>`<button class="mobile-planner-commitment private" data-edit-block="${escapeHtml(b.id||b.mobile_id||'')}" data-block-day="${escapeHtml(day)}"><span>FAMIGLIA / PERSONALE · ${escapeHtml(b.start_time)}–${escapeHtml(b.end_time)}</span><strong>${escapeHtml(b.label||'Impegno personale')}  ›</strong></button>`).join('');
  const taskItems=tasks.map(t=>`<button class="mobile-planner-task ${t.deadline?'is-deadline':''}" data-planner-task="${escapeHtml(t.id)}" data-planner-date="${escapeHtml(day)}"><span>${t.target_time?'Entro '+escapeHtml(t.target_time):'Senza ora'}</span><strong>${escapeHtml(t.title)}</strong><small>${t.deadline?'Scadenza · ':'Attività · '}${t.target_time?'Orario operativo':'Imposta un orario'} · ${workloadLabel(t.id,t.title)}</small></button>`).join('');
  const localMoves=localTasks.filter(t=>t.date===day&&t.status!=='COMPLETATA'&&t.category!=='UDIENZA').map(t=>
    `<div class="planner-local-action"><div><small>${escapeHtml(t.start_time||'Senza ora')} · ${escapeHtml(t.category||'ATTIVITÀ')}</small><strong>${escapeHtml(t.title||'Attività')}</strong></div><button data-planner-move-local="${escapeHtml(t.id)}">Sposta a domani</button></div>`).join('');
  const pending=tasks.filter(t=>!t.target_time).length;
  const dayName=names[new Date(day+'T12:00:00').getDay()];
  const html=`<article class="mobile-planner-day"><div class="mobile-planner-heading"><strong>${escapeHtml(dayName)} ${escapeHtml(day.slice(-2))}</strong><span>${Math.floor(info.total/60)} h ${String(info.total%60).padStart(2,'0')} libere</span></div>
      ${info.warnings.length?`<div class="planner-capacity-warning">${info.warnings.map(w=>escapeHtml(w)).join(' · ')}</div>`:''}
      <div class="planner-day-columns"><div class="planner-day-main">
      ${appointments||privates||waitingSessions||checklistBooked?`<div class="mobile-planner-commitments">${appointments}${privates}${waitingSessions}${checklistBooked}</div>`:''}
      <div class="mobile-planner-task-title">Scadenze e attività <b>${tasks.length}</b>${pending?` · ${pending} senza ora`:''}</div>
      ${taskItems||'<div class="mobile-planner-empty">Nessuna attività da organizzare</div>'}
      ${localMoves?`<div class="planner-local-section"><h3>Attività modificabili create sul telefono</h3>${localMoves}</div>`:''}
      </div><aside class="planner-day-sidebar">
      <details class="mobile-planner-availability"><summary>Disponibilità della giornata (${Math.floor(info.total/60)} h ${String(info.total%60).padStart(2,'0')})</summary>${rows||'<div class="mobile-planner-empty">Nessuna fascia configurata</div>'}</details>
      ${mobileChecklistPlanHtml(day)}</aside></div></article>`;
  $('plannerPeriodLabel').textContent=`${fmtDate(day)}`;
  const targets=plannerTargetMap();
  const unscheduled=(snapshot?.plannerUndatedTasks||[]).filter(t=>!((targets.get(String(t.task_id))||t).plan_date));
  const backlog=unscheduled.length?`<section class="mobile-planner-backlog"><h3>Attività senza data <span>${unscheduled.length}</span></h3><p>Assegna un giorno per visualizzarle nella giornata.</p>${unscheduled.slice(0,40).map(t=>`<button class="mobile-planner-task" data-planner-task="${escapeHtml(t.task_id)}" data-planner-date=""><span>Da datare</span><strong>${escapeHtml(t.title||'Attività')}</strong><small>Programma la giornata e l'orario</small></button>`).join('')}${unscheduled.length>40?'<small>Mostrate le prime 40 attività; organizza le altre dal desktop.</small>':''}</section>`:'';
  $('plannerContent').innerHTML=`<div class="planner-mobile-actions"><button id="addPlannerActivity" class="secondary">＋ Attività</button><button id="plannerPasteOpen">Incolla elenco</button><button id="addPlannerFamily" class="planner-family-btn">＋ Famiglia</button></div><section class="planner-legend"><span class="legend-hearing">● Udienze</span><span class="legend-appointment">● Appuntamenti</span><span class="legend-family">● Famiglia</span><span class="legend-work">● Lavoro</span></section><section class="mobile-planner-note"><strong>Il tuo tempo, giorno per giorno</strong><p>${configured?'★ Preferita significa fascia disponibile in cui prediligi lavorare: non è un impegno.':'Configura prima le disponibilità nel Planner desktop ed esporta il file cifrato.'}</p><small>Tutte le scadenze restano alla loro data. Gli orari «entro le» sono promemoria organizzativi, NON termini giuridici. Le ore libere non comprendono spostamenti non inseriti.</small></section>${html}${backlog}`;
  $('plannerContent').querySelectorAll('[data-planner-event]').forEach(button=>button.onclick=()=>{
    const p=button.dataset.plannerPractice;
    if(p && practiceById(p))openPractice(p);
    else switchView('agendaView');
  });
  $('plannerContent').querySelectorAll('[data-planner-task]').forEach(button=>button.onclick=()=>editMobilePlannerTarget(button.dataset.plannerTask,button.dataset.plannerDate,all));
  $('plannerContent').querySelectorAll('[data-edit-block]').forEach(button=>button.onclick=()=>{
    const block=effectivePlannerBlocks().find(x=>String(x.id)===String(button.dataset.editBlock));
    if(block?.weekday!=null)openPlannerExceptionEditor(button.dataset.editBlock,button.dataset.blockDay);
    else openPlannerBlockEditor(button.dataset.editBlock);
  });
  $('plannerContent').querySelectorAll('[data-planner-move-local]').forEach(btn=>btn.onclick=()=>plannerMoveLocalTomorrow(btn.dataset.plannerMoveLocal).catch(e=>alert(e.message)));
  $('plannerPasteOpen').onclick=openPlannerBatchPaste;
  $('addPlannerFamily').onclick=()=>openPlannerBlockEditor();
  $('addPlannerActivity').onclick=()=>{openLocalTask();$('localDate').value=day;};
}
function proposeMobileSessions(task,minutesNeeded,chunkMinutes){
  const today=plannerLocalToday();
  const last=task.original_date||addDays(today,28);
  const horizon=last<addDays(today,28)?last:addDays(today,28);
  const events=calendarItems(), candidates=[];
  const reserved=pendingMobileActions.filter(a=>a.action_type==='planner_work_sessions').flatMap(a=>a.slots||[]);
  for(let d=today;d<=horizon;d=addDays(d,1)){
    for(const [a,b,preferred] of mobilePlannerSegments(d,events).available){
      const now=new Date();const current=now.getHours()*60+now.getMinutes();
      const start=d===today?Math.max(a,Math.ceil(current/15)*15):a;
      if(start+15<=b)candidates.push([d,start,b,preferred]);
    }
  }
  let left=minutesNeeded;const slots=[];
  const overlaps=(d,a,b)=>[...reserved,...slots].some(([day,x,y])=>day===d&&a<y&&b>x);
  for(const pref of [true,false])for(const [d,a,b,isPreferred] of candidates){
    if(isPreferred!==pref)continue;
    for(let x=a;x+chunkMinutes<=b&&left>=chunkMinutes;x+=chunkMinutes){
      if(!overlaps(d,x,x+chunkMinutes)){slots.push([d,x,x+chunkMinutes]);left-=chunkMinutes;}
    }
  }
  for(const pref of [true,false])for(const [d,a,b,isPreferred] of candidates){
    if(isPreferred!==pref)continue;
    for(let x=a;x+15<=b&&left>=15;){
      const amount=Math.floor(Math.min(left,chunkMinutes,b-x)/15)*15;
      if(amount<15)break;
      if(!overlaps(d,x,x+amount)){slots.push([d,x,x+amount]);left-=amount;x+=amount;}else x+=15;
    }
  }
  return {slots:slots.sort((a,b)=>a[0].localeCompare(b[0])||a[1]-b[1]),missing:left};
}

function editMobilePlannerTarget(taskId,day,all){
  let task=day?plannerTasksForDay(day,all).find(t=>t.id===String(taskId)):null;
  if(!task){const u=(snapshot?.plannerUndatedTasks||[]).find(t=>String(t.task_id)===String(taskId));if(u)task={id:String(u.task_id),title:u.title,original_date:'',target_time:'',base_updated_at:u.updated_at||''};}
  if(!task)return;
  const existing=document.getElementById('plannerTargetOverlay');if(existing)existing.remove();
  const choices=Array.from({length:96},(_,i)=>mobilePlannerTime(i*15));
  const overlay=document.createElement('div');overlay.id='plannerTargetOverlay';overlay.className='planner-target-overlay';
  overlay.innerHTML=`<div class="planner-target-sheet"><div class="planner-target-kicker">ORGANIZZA ATTIVITÀ</div><h3>${escapeHtml(task.title)}</h3><p>${task.original_date?'Scadenza o data originale: '+escapeHtml(fmtDate(task.original_date))+'. Questa data non verrà modificata.':'Attività da programmare'}</p>
    ${task.original_date?'':`<label>Giorno in cui svolgerla</label><input id="plannerTargetDate" type="date" value="${escapeHtml(day||'')}">`}
    <label>Da completare entro le</label><select id="plannerTargetClock"><option value="">Senza orario</option>${choices.map(t=>`<option value="${t}" ${t===task.target_time?'selected':''}>${t}</option>`).join('')}</select>
    <label>Tempo necessario all'attività</label><select id="plannerEstimate">${[15,30,45,60,90,120,180,240,360,480,600].map(n=>`<option value="${n}">${n<60?n+' minuti':n%60===0?n/60+' ore':Math.floor(n/60)+' ore e '+n%60+' minuti'}</option>`).join('')}</select>
    <label>Durata di ogni sessione di lavoro</label><select id="plannerChunk">${[15,30,45,60,90,120,180,240].map(n=>`<option value="${n}">${n} minuti</option>`).join('')}</select>
    <small>La stima verrà inviata al desktop, dove potrai confermare le sessioni. Non modifica il termine processuale.</small>
    <div class="planner-target-buttons"><button id="plannerTargetCancel">Annulla</button><button id="plannerTargetSave">Salva orario</button></div><button id="plannerSuggestSessions" class="planner-propose">Proponi sessioni nel Planner</button><div id="plannerSessionPreview" class="planner-session-preview"></div></div>`;
  document.body.appendChild(overlay);
  const existingEstimate=pendingMobileActions.filter(a=>a.action_type==='planner_workload'&&String(a.task_id)===String(taskId)).at(-1)||(snapshot?.plannerTaskTargets||[]).find(t=>String(t.task_id)===String(taskId));
  const name=String(task.title||'').toLowerCase();
  const suggested=name.includes('appello')?360:name.includes('costituzione')?240:name.includes('lettera')?15:name.includes('studio')?60:60;
  document.getElementById('plannerEstimate').value=String(existingEstimate?.estimated_minutes||suggested);
  document.getElementById('plannerChunk').value=String(existingEstimate?.chunk_minutes||Math.min(120,suggested));
  document.getElementById('plannerSuggestSessions').onclick=async()=>{
    const estimate=Number(document.getElementById('plannerEstimate').value);
    const chunk=Number(document.getElementById('plannerChunk').value);
    const preview=proposeMobileSessions(task,estimate,chunk);
    const target=document.getElementById('plannerSessionPreview');
    const rows=preview.slots.map(([d,a,b])=>`<div>${escapeHtml(fmtDate(d))} · ${mobilePlannerTime(a)}–${mobilePlannerTime(b)} (${b-a} min)</div>`).join('');
    target.innerHTML=`<strong>${preview.slots.length} sessioni · ${estimate-preview.missing} min pianificabili</strong>${rows||'<p>Non ci sono fasce libere sufficienti.</p>'}${preview.missing?`<small>${preview.missing} minuti ancora da collocare: aggiorna le disponibilità dal desktop.</small>`:''}<button id="plannerConfirmSessions" ${preview.slots.length?'':'disabled'}>Conferma sessioni da sincronizzare</button>`;
    const submit=target.querySelector('#plannerConfirmSessions');
    if(submit)submit.onclick=async()=>{
      if(!confirm('Aggiungere queste sessioni all’Agenda desktop alla prossima importazione? Verranno ricontrollate eventuali sovrapposizioni.'))return;
      await queueMobileAction({action_type:'planner_workload',task_id:taskId,target_id:taskId,estimated_minutes:estimate,chunk_minutes:chunk,base_updated_at:task.base_updated_at});
      await queueMobileAction({action_type:'planner_work_sessions',task_id:taskId,target_id:taskId,slots:preview.slots,base_updated_at:task.base_updated_at});
      overlay.remove();renderMobilePlanner($('plannerDate').value,calendarItems());
    };
  };
  document.getElementById('plannerTargetCancel').onclick=()=>overlay.remove();
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove()});
  document.getElementById('plannerTargetSave').onclick=async()=>{
    const hour=document.getElementById('plannerTargetClock').value;
    const planDay=task.original_date?'':(document.getElementById('plannerTargetDate')?.value||'');
    if(!task.original_date&&!planDay){alert('Seleziona prima la data in cui vuoi svolgere questa attività.');return;}
    for(const old of pendingMobileActions.filter(a=>a.action_type==='planner_target_time'&&String(a.task_id||a.target_id)===String(taskId))){
      await storeDelete('pending_mobile_actions',old.action_id);
    }
    pendingMobileActions=pendingMobileActions.filter(a=>!(a.action_type==='planner_target_time'&&String(a.task_id||a.target_id)===String(taskId)));
    await queueMobileAction({action_type:'planner_target_time',task_id:taskId,target_id:taskId,plan_date:planDay,target_time:hour,base_updated_at:task.base_updated_at});
    await queueMobileAction({action_type:'planner_workload',task_id:taskId,target_id:taskId,estimated_minutes:Number(document.getElementById('plannerEstimate').value),chunk_minutes:Number(document.getElementById('plannerChunk').value),base_updated_at:task.base_updated_at});
    overlay.remove();renderMobilePlanner($('plannerDate').value,calendarItems());
  };
}

function renderAgenda(){
  const today=plannerLocalToday();
  const anchor=$("agendaDate").value||today; const all=calendarItems().sort(eventSort); let events=[]; let periodLabel="";
  if(agendaMode==="planner"){renderMobilePlanner(anchor,all);return;}
  if(agendaMode==="day"){
    agendaSelectedDay=anchor; events=all.filter(e=>e.event_date===anchor); periodLabel=`${fmtWeekday(anchor)} ${fmtDate(anchor)}`;
    $("agendaContent").innerHTML=`<div class="planner-day-heading"><strong>${escapeHtml(fmtWeekday(anchor))}</strong><span>${fmtDate(anchor)} · ${events.length} ${events.length===1?'impegno':'impegni'}</span></div>${agendaTimeline(events)}`;
  }else if(agendaMode==="week"){
    const start=startOfWeek(anchor),end=addDays(start,6);
    if(!agendaSelectedDay||agendaSelectedDay<start||agendaSelectedDay>end)agendaSelectedDay=(today>=start&&today<=end)?today:start;
    events=all.filter(e=>e.event_date>=start&&e.event_date<=end); periodLabel=`${fmtDate(start)} – ${fmtDate(end)}`;
    const dayEvents=events.filter(e=>e.event_date===agendaSelectedDay);
    $("agendaContent").innerHTML=`${weekOverview(all,start,agendaSelectedDay,"data-agenda-week-day")}<div class="planner-day-heading"><strong>${escapeHtml(fmtWeekday(agendaSelectedDay))}</strong><span>${fmtDate(agendaSelectedDay)} · ${dayEvents.length} ${dayEvents.length===1?'impegno':'impegni'}</span></div>${agendaTimeline(dayEvents)}`;
    $("agendaContent").querySelectorAll("[data-agenda-week-day]").forEach(b=>b.onclick=()=>{agendaSelectedDay=b.dataset.agendaWeekDay;renderAgenda()});
  }else{
    const [start,end]=monthBounds(anchor); if(!agendaSelectedDay||agendaSelectedDay<start||agendaSelectedDay>end)agendaSelectedDay=anchor;
    events=all.filter(e=>e.event_date>=start&&e.event_date<=end); periodLabel=new Intl.DateTimeFormat("it-IT",{month:"long",year:"numeric"}).format(new Date(anchor+"T12:00:00"));
    const dayEvents=events.filter(e=>e.event_date===agendaSelectedDay);
    $("agendaContent").innerHTML=`${renderMonthGrid(events,agendaSelectedDay)}<div class="planner-day-heading"><strong>${escapeHtml(fmtWeekday(agendaSelectedDay))}</strong><span>${fmtDate(agendaSelectedDay)} · ${dayEvents.length} ${dayEvents.length===1?'impegno':'impegni'}</span></div>${agendaTimeline(dayEvents)}`;
    $("agendaContent").querySelectorAll("[data-agenda-day]").forEach(b=>b.onclick=()=>{agendaSelectedDay=b.dataset.agendaDay;renderAgenda()});
  }
  $("agendaPeriodLabel").textContent=periodLabel; bindPracticeLinks($("agendaContent"));
}

function renderAppointments(){
  const root=$("appointmentsContent");if(!root||!snapshot)return;
  const today=plannerLocalToday();const future=calendarItems().filter(e=>eventKind(e)==="APPUNTAMENTO"&&(e.event_date||"")>=today).sort(eventSort);
  root.innerHTML=future.length?groupedAgenda(future):'<div class="empty">Nessun appuntamento futuro registrato.</div>';
  bindPracticeLinks(root);
}

