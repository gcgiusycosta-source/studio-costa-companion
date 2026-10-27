function icsEscape(value){return String(value??"").replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n")}
function icsDateTime(date,time){return `${String(date||"").replaceAll("-","")}${String(time||"09:00").replace(":","").padEnd(6,"0")}`}
function icsAlarm(trigger,label){return `BEGIN:VALARM\r\nTRIGGER:${trigger}\r\nACTION:DISPLAY\r\nDESCRIPTION:${icsEscape(label)}\r\nEND:VALARM`}
function exportCalendarIcs(){
  const today=plannerLocalToday();const limit=addDays(today,365);
  const rows=calendarItems().filter(e=>e.event_date>=today&&e.event_date<=limit&&["UDIENZA","APPUNTAMENTO","SCADENZA","CRESET"].includes(eventKind(e))).sort(eventSort);
  if(!rows.length){alert("Nessun evento da esportare nel calendario.");return}
  const now=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
  const chunks=["BEGIN:VCALENDAR","VERSION:2.0",`PRODID:-//Studio Legale Costa//Companion V${COMPANION_BUILD}//IT`,"CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:Studio Legale Costa"];
  for(const e of rows){const kind=eventKind(e);const uidBase=e.uid||`${e.source_type||"EVENT"}-${e.source_id||e.id||uid()}`;const title=`Studio Costa · ${e.title||kind}`;chunks.push("BEGIN:VEVENT",`UID:${icsEscape(uidBase)}@studio-costa`,`DTSTAMP:${now}`);
    if(e.start_time){chunks.push(`DTSTART;TZID=Europe/Rome:${icsDateTime(e.event_date,e.start_time)}`);if(e.end_time)chunks.push(`DTEND;TZID=Europe/Rome:${icsDateTime(e.event_date,e.end_time)}`)}else chunks.push(`DTSTART;VALUE=DATE:${String(e.event_date).replaceAll("-","")}`);
    chunks.push(`SUMMARY:${icsEscape(title)}`);if(e.location)chunks.push(`LOCATION:${icsEscape(e.location)}`);const desc=[e.practice_name,e.practice_code,e.notes].filter(Boolean).join(" · ");if(desc)chunks.push(`DESCRIPTION:${icsEscape(desc)}`);
    if(kind==="UDIENZA"){chunks.push(icsAlarm("-P1D","Udienza domani"),icsAlarm("-PT1H","Udienza tra un'ora"))}
    else if(kind==="APPUNTAMENTO"){chunks.push(icsAlarm("-PT1H","Appuntamento tra un'ora"))}
    else{chunks.push(icsAlarm("-P3D","Scadenza tra 3 giorni"),icsAlarm("PT0M","Scadenza oggi"))}
    chunks.push("END:VEVENT");
  }
  chunks.push("END:VCALENDAR");const blob=new Blob([chunks.join("\r\n")+"\r\n"],{type:"text/calendar;charset=utf-8"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`StudioCosta_Calendario_${today}.ics`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function normalize(value){
  return String(value||"").normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase();
}
function searchBlob(p){
  return normalize([
    p.assistito,p.numero_principale,p.rg,p.rgnr,p.siep,p.sius,p.autorita,
    p.controparte,p.oggetto,p.note,p.materia,p.tipologia,p.stato,p.fase
  ].join(" "));
}
function daysUntil(date){return CompanionCore.daysUntil(date)}
function nextPracticeMilestone(p){
  const hearing=p.prossima_udienza;
  const deadline=p.prossima_scadenza;
  if(hearing && deadline){
    return String(hearing.event_date||'')<=String(deadline.event_date||'')
      ? {kind:'UDIENZA',item:hearing}
      : {kind:'SCADENZA',item:deadline};
  }
  if(hearing)return {kind:'UDIENZA',item:hearing};
  if(deadline)return {kind:'SCADENZA',item:deadline};
  return null;
}
function urgencyMeta(p){
  const milestone=nextPracticeMilestone(p);
  if(!milestone||!milestone.item?.event_date)return {label:'Monitoraggio ordinario', tone:'calm'};
  const d=daysUntil(milestone.item.event_date);
  if(d===null)return {label:'Monitoraggio ordinario', tone:'calm'};
  if(d<0)return {label:'Da verificare', tone:'overdue'};
  if(d===0)return {label: milestone.kind==='UDIENZA' ? 'Udienza oggi' : 'Attività oggi', tone:'urgent'};
  if(d===1)return {label: milestone.kind==='UDIENZA' ? 'Udienza domani' : 'Attività domani', tone:'urgent'};
  if(d<=3)return {label: `${milestone.kind==='UDIENZA'?'Udienza':'Attività'} tra ${d} giorni`, tone:'focus'};
  if(d<=7)return {label: `Prossimo adempimento tra ${d} giorni`, tone:'watch'};
  return {label:'Programmazione ordinaria', tone:'calm'};
}
function practiceMetric(label,value,accent=''){
  return `<div class="practice-metric ${accent}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value||'—')}</strong></div>`;
}
function practiceCard(p){
  const hearing=p.prossima_udienza;
  const deadline=p.prossima_scadenza;
  const matter=(p.area||"PRATICA").toUpperCase();
  const urgency=urgencyMeta(p);
  const number=p.numero_principale||p.rg||p.rgnr||p.sius||p.siep||'';
  const authority=p.autorita||p.tribunale||'';
  const type=p.tipologia||p.tipologia_difesa||p.oggetto||'';
  const status=p.stato||"In corso";
  return `<article class="practice-card practice-card-v18 ${escapeHtml(p.area||"")}" data-practice="${escapeHtml(p.id)}" role="button" tabindex="0" aria-label="Apri scheda pratica ${escapeHtml(p.assistito||'')}">
    <div class="practice-shell">
      <div class="practice-top modern-practice-top">
        <div class="practice-avatar">${escapeHtml((p.assistito||'P').trim().slice(0,1).toUpperCase())}</div>
        <div class="practice-maincopy">
          <div class="practice-meta-row">
            <span class="area-badge area-${escapeHtml(matter)}">${escapeHtml(matter)}</span>
            <span class="urgency-badge ${escapeHtml(urgency.tone)}">${escapeHtml(urgency.label)}</span>
          </div>
          <h3>${escapeHtml(p.assistito||"Assistito non indicato")}</h3>
          <div class="practice-subline">${escapeHtml(type||'Fascicolo operativo')}</div>
        </div>
        <span class="status-badge status-modern">${escapeHtml(status)}</span>
      </div>
      <div class="practice-chip-row">
        ${number?`<span class="info-chip">${escapeHtml(number)}</span>`:''}
        ${authority?`<span class="info-chip">${escapeHtml(authority)}</span>`:''}
        ${p.fase?`<span class="info-chip soft">${escapeHtml(p.fase)}</span>`:''}
      </div>
      <div class="practice-grid practice-grid-modern">
        ${practiceMetric("Numero", number || '—')}
        ${practiceMetric("Autorità", authority || '—')}
        ${practiceMetric("Controparte", p.controparte || '—')}
        ${practiceMetric("Fase", p.fase || '—')}
      </div>
      <div class="practice-schedule-panel">
        <div class="schedule-box hearing-box">
          <small>Prossima udienza</small>
          <strong>${hearing?`${fmtDate(hearing.event_date)}${hearing.start_time?` · ${escapeHtml(hearing.start_time)}`:''}`:"—"}</strong>
        </div>
        <div class="schedule-box deadline-box">
          <small>Prossima attività</small>
          <strong>${deadline?`${fmtDate(deadline.event_date)} · ${escapeHtml(deadline.title||"")}`:"—"}</strong>
        </div>
      </div>
      <div class="practice-action-row action-row-modern">
        <span class="practice-pill">Apri scheda</span>
        <span class="practice-pill muted">Documenti · Banca giuridica</span>
      </div>
    </div>
  </article>`;
}
function fieldHtml(label,value){
  return nonEmpty(value)?`<div class="field"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`:"";
}
function renderPractices(){
  const query=normalize($("practiceSearch").value);
  const filter=activePracticeFilter;
  const all=snapshot?.practices||[];
  const filtered=all.filter(p=>{
    if(query&&!searchBlob(p).includes(query))return false;
    if(filter==="PENALE" && p.area!=="PENALE")return false;
    if(filter==="CIVILE" && p.area!=="CIVILE")return false;
    if(filter==="office" && !normalize(`${p.tipologia_difesa} ${p.stato_difesa}`).includes("ufficio"))return false;
    return true;
  });
  const root=$("practiceCards");
  if(!query.trim()){
    root.innerHTML=`<div class="practices-search-blank"><div class="search-mark">⌕</div><h3>Cerca una pratica</h3><p>Inserisci un nome, un numero RG/RGNR oppure l’autorità. I fascicoli restano riservati fino alla ricerca.</p><small>${all.length} pratiche disponibili nell'archivio offline</small></div>`;
  } else {
    root.innerHTML=`<div class="practice-results-head"><strong>${filtered.length}</strong><span>${filtered.length===1?'risultato':'risultati'}</span></div>${filtered.length?filtered.slice(0,60).map(p=>{
      const matter=(p.area||'PRATICA').toUpperCase();
      const number=p.numero_principale||p.rg||p.rgnr||p.siep||p.sius||'';
      return `<button class="practice-search-result" data-practice="${escapeHtml(p.id)}"><span class="practice-search-letter">${escapeHtml((p.assistito||'P').slice(0,1).toUpperCase())}</span><span class="practice-search-info"><small>${escapeHtml(matter)} ${number?' · '+escapeHtml(number):''}</small><strong>${escapeHtml(p.assistito||'Pratica')}</strong><em>${escapeHtml(p.tipologia||p.oggetto||p.autorita||'Apri fascicolo')}</em></span><span class="practice-search-go">›</span></button>`;
    }).join(''):'<div class="empty">Nessuna pratica corrisponde alla ricerca.</div>'}`;
  }
  bindPracticeLinks(root);
  document.querySelectorAll("[data-practice-filter]").forEach(button=>button.classList.toggle("active",button.dataset.practiceFilter===filter));
}

function renderActivities(){
  const today=plannerLocalToday();
  const events=calendarItems().filter(e=>(e.source_type==="TASK"||e.source_type==="DEADLINE"||e.category==="SCADENZA"||String(e.category||"").includes("CRESET"))&&(e.event_date||"")>=today).sort(eventSort);
  const todayItems=events.filter(e=>e.event_date===today), future=events.filter(e=>e.event_date>today);
  $("activitiesContent").innerHTML=`<div class="section-head"><h2>Da fare oggi</h2></div>${todayItems.length?todayItems.map(eventCard).join(""):'<div class="empty">Nessuna attività oggi</div>'}<div class="section-head"><h2>Prossime attività</h2></div>${future.length?future.map(eventCard).join(""):'<div class="empty">Nessuna attività futura</div>'}`;
  bindPracticeLinks($("activitiesContent"));
}
function actionsFor(actionType,targetId){
  return pendingMobileActions.filter(a=>{
    if(actionType&&a.action_type!==actionType)return false;
    const target=a.target_id??a.checklist_item_id??a.hearing_checklist_item_id??a.position_id??a.hearing_id??a.task_id;
    return targetId===undefined||String(target)===String(targetId);
  }).sort((a,b)=>String(a.action_at||"").localeCompare(String(b.action_at||"")));
}
function latestAction(actionType,targetId){const list=actionsFor(actionType,targetId);return list.length?list[list.length-1]:null}
function pendingStateFor(itemId){
  const actions=pendingMobileActions.filter(a=>a.checklist_item_id===itemId).sort((a,b)=>String(a.action_at).localeCompare(String(b.action_at)));
  return actions.length?actions[actions.length-1].new_status:null;
}

async function queueMobileAction(action){
  const normalized={
    action_id:uid(),action_at:new Date().toISOString(),device_id:deviceId(),sync_status:"DA_ESPORTARE",
    source_archive_id:snapshot?.archive_id||"",source_generated_at:snapshot?.generated_at||"",companion_version:COMPANION_BUILD,
    ...action
  };
  if(!normalized.target_id)normalized.target_id=normalized.mobile_uid||normalized.checklist_item_id||normalized.hearing_checklist_item_id||normalized.position_id||normalized.hearing_id||normalized.task_id||"";
  await storePut("pending_mobile_actions",normalized);
  pendingMobileActions.push(normalized);
  updatePendingIndicator();
  return normalized;
}
function effectiveChecklistItems(){
  return (snapshot?.checklistItems||[]).map(item=>({...item,status:pendingStateFor(item.checklist_item_id)||item.status}));
}
async function setChecklistItemStatus(item,newStatus){
  const previous=pendingStateFor(item.checklist_item_id)||item.status||"DA_FARE";
  await queueMobileAction({action_type:newStatus==="COMPLETATA"?"complete_checklist_item":"reopen_checklist_item",checklist_item_id:item.checklist_item_id,target_id:item.checklist_item_id,previous_status:previous,new_status:newStatus,base_updated_at:item.updated_at||"",completed_at:newStatus==="COMPLETATA"?new Date().toISOString():null});
  renderChecklists();
  const toast=$("undoToast"); toast.classList.remove("hidden");
  $("undoAction").onclick=async()=>{await setChecklistItemStatus(item,previous);toast.classList.add("hidden")};
  setTimeout(()=>toast.classList.add("hidden"),5000);
}
function openChecklistComposer(){
  const today=plannerLocalToday();
  if($("checklistComposerTitle"))$("checklistComposerTitle").value="";
  if($("checklistComposerDate"))$("checklistComposerDate").value=today;
  if($("checklistComposerPriority"))$("checklistComposerPriority").value="MEDIA";
  if($("checklistComposerPractice"))$("checklistComposerPractice").value="";
  if($("checklistComposerItems"))$("checklistComposerItems").value="";
  $("checklistComposerModal")?.classList.remove("hidden");
  setTimeout(()=>$("checklistComposerTitle")?.focus(),20);
}
function closeChecklistComposer(){
  $("checklistComposerModal")?.classList.add("hidden");
}
async function saveChecklistComposer(){
  const title=$("checklistComposerTitle")?.value?.trim();
  if(!title){alert("Indicare il titolo della checklist.");return}
  const checklistDate=isoDate($("checklistComposerDate")?.value);
  if(!checklistDate){alert("Data non valida.");return}
  const practiceText=$("checklistComposerPractice")?.value?.trim()||"";
  let practiceId="";
  if(practiceText){
    const needle=normalize(practiceText);
    const matches=(snapshot?.practices||[]).filter(p=>normalize([p.client,p.internal_code,p.rgnr,p.sius,p.siep].filter(Boolean).join(" ")).includes(needle));
    if(matches.length!==1){alert(matches.length?"Sono state trovate più pratiche: indicare un codice più preciso oppure lasciare il campo vuoto.":"Pratica non riconosciuta. Lasciare vuoto oppure indicare assistito/codice esatto.");return}
    practiceId=matches[0].id||matches[0].practice_id||"";
  }
  const pasted=$("checklistComposerItems")?.value||"";
  const items=String(pasted).split(/\r?\n/).map(x=>parseMobileChecklistLine(x,checklistDate)).filter(Boolean);
  if(!items.length){alert("Incolla almeno una voce della checklist.");return}
  const mobileUid=uid();
  await queueMobileAction({action_type:"upsert_checklist",mobile_uid:mobileUid,target_id:mobileUid,payload:{title,date:checklistDate,priority:$("checklistComposerPriority")?.value||"MEDIA",practice_id:practiceId,items}});
  closeChecklistComposer();
  checklistMode="todo";
  $("checklistTodo")?.classList.add("active");
  $("checklistDone")?.classList.remove("active");
  renderChecklists();
  switchView("checklistsView");
  alert("Checklist registrata. Potrai spuntarla dal telefono ed esportarla poi verso il gestionale.");
}
async function addMobileChecklist(){openChecklistComposer();
}
function parseMobileChecklistLine(raw,commonDate){
  let text=String(raw||"").trim().replace(/^\s*(?:[-•*☐☑✓]+|\d+[.)]|\[[ xX]?\])\s*/,"");if(!text)return null;
  let dueDate=commonDate||"",dueTime="";
  const dm=text.match(/\b(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?\b/);
  if(dm){let year=dm[3]?Number(dm[3]):Number((commonDate||plannerLocalToday()).slice(0,4));if(year<100)year+=2000;dueDate=`${year}-${String(Number(dm[2])).padStart(2,"0")}-${String(Number(dm[1])).padStart(2,"0")}`;text=text.replace(dm[0]," ")}
  const tm=text.match(/\b(?:alle\s+ore|ore|alle)?\s*([01]?\d|2[0-3])[:.]([0-5]\d)\b/i)||text.match(/\b(?:alle\s+ore|ore|alle)\s+([01]?\d|2[0-3])\b/i);
  if(tm){dueTime=`${String(Number(tm[1])).padStart(2,"0")}:${String(Number(tm[2]||0)).padStart(2,"0")}`;text=text.replace(tm[0]," ")}
  text=text.replace(/^[\s|,:;–—-]+|[\s|,:;–—-]+$/g,"").trim();return text?{title:text,due_date:dueDate,due_time:dueTime,priority:"MEDIA",notes:""}:null;
}
function renderChecklists(){
  const root=$("checklistsContent"); if(!root||!snapshot)return;
  const pendingLists=pendingMobileActions.filter(a=>a.action_type==="upsert_checklist").map(a=>({checklist_id:a.mobile_uid||a.target_id,title:a.payload?.title||"Checklist",date:a.payload?.date||"",priority:a.payload?.priority||"MEDIA",practice_name:"Da sincronizzare",pending:true}));
  const pendingItems=pendingLists.flatMap(list=>{const action=pendingMobileActions.find(a=>a.action_type==="upsert_checklist"&&(a.mobile_uid||a.target_id)===list.checklist_id);return (action?.payload?.items||[]).map((item,index)=>({checklist_item_id:`${list.checklist_id}:${index}`,checklist_id:list.checklist_id,title:typeof item==="string"?item:item.title,status:"DA_FARE",due_date:typeof item==="string"?list.date:(item.due_date||list.date),due_time:typeof item==="string"?"":(item.due_time||""),order:index,pending:true}))});
  const lists=[...(snapshot.checklists||[]),...pendingLists.filter(p=>!(snapshot.checklists||[]).some(s=>String(s.checklist_id)===String(p.checklist_id)))]; const items=[...effectiveChecklistItems(),...pendingItems];
  const html=[];
  lists.forEach(list=>{
    const li=items.filter(i=>i.checklist_id===list.checklist_id).sort((a,b)=>(a.order||0)-(b.order||0));
    const done=li.filter(i=>i.status==="COMPLETATA").length; const total=li.length; const pct=total?Math.round(done*100/total):0;
    const visible=li.filter(i=>checklistMode==="done"?i.status==="COMPLETATA":i.status!=="COMPLETATA"&&i.status!=="ANNULLATA");
    if(checklistMode==="todo"&&!visible.length&&total&&done===total)return;
    html.push(`<article class="checklist-card"><div class="checklist-head"><div><h3>${escapeHtml(list.title)}</h3><p>${escapeHtml([list.date,list.priority,list.practice_name].filter(Boolean).join(" · "))}${list.pending?' · DA ESPORTARE':''}</p></div><strong>${done}/${total} · ${pct}%</strong></div><div class="progress"><span style="width:${pct}%"></span></div>${visible.length?visible.map(item=>`<label class="check-item"><input type="checkbox" data-check-item="${item.checklist_item_id}" ${item.status==="COMPLETATA"?"checked":""} ${item.pending?'disabled':''}><span>${escapeHtml([item.due_date,item.due_time,item.title].filter(Boolean).join(" · "))}</span></label>`).join(""):'<div class="empty small">Nessuna voce in questa sezione</div>'}${list.pending?`<button data-remove-pending-checklist="${escapeHtml(list.checklist_id)}">Elimina bozza</button>`:""}</article>`);
  });
  root.innerHTML=html.join("")||'<div class="empty">Nessuna checklist disponibile</div>';
  root.querySelectorAll("[data-check-item]").forEach(cb=>{cb.onchange=()=>{const item=items.find(i=>String(i.checklist_item_id)===String(cb.dataset.checkItem));setChecklistItemStatus(item,cb.checked?"COMPLETATA":"DA_FARE")}});
  root.querySelectorAll("[data-remove-pending-checklist]").forEach(button=>button.onclick=async()=>{const id=button.dataset.removePendingChecklist;for(const action of pendingMobileActions.filter(a=>a.action_type==="upsert_checklist"&&String(a.mobile_uid||a.target_id)===String(id)))await storeDelete("pending_mobile_actions",action.action_id);pendingMobileActions=pendingMobileActions.filter(a=>!(a.action_type==="upsert_checklist"&&String(a.mobile_uid||a.target_id)===String(id)));renderChecklists()});
}
function effectiveHearingChecklistStatus(item){
  const action=latestAction("hearing_checklist_status",item.id)||latestAction("complete_hearing_checklist_item",item.id)||latestAction("reopen_hearing_checklist_item",item.id);
  return action?.new_status||item.status||"DA_FARE";
}
async function setHearingChecklistItemStatus(item,newStatus){
  const previous=effectiveHearingChecklistStatus(item);
  await queueMobileAction({action_type:"hearing_checklist_status",hearing_checklist_item_id:item.id,target_id:item.id,hearing_id:item.hearing_id,practice_id:item.practice_id,previous_status:previous,new_status:newStatus,base_updated_at:item.updated_at||"",completed_at:newStatus==="COMPLETATA"?new Date().toISOString():null});
  renderPlugins();
}
function latestCresetStatusAction(id){
  const actions=pendingMobileActions.filter(a=>["creset_mark_worked","creset_mark_constituted","creset_set_status"].includes(a.action_type)&&String(a.position_id??a.target_id)===String(id)).sort((a,b)=>String(a.action_at||"").localeCompare(String(b.action_at||"")));
  return actions.length?actions[actions.length-1]:null;
}
function effectiveCresetStatus(item){
  return String(latestCresetStatusAction(item.id)?.new_status||item.status||"DA LAVORARE").toUpperCase().replace(/_/g," ");
}
async function setCresetStatus(item,status){
  const desired=String(status||"").toUpperCase().replace(/_/g," ");
  const allowed=new Set(["DA LAVORARE","IN LAVORAZIONE","LAVORATA","COSTITUITA","ARCHIVIATA"]);
  if(!allowed.has(desired))return alert("Stato Creset non valido.");
  const terminal=new Set(["LAVORATA","COSTITUITA","ARCHIVIATA"]);
  if(terminal.has(desired)&&!confirm(`Impostare ${item.taxpayer||item.rg_number||item.id} come ${desired}? La modifica sarà applicata al desktop dopo l'importazione del file risposte.`))return;
  await queueMobileAction({action_type:"creset_set_status",position_id:item.id,target_id:item.id,new_status:desired,base_updated_at:item.updated_at||""});
  renderPlugins();
}
async function markCresetWorked(item){return setCresetStatus(item,"LAVORATA")}
async function markCresetConstituted(item){return setCresetStatus(item,"COSTITUITA")}
function pluginChip(p){return `<span class="plugin-chip">${escapeHtml(p.icon||"◇")} ${escapeHtml(p.label||p.name||p.key||"Plugin")}</span>`}
function hearingEventById(id){return (snapshot?.events||[]).find(e=>e.source_type==="HEARING"&&String(e.source_id)===String(id))}
function diagnosticBadge(d){
  const severity=String(d?.severity||"INFO").toUpperCase();
  const label=severity==="ERROR"?"DA COMPLETARE":severity==="WARNING"?"VERIFICA":"INFO";
  return `<div class="diagnostic ${severity.toLowerCase()}"><strong>${label}</strong><span>${escapeHtml(d?.message||"")}</span></div>`;
}
function planGroup(title,items,cssClass){
  if(!items.length)return "";
  return `<div class="mobile-plan-group ${cssClass||""}"><div class="mobile-plan-title">${escapeHtml(title)} <span>${items.length}</span></div>${items.map(x=>{
    const verify=x.verification_status&&x.verification_status!=="NON_RICHIESTA"?`<span class="verification-pill">${escapeHtml(x.verification_status)}</span>`:"";
    const source=x.legal_source?`<small>${escapeHtml(x.legal_source)}</small>`:"";
    const explanation=x.explanation?`<details><summary>Come è stata determinata</summary><p>${escapeHtml(x.explanation)}</p></details>`:"";
    return `<div class="mobile-plan-item"><div><strong>${escapeHtml(fmtDate(x.due_date||""))} · ${escapeHtml(x.title||"")}</strong>${source}</div>${verify}${explanation}</div>`;
  }).join("")}</div>`;
}
function effectiveReadiness(checks){
  const applicable=checks.filter(i=>String(i.status||"")!=="NON_APPLICABILE");
  const required=applicable.filter(i=>i.required);
  const doneRequired=required.filter(i=>effectiveHearingChecklistStatus(i)==="COMPLETATA");
  const doneAll=applicable.filter(i=>effectiveHearingChecklistStatus(i)==="COMPLETATA");
  return {total:applicable.length,done:doneAll.length,required:required.length,requiredOpen:Math.max(0,required.length-doneRequired.length)};
}
function renderHearingTool(){
  const root=$("hearingTool"); if(!root||!snapshot)return;
  const today=plannerLocalToday();
  const hearings=(snapshot.events||[]).filter(e=>e.source_type==="HEARING"&&(e.event_date||"")>=today).sort(eventSort).slice(0,20);
  if(!hearings.length){root.innerHTML='<div class="empty">Nessuna udienza futura sincronizzata.</div>';return}
  root.innerHTML=`<div class="companion-intro"><strong>Udienza intelligente</strong><span>Profilo processuale, piano, checklist ed esito sono disponibili offline. Le modifiche rientrano nel gestionale solo tramite importazione controllata.</span></div>`+hearings.map(h=>{
    const id=h.source_id;
    const p=practiceById(h.practice_id);
    const checks=(snapshot.hearingChecklistItems||[]).filter(i=>String(i.hearing_id)===String(id));
    const ready=effectiveReadiness(checks);
    const plans=(snapshot.hearingPlans||[]).filter(x=>String(x.hearing_id)===String(id));
    const legal=plans.filter(x=>x.legal_deadline||String(x.work_class||"").toUpperCase()==="SCADENZA_EFFETTIVA");
    const prep=plans.filter(x=>String(x.work_class||"").toUpperCase()==="PREPARAZIONE");
    const controls=plans.filter(x=>!["SCADENZA_EFFETTIVA","PREPARAZIONE"].includes(String(x.work_class||"").toUpperCase()));
    const diagnostics=Array.isArray(h.diagnostics)?h.diagnostics:[];
    const hardDiagnostics=diagnostics.filter(d=>String(d.severity||"").toUpperCase()==="ERROR").length;
    const pending=actionsFor(null,id).some(a=>["hearing_note","hearing_outcome"].includes(a.action_type));
    const profile=(h.detected_profile||h.workflow_profile||"Profilo non definito").replaceAll("_"," ");
    const readinessLabel=hardDiagnostics?`${hardDiagnostics} dati mancanti`:ready.requiredOpen===0?"PRONTA":`${ready.requiredOpen} verifiche`;
    const readinessClass=hardDiagnostics?"blocked":ready.requiredOpen===0?"ready":"";
    return `<article class="hearing-mobile-card" data-hearing-card="${escapeHtml(id)}">
      <div class="readiness-row"><div><div class="eyebrow dark">${escapeHtml(fmtDate(h.event_date))}${h.start_time?` · ${escapeHtml(h.start_time)}`:""}</div><h3>${escapeHtml(p?.assistito||h.title||"Udienza")}</h3></div><span class="readiness-badge ${readinessClass}">${escapeHtml(readinessLabel)}</span></div>
      <div class="profile-strip"><strong>${escapeHtml(profile)}</strong><span>${escapeHtml([h.party_role_detected||h.procedural_role,h.hearing_phase,h.location].filter(Boolean).join(" · "))}</span></div>
      ${diagnostics.length?`<div class="diagnostics-box">${diagnostics.map(diagnosticBadge).join("")}</div>`:""}
      ${h.plan_notes?`<div class="hearing-plan strategy"><strong>Strategia / piano d'udienza</strong><span>${escapeHtml(h.plan_notes)}</span></div>`:'<div class="diagnostic info"><strong>PIANO</strong><span>Strategia d’udienza non compilata sul desktop.</span></div>'}
      ${h.documents_to_prepare?`<div class="hearing-plan"><strong>Documenti da predisporre</strong><span>${escapeHtml(h.documents_to_prepare)}</span></div>`:""}
      ${planGroup("Scadenze effettive",legal,"legal")}${planGroup("Preparazione",prep,"prep")}${planGroup("Controlli / follow-up",controls,"control")}
      <div class="readiness-summary"><div><strong>Preparazione</strong><span>${ready.done}/${ready.total} completate</span></div><div class="readiness-meter"><span style="width:${ready.total?Math.round(ready.done*100/ready.total):0}%"></span></div></div>
      ${checks.length?checks.map(item=>`<label class="mobile-check-item"><input type="checkbox" data-hearing-check="${escapeHtml(item.id)}" ${effectiveHearingChecklistStatus(item)==="COMPLETATA"?"checked":""}><span><strong>${escapeHtml(item.title)}${item.required?" *":""}</strong>${item.category?`<small>${escapeHtml(item.category)}</small>`:""}${item.notes?`<small>${escapeHtml(item.notes)}</small>`:""}</span></label>`).join(""):'<div class="muted">Checklist non disponibile.</div>'}
      <details class="mobile-outcome-sheet">
        <summary>Registra nota o esito dell’udienza</summary>
        <div class="inline-editor">
          <label>Nota rapida<textarea data-hearing-note-text rows="2" placeholder="Indicazioni del giudice, attività da ricordare, appunti"></textarea></label>
          <button data-hearing-note="${escapeHtml(id)}" class="secondary-button">Salva nota sul telefono</button>
        </div>
        <div class="inline-editor outcome-grid">
          <label>Esito<select data-hearing-outcome-value><option value="">Seleziona</option><option value="RINVIO">Rinvio</option><option value="DISCUSSIONE">Discussione</option><option value="RISERVA">Riserva</option><option value="SENTENZA">Decisione / sentenza</option><option value="CTU AMMESSA">CTU ammessa</option><option value="TERMINI CONCESSI">Termini concessi</option><option value="ALTRO">Altro</option></select></label>
          <label>Nuova udienza<input data-next-hearing type="date"></label>
          <label>Ora nuova udienza<input data-next-hearing-time type="time"></label>
          <label>Motivo rinvio<input data-adjournment-reason type="text" placeholder="eventuale"></label>
          <label class="full-span"><input data-terms-granted type="checkbox"> Il giudice ha concesso termini</label>
          <label class="full-span">Provvedimenti / termini esatti<textarea data-judge-orders rows="3" placeholder="Trascrivere quanto indicato dal giudice o dal provvedimento. Il Companion non calcola automaticamente una scadenza da questo testo."></textarea></label>
          <label class="full-span">Attività svolte / conclusioni<textarea data-performed-activities rows="2"></textarea></label>
          <button data-hearing-outcome="${escapeHtml(id)}" class="full-span">Registra esito da validare sul desktop</button>
          ${pending?'<span class="pending-pill full-span">modifiche da sincronizzare</span>':""}
        </div>
      </details>
    </article>`;
  }).join("");
  root.querySelectorAll("[data-hearing-check]").forEach(cb=>cb.onchange=()=>{
    const item=(snapshot.hearingChecklistItems||[]).find(i=>String(i.id)===String(cb.dataset.hearingCheck));
    if(item)setHearingChecklistItemStatus(item,cb.checked?"COMPLETATA":"DA_FARE");
  });
  root.querySelectorAll("[data-hearing-note]").forEach(btn=>btn.onclick=async()=>{
    const card=btn.closest("[data-hearing-card]"); const note=card.querySelector("[data-hearing-note-text]").value.trim(); if(!note)return alert("Scrivere la nota.");
    const h=hearingEventById(btn.dataset.hearingNote);
    await queueMobileAction({action_type:"hearing_note",hearing_id:h.source_id,target_id:h.source_id,practice_id:h.practice_id,note,base_updated_at:h.updated_at||""});
    card.querySelector("[data-hearing-note-text]").value=""; renderPlugins();
  });
  root.querySelectorAll("[data-hearing-outcome]").forEach(btn=>btn.onclick=async()=>{
    const card=btn.closest("[data-hearing-card]"); const h=hearingEventById(btn.dataset.hearingOutcome);
    const outcome=card.querySelector("[data-hearing-outcome-value]").value;
    const next=card.querySelector("[data-next-hearing]").value;
    const nextTime=card.querySelector("[data-next-hearing-time]").value;
    const reason=card.querySelector("[data-adjournment-reason]").value.trim();
    const termsGranted=card.querySelector("[data-terms-granted]").checked;
    const orders=card.querySelector("[data-judge-orders]").value.trim();
    const performed=card.querySelector("[data-performed-activities]").value.trim();
    if(!outcome&&!next&&!orders&&!performed)return alert("Indicare almeno l'esito o un provvedimento.");
    if(next&&!String(outcome).toUpperCase().includes("RINVIO")&&!confirm("Hai indicato una nuova data senza selezionare Rinvio. Registrare comunque?"))return;
    const outcomeCategory={"RINVIO":"RINVIO","DISCUSSIONE":"DISCUSSIONE","RISERVA":"RISERVA","SENTENZA":"DECISIONE/SENTENZA","CTU AMMESSA":"CTU","TERMINI CONCESSI":"TERMINI GIUDICE","ALTRO":"ALTRO"}[outcome]||outcome;
    await queueMobileAction({
      action_type:"hearing_outcome",hearing_id:h.source_id,target_id:h.source_id,practice_id:h.practice_id,
      outcome,outcome_category:outcomeCategory,next_hearing_date:next,next_hearing_time:nextTime,adjournment_reason:reason,
      terms_granted:termsGranted?"SÌ":"",judge_orders:orders,performed_activities:performed,note:"",base_updated_at:h.updated_at||""
    });
    renderPlugins();
  });
}
function renderCresetTool(){
  const root=$("cresetTool"); if(!root||!snapshot)return;
  const all=snapshot.creset||[];
  const terminal=new Set(["LAVORATA","COSTITUITA","ARCHIVIATA","COMPLETATA","CHIUSA"]);
  const items=all.filter(item=>!terminal.has(effectiveCresetStatus(item)));
  root.innerHTML=`<div class="tool-card"><div class="section-head stacked compact-head"><div><h3>Creset</h3><p class="muted">Gestione operativa delle posizioni sincronizzate. Le modifiche vengono applicate al desktop solo dopo l'importazione del file risposte.</p></div></div>${items.length?items.map(item=>{
    const current=effectiveCresetStatus(item);
    return `<article class="creset-mobile-card"><div class="readiness-row"><h3>${escapeHtml(item.taxpayer||"Posizione Creset")}</h3><span class="readiness-badge">${escapeHtml(current)}</span></div><div class="creset-meta">${escapeHtml([item.municipality,item.rg_number&&`RG ${item.rg_number}`,item.verification_due_date&&`Verifica ${fmtDate(item.verification_due_date)}`,item.preparation_due_date&&`Preparazione ${fmtDate(item.preparation_due_date)}`,item.filing_due_date&&`Deposito ${fmtDate(item.filing_due_date)}`,item.hearing_date&&`Udienza ${fmtDate(item.hearing_date)}${item.hearing_time?` ${item.hearing_time}`:""}`,item.participation_mode&&`Partecipazione: ${item.participation_mode}`].filter(Boolean).join(" · "))}</div>${item.criticality?`<p><strong>Criticità:</strong> ${escapeHtml(item.criticality)}</p>`:""}${item.notes?`<p>${escapeHtml(item.notes)}</p>`:""}<div class="creset-status-row"><select class="tool-input" data-creset-status="${escapeHtml(item.id)}"><option ${current==="DA LAVORARE"?"selected":""}>DA LAVORARE</option><option ${current==="IN LAVORAZIONE"?"selected":""}>IN LAVORAZIONE</option><option ${current==="LAVORATA"?"selected":""}>LAVORATA</option><option ${current==="COSTITUITA"?"selected":""}>COSTITUITA</option><option ${current==="ARCHIVIATA"?"selected":""}>ARCHIVIATA</option></select><button data-creset-save="${escapeHtml(item.id)}">Aggiorna stato</button></div></article>`;
  }).join(""):'<div class="empty">Nessuna posizione Creset attiva.</div>'}</div>`;
  root.querySelectorAll("[data-creset-save]").forEach(btn=>btn.onclick=()=>{const item=all.find(x=>String(x.id)===String(btn.dataset.cresetSave));const card=btn.closest(".creset-mobile-card");const select=card?.querySelector("[data-creset-status]");if(item&&select)setCresetStatus(item,select.value)});
}

function renderLegalResults(){
  const root=$("legalResults"); if(!root||!snapshot)return;
  const query=normalize($("legalSearch")?.value||"");
  const type=String($("legalTypeFilter")?.value||"").toUpperCase();
  const rows=(snapshot.legalLibrary||[]).filter(r=>{
    if(type&&String(r.item_type||"NORMA").toUpperCase()!==type)return false;
    return !query||normalize([r.title,r.item_type,r.matter,r.submatter,r.keywords,r.code_name,r.article_number,r.heading,r.summary,r.text_body,r.notes,r.source_name,r.authority,r.decision_number].filter(Boolean).join(" ")).includes(query);
  }).slice(0,80);
  root.innerHTML=rows.length?rows.map(r=>{
    const title=r.title||[r.code_name,r.article_number&&`art. ${r.article_number}`,r.heading].filter(Boolean).join(" · ")||"Voce banca giuridica";
    const meta=[r.item_type,r.matter,r.authority||r.source_name,r.decision_number&&`n. ${r.decision_number}`,r.decision_date&&fmtDate(r.decision_date),r.effective_from&&`dal ${fmtDate(r.effective_from)}`,r.verification_status].filter(Boolean).join(" · ");
    const preview=r.summary||r.text_body||r.notes||"";
    return `<details class="legal-hit"><summary><span>${r.favorite?"★ ":""}${escapeHtml(title)}</span><small>${escapeHtml(meta)}</small></summary>${r.summary?`<div class="legal-summary"><strong>Sintesi</strong><p>${escapeHtml(r.summary)}</p></div>`:""}${r.text_body?`<div class="legal-full"><strong>Testo</strong><p>${escapeHtml(r.text_body)}</p></div>`:""}${r.notes?`<div class="legal-notes"><strong>Note Studio</strong><p>${escapeHtml(r.notes)}</p></div>`:""}${!r.summary&&!r.text_body&&preview?`<p>${escapeHtml(preview)}</p>`:""}${/^https:\/\//i.test(String(r.source_url||r.url||""))?`<a class="legal-source-action" href="${escapeHtml(String(r.source_url||r.url))}" target="_blank" rel="noopener noreferrer">Apri fonte registrata ↗</a>`:""}</details>`;
  }).join(""):'<div class="empty small">Nessun risultato nella banca giuridica sincronizzata.</div>';
}
function calculateQuickTerm(){
  const start=$("termStartDate").value; const days=Math.max(0,Number($("termDays").value||0)); const direction=Number($("termDirection").value||1); if(!start)return alert("Indicare la data di partenza.");
  const d=new Date(`${start}T12:00:00`); d.setDate(d.getDate()+direction*days); $("termResult").textContent=`${fmtDate(CompanionCore.localDate(d))} · calcolo di calendario non certificato`;
}
