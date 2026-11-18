function eventSort(a,b){
  return `${a.event_date||""} ${a.start_time||""}`.localeCompare(`${b.event_date||""} ${b.start_time||""}`);
}

function eventCard(event){
  const linked=event.practice_id&&practiceById(event.practice_id);
  const dateText=event.event_date?`${fmtWeekday(event.event_date)} ${fmtDate(event.event_date)}`:"Data non indicata";
  const overdue=(event.event_date||"")<plannerLocalToday()&&["TASK","DEADLINE"].includes(String(event.source_type||"").toUpperCase());
  const hearingAction=event.source_type==="HEARING"
    ?`<button class="secondary-button compact-action" data-hearing-manage="${escapeHtml(event.source_id||"")}">Esito / rinvio</button>`:"";
  return `<article class="event ${escapeHtml(eventKind(event))}">
    <div class="event-date-row"><span class="event-date">${escapeHtml(dateText)}</span><span class="event-category">${escapeHtml(eventKind(event))}</span></div>
    <div class="event-top"><span class="event-time">${escapeHtml(event.start_time||"Tutto il giorno")}${event.end_time?` – ${escapeHtml(event.end_time)}`:""}</span></div>
    <h3>${escapeHtml(event.title||"Impegno")}</h3>
    ${event.location?`<div class="event-meta">📍 ${escapeHtml(event.location)}</div>`:""}
    ${overdue?`<div class="event-meta overdue">Scaduta / arretrata: ${escapeHtml(fmtDate(event.event_date))}</div>`:""}
    ${event.notes?`<div class="event-meta">${escapeHtml(event.notes)}</div>`:""}
    ${!linked&&event.practice_name?`<div class="event-meta practice-inline">⚖ ${escapeHtml(event.practice_name)}${event.practice_code?` · ${escapeHtml(event.practice_code)}`:""}</div>`:""}
    <div class="local-actions">
      ${hearingAction}
      ${event.source_type==="LOCAL"?`<span class="local-badge">DA SINCRONIZZARE</span><span><button data-local-edit="${escapeHtml(event.id||"")}">Modifica</button></span>`:""}
      ${(event.source_type==="TASK"||event.source_type==="DEADLINE")?`<button data-task-complete="${escapeHtml(event.source_id??event.task_id??event.id??"")}" data-task-updated="${escapeHtml(event.updated_at||"")}">Fatta</button>`:""}
    </div>
    ${linked?`<button class="practice-link" data-practice="${escapeHtml(linked.id)}">Apri ${escapeHtml(linked.assistito||"pratica")}</button>`:""}
  </article>`;
}

function openTool(tool){ activeTool=tool; switchView("toolsView"); }

function bindPracticeLinks(root=document){
  root.querySelectorAll("[data-practice]").forEach(button=>{
    button.onclick=(event)=>{event.stopPropagation();openPractice(button.dataset.practice)};
    if(button.matches(".practice-card"))button.onkeydown=(event)=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();openPractice(button.dataset.practice)}};
  });
  root.querySelectorAll("[data-local-edit]").forEach(button=>button.onclick=()=>openLocalTask(button.dataset.localEdit));
  root.querySelectorAll("[data-hearing-manage]").forEach(button=>button.onclick=()=>openHearingOutcome(button.dataset.hearingManage));
  root.querySelectorAll("[data-task-complete]").forEach(button=>button.onclick=async()=>{
    const taskId=button.dataset.taskComplete;if(!taskId)return;
    await queueMobileAction({action_type:"complete_task",task_id:taskId,target_id:taskId,new_status:"COMPLETATA",base_updated_at:button.dataset.taskUpdated||"",completed_at:new Date().toISOString()});
    updatePendingIndicator();renderAll();
  });
}
function eventKind(event){
  const category=String(event?.category||"").toUpperCase();
  const source=String(event?.source_type||"").toUpperCase();
  if(source==="APPOINTMENT"||category.includes("APPUNTAMENTO"))return "APPUNTAMENTO";
  if(category.includes("CRESET"))return "CRESET";
  if(source==="HEARING"||source==="MEDIATION"||category.includes("MEDIAZ"))return "UDIENZA";
  if(source==="DEADLINE")return "SCADENZA";
  if(source==="TASK"){
    if(category.includes("PREPARATOR")||category.includes("PREPARAZIONE"))return "PREPARAZIONE";
    if(category.includes("SCADENZA")||category.includes("TERMINE"))return "SCADENZA";
    return "ATTIVITÀ";
  }
  if(source==="LOCAL"){
    if(category.includes("UDIENZA"))return "UDIENZA";
    if(category.includes("SCADENZA"))return "SCADENZA";
    return "ATTIVITÀ";
  }
  if(category.includes("PREPARATOR")||category.includes("PREPARAZIONE"))return "PREPARAZIONE";
  if(category.includes("SCADENZA"))return "SCADENZA";
  if(category.includes("UDIENZA"))return "UDIENZA";
  return "ATTIVITÀ";
}
function openChecklistCount(date){
  const lists=(snapshot?.checklists||[]).filter(l=>!l.archived&&String(l.date||"")===String(date));
  const items=snapshot?.checklistItems||[];
  return lists.reduce((n,l)=>n+items.filter(i=>String(i.checklist_id)===String(l.checklist_id)&&!["COMPLETATA","ANNULLATA"].includes(String(i.status||"").toUpperCase())).length,0);
}
function checklistDayHtml(date){
  const lists=(snapshot?.checklists||[]).filter(l=>!l.archived&&String(l.date||"")===String(date));
  const items=effectiveChecklistItems();
  const rows=[];
  for(const list of lists){
    for(const item of items.filter(i=>String(i.checklist_id)===String(list.checklist_id)&&!["COMPLETATA","ANNULLATA"].includes(String(i.status||"").toUpperCase()))){
      rows.push(`<label class="home-check-item"><input type="checkbox" data-check-item="${escapeHtml(item.checklist_item_id)}"><span><strong>${escapeHtml(item.title||"")}</strong><small>${escapeHtml([item.time||item.start_time,list.title,list.practice_name].filter(Boolean).join(" · "))}</small></span></label>`);
    }
  }
  return rows.length?`<div class="home-checklist">${rows.join("")}</div>`:'<div class="empty small">Nessuna checklist per questo giorno</div>';
}
function bindInlineChecklist(root){
  root.querySelectorAll("[data-check-item]").forEach(cb=>{cb.onchange=()=>{const item=effectiveChecklistItems().find(i=>String(i.checklist_item_id)===String(cb.dataset.checkItem));if(item)setChecklistItemStatus(item,cb.checked?"COMPLETATA":"DA_FARE")}});
}
function dayCounts(items,date){
  const counts={UDIENZA:0,APPUNTAMENTO:0,SCADENZA:0,CRESET:0,PREPARAZIONE:0};
  items.filter(e=>e.event_date===date).forEach(e=>{const k=eventKind(e);if(k in counts)counts[k]++});
  counts.CHECKLIST=openChecklistCount(date);
  return counts;
}
function weekOverview(items,start,selected,attribute){
  const days=Array.from({length:7},(_,i)=>addDays(start,i));
  return `<div class="week-strip">${days.map(ds=>{const c=dayCounts(items,ds);const total=Object.values(c).reduce((a,b)=>a+b,0);return `<button class="week-day-card ${ds===selected?"selected":""}" ${attribute}="${ds}"><span class="week-name">${escapeHtml(fmtWeekday(ds).slice(0,3))}</span><strong>${Number(ds.slice(-2))}</strong><small>${escapeHtml(fmtDate(ds).slice(3,5))}</small><div class="week-dots">${c.UDIENZA?`<i class="u">U${c.UDIENZA}</i>`:""}${c.APPUNTAMENTO?`<i class="a">A${c.APPUNTAMENTO}</i>`:""}${c.SCADENZA?`<i class="s">S${c.SCADENZA}</i>`:""}${c.CRESET?`<i class="c">C${c.CRESET}</i>`:""}${c.CHECKLIST?`<i class="k">✓${c.CHECKLIST}</i>`:""}${!total?'<i class="none">—</i>':""}</div></button>`}).join("")}</div>`;
}
function dayOperationalHtml(items,date){
  const day=items.filter(e=>e.event_date===date).sort(eventSort);
  const groups=[
    {kinds:["UDIENZA"],title:"Udienze",icon:"⚖",css:"UDIENZA"},
    {kinds:["APPUNTAMENTO"],title:"Appuntamenti",icon:"▣",css:"APPUNTAMENTO"},
    {kinds:["SCADENZA"],title:"Scadenze",icon:"◷",css:"SCADENZA"},
    {kinds:["PREPARAZIONE","ATTIVITÀ"],title:"Atti da preparare",icon:"▤",css:"PREPARAZIONE"},
    {kinds:["CRESET"],title:"Creset",icon:"◉",css:"CRESET"}
  ];
  const html=groups.map(group=>{
    const rows=day.filter(e=>group.kinds.includes(eventKind(e)));
    return `<section class="compact-day-section agenda-category-card kind-${group.css}">
      <h3><span class="agenda-card-icon">${group.icon}</span><span class="agenda-card-title">${group.title}</span><b>${rows.length}</b><em>Vedi tutti ›</em></h3>
      ${rows.length?rows.map(eventCard).join(""):'<div class="empty small">Nessuna voce</div>'}
    </section>`;
  }).join("");
  return `${html}<section class="compact-day-section agenda-category-card kind-CHECKLIST"><h3><span class="agenda-card-icon">✓</span><span class="agenda-card-title">Checklist</span><b>${openChecklistCount(date)}</b><em>Vedi tutte ›</em></h3>${checklistDayHtml(date)}</section>`;
}
function bindHomeControls(root){
  root.querySelectorAll("[data-home-mode]").forEach(button=>button.onclick=()=>{
    homeMode=button.dataset.homeMode||"week";
    homeAnchorDate=homeSelectedDate||homeAnchorDate||plannerLocalToday();
    renderHome();
  });
  root.querySelectorAll("[data-home-day]").forEach(button=>button.onclick=()=>{
    homeSelectedDate=button.dataset.homeDay;
    renderHome();
  });
  root.querySelectorAll("[data-home-month-day]").forEach(button=>button.onclick=()=>{
    homeSelectedDate=button.dataset.homeMonthDay;
    renderHome();
  });
  root.querySelectorAll("[data-home-nav]").forEach(button=>button.onclick=()=>{
    const step=Number(button.dataset.homeNav||0);
    homeAnchorDate=shiftPeriod(homeAnchorDate||plannerLocalToday(),homeMode||"week",step);
    homeSelectedDate=homeAnchorDate;
    renderHome();
  });
  root.querySelector("[data-home-today]")?.addEventListener("click",()=>{
    homeAnchorDate=plannerLocalToday();
    homeSelectedDate=homeAnchorDate;
    renderHome();
  });
  root.querySelector("#homeDate")?.addEventListener("change",event=>{
    homeAnchorDate=event.target.value||plannerLocalToday();
    homeSelectedDate=homeAnchorDate;
    renderHome();
  });
  bindPracticeLinks(root);
  bindInlineChecklist(root);
}

function homeGreeting(){
  const hour=new Date().getHours();
  if(hour<12)return "Buongiorno";
  if(hour<18)return "Buon pomeriggio";
  return "Buonasera";
}
function nextEventCardData(){
  const today=plannerLocalToday();
  const now=new Date();
  const items=calendarItems().sort(eventSort).filter(e=>{
    if(!e.event_date)return false;
    const dt=new Date(`${e.event_date}T${e.start_time||'23:59'}:00`);
    return dt>=new Date(now.getTime()-3600000);
  });
  return items[0]||null;
}
function countdownLabel(event){
  if(!event||!event.event_date)return "";
  const dt=new Date(`${event.event_date}T${event.start_time||'09:00'}:00`);
  const diff=dt.getTime()-Date.now();
  if(diff<=0)return "In corso o imminente";
  const h=Math.floor(diff/3600000);
  const m=Math.floor((diff%3600000)/60000);
  const d=Math.floor(h/24);
  if(d>0)return `tra ${d} g${d>1?'g':''}`;
  if(h>0)return `tra ${h} h ${m} min`;
  return `tra ${m} min`;
}
function quickToolCard(label, icon, view, badge=""){
  return `<button class="quick-tool-card" data-open-view="${view}"><span class="quick-tool-icon">${icon}</span><strong>${label}</strong>${badge?`<small>${badge}</small>`:""}</button>`;
}

let homeChecklistDays = 7;
function homeChecklistRows(day, days) {
  const end = addDays(day, days);
  const closed = /^(COMPLETAT[AO]|DEPOSITAT[AO]|ANNULLAT[AO]|CANCELLAT[AO]|ARCHIVIAT[AO]|CHIUS[AO]|ELIMINAT[AO])$/i;
  const rows = [];
  function add(due, status, title, time, practice, notes, source) {
    const italian = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(due || ''));
    if (italian) due = italian[3] + '-' + italian[2] + '-' + italian[1];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(due) || due < '2026-11-17' || due > end || closed.test(String(status || '').trim())) return;
    rows.push({due, title, time, practice, notes, source});
  }
  const deadlineIds = new Set((snapshot?.deadlines || []).map(t => String(t.source_id ?? t.task_id ?? t.id ?? t.uid)));
  const targets = plannerTargetMap();
  const deadlines = new Map((snapshot?.scadenze?.deadline_rows || []).map(r => [String(r.task_id), r]));
  const seen = new Set();
  const taskRows = [...(snapshot?.tasks || []), ...(snapshot?.deadlines || []), ...(snapshot?.events || []).filter(t => t.source_type === 'TASK' || t.source_type === 'DEADLINE')];
  for (const task of taskRows) {
    const id = task.source_id ?? task.task_id ?? task.id ?? task.uid;
    if (id != null && seen.has(String(id))) continue;
    if (id != null) seen.add(String(id));
    if (/^(PLANNER:|CHECKLIST_ATTIVITA)/.test(task.origin || '')) continue;
    const target = targets.get(String(id));
    const legacyDeadline = task.legal_deadline || /SCADENZA|DEADLINE/i.test(task.category || task.source_type || '') || deadlineIds.has(String(id));
    const due = task.due_date ?? target?.due_date ?? deadlines.get(String(id))?.due_date ?? task.deadline_date ?? (legacyDeadline ? task.event_date : '');
    const event = normalizeCalendarItem(task, task.source_type || 'TASK');
    add(due, event.status, event.title, event.start_time, event.practice_id, event.notes, 'Attività del gestionale');
  }
  for (const target of targets.values()) {
    const id = String(target.task_id);
    if (seen.has(id) || !target.due_date) continue;
    const event = normalizeCalendarItem(target, 'TASK');
    add(target.due_date, event.status, target.title, target.target_time, target.practice_id, '', 'Attività del gestionale');
    seen.add(id);
  }
  for (const row of effectiveScadenzeRows()) {
    if (!seen.has(String(row.task_id))) add(row.due_date, row.status, row.title, '', row.practice_id, row.client, 'Scadenza');
  }
  for (const task of localTasks) add(task.date, task.status, task.title, task.start_time, task.practice_id, task.notes, 'Attività sul dispositivo');
  const lists = new Map((snapshot?.checklists || []).map(list => [String(list.checklist_id), list]));
  for (const item of effectiveChecklistItems()) {
    const list = lists.get(String(item.checklist_id));
    if (list && !list.archived) add(item.due_date || list.date, item.status, item.title, item.due_time, list.practice_id, item.notes, list.title || 'Checklist');
  }
  for (const action of pendingMobileActions.filter(a => a.action_type === 'upsert_checklist')) {
    if (lists.has(String(action.mobile_uid || action.target_id))) continue;
    const list = action.payload || {};
    for (const item of list.items || []) add(item.due_date || list.date, item.status, item.title || item, item.due_time, list.practice_id, item.notes, list.title || 'Checklist sul dispositivo');
  }
  for (const item of snapshot?.hearingChecklistItems || []) {
    const hearing = hearingEventById(item.hearing_id);
    add(item.due_date || item.hearing_date || hearing?.event_date, effectiveHearingChecklistStatus(item), item.title, item.due_time, item.practice_id || hearing?.practice_id, item.notes, 'Checklist udienza');
  }
  return rows.sort((a,b) => a.due.localeCompare(b.due) || String(a.time || '').localeCompare(String(b.time || '')) || String(a.title).localeCompare(String(b.title), 'it'));
}
function mountHomeChecklist(root, day) {
  const panel = root.querySelector('[data-home-checklist]');
  function show() {
    const rows = homeChecklistRows(day, homeChecklistDays);
    const options = [7,15,30].map(n => `<option value="${n}" ${n === homeChecklistDays ? 'selected' : ''}>Prossimi ${n} giorni</option>`).join('');
    const groups = [['Arretrate', rows.filter(r => r.due < day)], ['Della giornata', rows.filter(r => r.due === day)], ['Giorni successivi', rows.filter(r => r.due > day)]];
    panel.innerHTML = `<label>Intervallo <select>${options}</select></label>` + groups.filter(([,items]) => items.length).map(([label,items]) =>
      `<h4>${label}</h4>` + items.map(r => `<details><summary>${escapeHtml(fmtDate(r.due))} · ${escapeHtml(r.title || 'Attività')}</summary><p>${escapeHtml([r.source, r.time, r.notes].filter(Boolean).join(' · '))}</p>${practiceById(r.practice) ? `<button data-home-practice="${escapeHtml(r.practice)}">Apri fascicolo</button>` : ''}</details>`).join('')
    ).join('') + (rows.length ? '' : '<p>Nessuna attività aperta nel periodo.</p>');
    panel.querySelector('select').onchange = event => {homeChecklistDays = Number(event.target.value); show(); panel.querySelector('select').focus();};
    panel.querySelectorAll('[data-home-practice]').forEach(button => button.onclick = () => openPractice(button.dataset.homePractice));
  }
  show();
}

function renderHome(){
  const root=$("homeView");if(!root||!snapshot)return;
  const all=calendarItems().sort(eventSort);
  const today=plannerLocalToday();
  const weekEnd=addDays(today,6);
  const todayItems=all.filter(e=>e.event_date===today);
  const stats={
    practices:(snapshot.practices||[]).filter(p=>!/(ARCHIVIAT|CHIUS|DEFINIT|ESTINT)/i.test(String(p.stato||""))).length,
    hearings:all.filter(e=>eventKind(e)==="UDIENZA" && (e.event_date||"")>=today && (e.event_date||"")<=weekEnd).length,
    deadlines:all.filter(e=>eventKind(e)==="SCADENZA" && (e.event_date||"")>=today && (e.event_date||"")<=weekEnd).length,
    appointments:all.filter(e=>eventKind(e)==="APPUNTAMENTO" && (e.event_date||"")>=today && (e.event_date||"")<=weekEnd).length
  };
  const next=nextEventCardData();
  const linked=next?.practice_id&&practiceById(next.practice_id);
  let syncTime='—';
  try{syncTime=new Intl.DateTimeFormat('it-IT',{hour:'2-digit',minute:'2-digit'}).format(new Date(snapshot.generated_at));}catch(e){}
  const dateShort=new Intl.DateTimeFormat('it-IT',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
  const dateCompact=next?.event_date?new Intl.DateTimeFormat('it-IT',{weekday:'short',day:'2-digit',month:'short'}).format(new Date(next.event_date+'T12:00:00')):'';
  const todayRows=todayItems.map(e=>{
    const p=e.practice_id&&practiceById(e.practice_id);
    const kind=eventKind(e);
    const mark=kind==='UDIENZA'?'U':kind==='SCADENZA'?'S':kind==='APPUNTAMENTO'?'A':'•';
    return `<button class="executive-row kind-${kind}" ${p?`data-practice="${escapeHtml(p.id)}"`:'data-open-view="agendaView"'}>
      <span class="executive-row-time">${escapeHtml(e.start_time||'—')}</span>
      <span class="executive-row-mark">${mark}</span>
      <span class="executive-row-copy"><strong>${escapeHtml(e.title||kind)}</strong><small>${escapeHtml(p?.assistito||e.practice_name||e.location||e.authority||'')}</small></span>
      <span class="executive-row-arrow">›</span>
    </button>`;
  }).join('');

  const iconFolder='<svg viewBox="0 0 24 24" fill="none"><path d="M4 8a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Z"/><path d="M4 10h16"/></svg>';
  const iconLaw='<svg viewBox="0 0 24 24" fill="none"><path d="M12 4v15M7 7h10M5 7c0 3-2 5-2 5h6s-2-2-2-5M19 7c0 3-2 5-2 5h6s-2-2-2-5M8 20h8"/></svg>';
  const iconClock='<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/></svg>';
  const iconCheck='<svg viewBox="0 0 24 24" fill="none"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 2.5 2.5L16 9"/></svg>';

  root.innerHTML=`
    <section class="executive-welcome">
      <div><span>STUDIO OPERATIVO</span><strong>${homeGreeting()}, Avvocato Costa</strong><small>${escapeHtml(dateShort)}</small></div>
      <div class="executive-system"><i></i><b>${escapeHtml(syncTime)}</b><button data-home-action="settings" aria-label="Impostazioni">•••</button></div>
    </section>

    <section class="executive-kpis" aria-label="Riepilogo studio">
      <button data-open-view="practicesView"><span>Pratiche attive</span><b>${stats.practices}</b><i>fascicoli</i></button>
      <button class="kpi-hearing" data-open-view="hearingsView"><span>Udienze</span><b>${stats.hearings}</b><i>7 giorni</i></button>
      <button class="kpi-deadline" data-open-view="agendaView"><span>Scadenze</span><b>${stats.deadlines}</b><i>7 giorni</i></button>
      <button data-open-view="agendaView"><span>Appuntamenti</span><b>${stats.appointments}</b><i>7 giorni</i></button>
    </section>

    <section class="v19-dayplan"><div class="executive-section-head"><span>LA GIORNATA · OGGI</span><button data-open-view="plannerView">Apri Planner ›</button></div>
      ${companionDayRows(today,all).length?companionDayRows(today,all).map(row=>`<button data-open-view="plannerView" class="v19-dayplan-task"><span>${escapeHtml(row.start_time?row.start_time+(row.end_time?'–'+row.end_time:''):'Senza orario')}</span><strong>${escapeHtml(row.title)}</strong></button>`).join(''):'<p class="v19-dayplan-empty">Nessun impegno per oggi.</p>'}
    </section>

    <section class="executive-next">
      <div class="executive-section-head"><span>PROSSIMO IMPEGNO</span><button data-open-view="agendaView">Agenda <i>›</i></button></div>
      ${next?`<button class="executive-next-card ${eventKind(next)==='UDIENZA'?'is-hearing':''}" ${linked?`data-practice="${escapeHtml(linked.id)}"`:'data-open-view="agendaView"'}>
        <span class="next-date"><b>${escapeHtml(dateCompact)}</b><em>${escapeHtml(next.start_time||'—')}</em></span>
        <span class="next-copy"><small>${escapeHtml(eventKind(next))}</small><strong>${escapeHtml(next.title||eventKind(next))}</strong><em>${escapeHtml(linked?.assistito||next.practice_name||next.location||next.authority||'')}</em></span>
        <span class="next-open">›</span>
      </button>`:'<div class="executive-empty">Nessun impegno imminente.</div>'}
    </section>

    <section class="executive-today">
      <div class="executive-section-head"><span>AGENDA DI OGGI</span><button data-open-view="agendaView">Vedi tutto <i>›</i></button></div>
      <div class="executive-list">${todayRows||'<div class="executive-empty">Nessun impegno per oggi.</div>'}</div>
    </section>

    <section class="executive-shortcuts">
      <div class="executive-section-head"><span>ACCESSO RAPIDO</span></div>
      <div class="executive-shortcut-grid">
        <button data-open-view="practicesView"><span>${iconFolder}</span><b>Pratiche</b><small>Fascicoli</small></button>
        <button data-open-tool="codes"><span>${iconLaw}</span><b>Banca</b><small>Giuridica</small></button>
        <button data-open-tool="terms"><span>${iconClock}</span><b>Termini</b><small>Calcolo rapido</small></button>
        <button data-open-view="checklistsView"><span>${iconCheck}</span><b>Checklist</b><small>Promemoria</small></button>
      </div>
    </section><section class="executive-today"><h3>Checklist delle attività</h3><div data-home-checklist></div></section>`;
  mountHomeChecklist(root,today);

  root.querySelectorAll('[data-open-view]').forEach(btn=>btn.onclick=()=>switchView(btn.dataset.openView));
  root.querySelectorAll('[data-open-tool]').forEach(btn=>btn.onclick=()=>openTool(btn.dataset.openTool));
  root.querySelectorAll('[data-practice]').forEach(btn=>btn.onclick=()=>openPractice(btn.dataset.practice));
  root.querySelectorAll('[data-home-action]').forEach(btn=>btn.onclick=()=>{if(btn.dataset.homeAction==='settings')$("settingsButton")?.click();});
}

function groupedAgenda(items){
  if(!items.length)return '<div class="empty">Nessun impegno nel periodo selezionato</div>';
  const groups={};
  items.forEach(item=>{(groups[item.event_date] ||= []).push(item)});
  return Object.keys(groups).sort().map(date=>`
    <section class="agenda-day-group">
      <div class="agenda-day-title"><strong>${escapeHtml(fmtWeekday(date))}</strong><span>${fmtDate(date)}</span><em>${groups[date].length} ${groups[date].length===1?"impegno":"impegni"}</em></div>
      ${groups[date].sort(eventSort).map(eventCard).join("")}
    </section>`).join("");
}
function renderMonthGrid(items,selected){
  const [start,end]=monthBounds(selected); const groups={}; items.forEach(i=>(groups[i.event_date]??=[]).push(i));
  const first=new Date(start+"T12:00:00"); let offset=(first.getDay()+6)%7; const days=new Date(end+"T12:00:00").getDate();
  let cells=[]; for(let i=0;i<offset;i++)cells.push('<div class="month-cell muted-cell"></div>');
  for(let d=1;d<=days;d++){const ds=`${start.slice(0,8)}${String(d).padStart(2,"0")}`;const day=groups[ds]||[];const counts={};day.forEach(e=>{const k=eventKind(e);counts[k]=(counts[k]||0)+1});const ck=openChecklistCount(ds);if(ck)counts.CHECKLIST=ck;cells.push(`<button class="month-cell ${ds===selected?"selected":""}" data-agenda-day="${ds}"><strong>${d}</strong>${Object.entries(counts).slice(0,4).map(([k,n])=>`<span class="month-dot ${k}">${n} ${k.toLowerCase()}</span>`).join("")}</button>`)}
  return `<div class="month-weekdays">${["Lun","Mar","Mer","Gio","Ven","Sab","Dom"].map(x=>`<span>${x}</span>`).join("")}</div><div class="month-grid">${cells.join("")}</div>`;
}
function compactEventList(events,emptyText="Nessun impegno nel giorno selezionato"){
  return `<div class="compact-event-list">${events.length?events.map(eventCard).join(""):`<div class="empty">${emptyText}</div>`}</div>`;
}
function hearingDocketList(events,emptyText="Nessuna udienza nel giorno selezionato"){
  if(!events.length)return `<div class="empty docket-empty">${emptyText}</div>`;
  return `<div class="docket-list">${events.map((e,index)=>{
    const p=e.practice_id&&practiceById(e.practice_id);
    const place=e.authority||e.location||p?.autorita||p?.tribunale||'';
    return `<button class="docket-card" ${p?`data-practice="${escapeHtml(p.id)}"`:''}>
      <span class="docket-number">${String(index+1).padStart(2,'0')}</span>
      <span class="docket-time">${escapeHtml(e.start_time||'—')}</span>
      <span class="docket-body"><strong>${escapeHtml(e.title||'Udienza')}</strong><small>${escapeHtml(p?.assistito||e.practice_name||'')}</small>${place?`<em>${escapeHtml(place)}</em>`:''}</span>
      <span class="docket-chevron">›</span>
    </button>`;
  }).join('')}</div>`;
}
function agendaTimeline(events,emptyText="Nessun impegno nel giorno selezionato"){
  if(!events.length)return `<div class="empty planner-empty">${emptyText}</div>`;
  return `<div class="planner-timeline">${events.map(e=>{
    const p=e.practice_id&&practiceById(e.practice_id);const kind=eventKind(e);
    return `<button class="planner-item kind-${kind}" ${p?`data-practice="${escapeHtml(p.id)}"`:''}>
      <span class="planner-time">${escapeHtml(e.start_time||'—')}</span>
      <span class="planner-line"><i></i></span>
      <span class="planner-body"><small>${escapeHtml(kind)}</small><strong>${escapeHtml(e.title||kind)}</strong><em>${escapeHtml(p?.assistito||e.practice_name||e.location||e.authority||'')}</em></span>
      <span class="planner-chevron">›</span>
    </button>`;
  }).join('')}</div>`;
}
function renderHearings(){
  const anchor=$("hearingDate").value||plannerLocalToday();$("hearingDate").value=anchor;companionDateDisplay("hearingDate");
  let events=calendarItems().filter(e=>eventKind(e)==="UDIENZA").sort(eventSort),label;
  if(hearingMode==="day"){
    events=events.filter(e=>e.event_date===anchor);label=fmtDate(anchor);
  }else if(hearingMode==="week"){
    const start=startOfWeek(anchor),end=addDays(start,6);
    events=events.filter(e=>e.event_date>=start&&e.event_date<=end);label=fmtDate(start)+' – '+fmtDate(end);
  }else if(hearingMode==="month"){
    const [start,end]=monthBounds(anchor);events=events.filter(e=>e.event_date>=start&&e.event_date<=end);
    label=new Intl.DateTimeFormat('it-IT',{month:'long',year:'numeric'}).format(new Date(anchor+'T12:00:00'));
  }else{
    events=events.filter(e=>e.event_date>=anchor);label='Dal '+fmtDate(anchor)+' · tutte le prossime udienze';
  }
  const dates=[...new Set(events.map(e=>e.event_date))];
  $("hearingsContent").innerHTML=`<div class="docket-week-summary"><b>${events.length}</b><span>udienze nel periodo</span></div>`+
    (dates.map(day=>`<section class="hearing-list-day"><div class="docket-selected-day"><strong>${escapeHtml(fmtWeekday(day))}</strong><span>${fmtDate(day)}</span></div>${hearingDocketList(events.filter(e=>e.event_date===day))}</section>`).join('')||'<div class="empty">Nessuna udienza nel periodo selezionato</div>');
  $("hearingPeriodLabel").textContent=label;bindPracticeLinks($("hearingsContent"));
}

// V18.5: Planner condiviso con il desktop. Orari operativi separati dalle scadenze giuridiche.
