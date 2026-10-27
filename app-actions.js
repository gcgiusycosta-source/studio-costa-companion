function openLocalTask(id=""){
  populatePracticeSelect();
  const task=localTasks.find(t=>t.id===id)||{};
  $("localTaskModal").classList.remove("hidden");
  $("localTaskId").value=task.id||"";
  $("localCategory").value=task.category||"APPUNTAMENTO";
  $("localPractice").value=String(task.practice_id||"");
  $("localTitle").value=task.title||"";
  $("localDate").value=task.date||plannerLocalToday();
  $("localStart").value=task.start_time||"";
  $("localEnd").value=task.end_time||"";
  $("localAllDay").checked=!!task.all_day;
  $("localLocation").value=task.location||"";
  $("localCourtroom").value=task.courtroom||"";
  $("localJudge").value=task.judge||"";
  if($("localFirstHearing")) $("localFirstHearing").checked=!!task.is_first_hearing;
  $("localNotes").value=task.notes||"";
  $("localPriority").value=task.priority||"MEDIA";
  $("localBusy").checked=task.occupies_calendar!==false;
  $("localPrivate").checked=!!task.private;
  $("deleteLocalTask").classList.toggle("hidden",!task.id);
  updateLocalFormMode();
}
function closeLocalTask(){$("localTaskModal").classList.add("hidden")}
function overlaps(candidate,other){if(!candidate.occupies_calendar||other.occupies_calendar===false||candidate.date!==(other.event_date||other.date))return false;if(candidate.all_day||other.all_day)return true;const start=candidate.start_time||"00:00",end=candidate.end_time||candidate.start_time||"23:59",os=other.start_time||"00:00",oe=other.end_time||other.start_time||"23:59";return start<oe&&os<end}

async function saveLocalTask(){
  const existing=localTasks.find(t=>t.id===$("localTaskId").value)||{};
  const category=$("localCategory").value;
  const task={
    ...existing,
    id:$("localTaskId").value||uid(),
    title:$("localTitle").value.trim(),
    category,
    practice_id:$("localPractice").value||"",
    date:$("localDate").value,
    start_time:$("localStart").value,
    end_time:$("localEnd").value,
    all_day:$("localAllDay").checked,
    location:$("localLocation").value.trim(),
    courtroom:$("localCourtroom").value.trim(),
    judge:$("localJudge").value.trim(),
    is_first_hearing:category==="UDIENZA"&&!!$("localFirstHearing")?.checked,
    notes:$("localNotes").value.trim(),
    priority:$("localPriority").value,
    occupies_calendar:$("localBusy").checked,
    private:$("localPrivate").checked,
    status:"DA_FARE",
    created_at:existing.created_at||new Date().toISOString(),
    updated_at:new Date().toISOString(),
    device_id:deviceId()
  };
  if(!task.title||!task.date){alert("Titolo e data sono obbligatori.");return}
  if(category==="UDIENZA"&&!task.practice_id){alert("Per una nuova udienza devi selezionare la pratica.");return}
  if(category==="UDIENZA"&&task.private){alert("Un'udienza collegata a una pratica non può essere privata.");return}
  const conflicts=calendarItems().filter(e=>e.source_type!=="LOCAL"||e.id!==task.id).filter(e=>overlaps(task,e));
  if(conflicts.length&&!confirm(`Nella stessa fascia è già presente ${conflicts[0].title||"un impegno"}. Salvare comunque?`))return;
  await storePut("local_tasks",task);
  const ix=localTasks.findIndex(t=>t.id===task.id);if(ix>=0)localTasks[ix]=task;else localTasks.push(task);

  // Se la bozza è stata modificata prima dell'import sul PC, sostituiamo la precedente azione mobile
  // dello stesso oggetto invece di accumulare versioni concorrenti.
  for(const action of pendingMobileActions.filter(a=>String(a.mobile_uid||"")===String(task.id)&&["upsert_hearing","upsert_appointment","upsert_task"].includes(a.action_type))){
    await storeDelete("pending_mobile_actions",action.action_id);
  }
  pendingMobileActions=pendingMobileActions.filter(a=>!(String(a.mobile_uid||"")===String(task.id)&&["upsert_hearing","upsert_appointment","upsert_task"].includes(a.action_type)));

  if(!task.private){
    const actionType=category==="UDIENZA"?"upsert_hearing":category==="APPUNTAMENTO"?"upsert_appointment":"upsert_task";
    await queueMobileAction({action_type:actionType,mobile_uid:task.id,target_id:task.id,payload:task});
  }
  closeLocalTask();renderAll();
}

async function deleteLocalTask(){
  const id=$("localTaskId").value;if(!id)return;
  const task=localTasks.find(t=>t.id===id);
  if(!confirm("Eliminare questo impegno creato sul telefono?"))return;
  const related=pendingMobileActions.filter(a=>String(a.mobile_uid||"")===String(id)&&["upsert_hearing","upsert_appointment","upsert_task"].includes(a.action_type));
  for(const action of related)await storeDelete("pending_mobile_actions",action.action_id);
  pendingMobileActions=pendingMobileActions.filter(a=>!related.some(r=>r.action_id===a.action_id));
  // Se non è più una semplice bozza locale, l'eventuale cancellazione della voce ufficiale resta un'operazione desktop.
  await storeDelete("local_tasks",id);
  localTasks=localTasks.filter(t=>t.id!==id);
  closeLocalTask();updatePendingIndicator();renderAll();
}
async function exportLocalTasks(){const password=prompt("Password backup attività locali (almeno 8 caratteri)");if(!password||password.length<8)return;const payload={formatVersion:1,deviceId:deviceId(),createdAt:new Date().toISOString(),localTasks};const env=await encryptEnvelope(payload,password,"SCL1","STUDIO-COSTA-LOCAL-TASKS-SCL1");downloadJson(env,`AttivitaLocaliCosta_${plannerLocalToday()}.scl`)}
async function decryptGenericEnvelope(envelope,password,format,aadText){
  if(!envelope||envelope.format!==format)throw new Error("Formato del backup non valido.");
  const material=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveKey"]);
  const key=await crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt:base64UrlToBytes(envelope.salt),iterations:Number(envelope.iterations||300000)},material,{name:"AES-GCM",length:256},false,["decrypt"]);
  let plain;try{plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:base64UrlToBytes(envelope.nonce),additionalData:new TextEncoder().encode(aadText)},key,base64UrlToBytes(envelope.ciphertext))}catch(_){throw new Error("Password errata o backup non autentico.")}
  return JSON.parse(new TextDecoder().decode(plain));
}
async function importLocalTasksFile(file,password){
  if(!file)throw new Error("Selezionare un file .scl."); const envelope=JSON.parse(await file.text()); const payload=await decryptGenericEnvelope(envelope,password,"SCL1","STUDIO-COSTA-LOCAL-TASKS-SCL1");
  if(!Array.isArray(payload.localTasks))throw new Error("Backup attività locali non valido.");
  for(const task of payload.localTasks)await storePut("local_tasks",task); localTasks=await storeAll("local_tasks"); renderAll();
}

async function completeLocalTask(id){
  const task=localTasks.find(t=>t.id===id);if(!task)return;
  task.status="COMPLETATA";task.completed_at=new Date().toISOString();task.updated_at=task.completed_at;
  await storePut("local_tasks",task);
  if(!task.private&&task.category!=="UDIENZA"){
    await queueMobileAction({action_type:task.category==="APPUNTAMENTO"?"upsert_appointment":"upsert_task",mobile_uid:task.id,target_id:task.id,payload:task});
  }
  renderAll();
}
async function duplicateLocalTask(id){const source=localTasks.find(t=>t.id===id);if(!source)return;const copy={...source,id:uid(),title:`${source.title} (copia)`,status:"DA_FARE",completed_at:null,created_at:new Date().toISOString(),updated_at:new Date().toISOString()};await storePut("local_tasks",copy);localTasks.push(copy);renderAll()}

async function reconcilePendingActions(candidate){
  const checklist=new Map((candidate.checklistItems||[]).map(i=>[String(i.checklist_item_id),String(i.status||"")]));
  const hearingChecklist=new Map((candidate.hearingChecklistItems||[]).map(i=>[String(i.id),String(i.status||"")]));
  const tasks=new Map((candidate.tasks||[]).map(i=>[String(i.source_id??i.id??i.task_id),String(i.status||"")]));
  const taskMobile=new Set((candidate.tasks||[]).map(i=>String(i.mobile_uid||"")).filter(Boolean));
  const apptMobile=new Set((candidate.events||[]).filter(e=>e.source_type==="APPOINTMENT").map(e=>String(e.mobile_uid||"")).filter(Boolean));
  const hearingMobile=new Set((candidate.events||[]).filter(e=>e.source_type==="HEARING").map(e=>String(e.mobile_uid||"")).filter(Boolean));
  const cresetMap=new Map((candidate.creset||[]).map(i=>[String(i.id),String(i.status||"").toUpperCase().replace(/_/g," ")]));
  const hearings=new Map((candidate.events||[]).filter(e=>e.source_type==="HEARING").map(e=>[String(e.source_id),e]));
  const kept=[];
  const confirmedLocalIds=new Set();
  for(const action of pendingMobileActions){
    let applied=false;
    if(["complete_checklist_item","reopen_checklist_item"].includes(action.action_type))applied=checklist.get(String(action.checklist_item_id))===String(action.new_status||"");
    else if(["hearing_checklist_status","complete_hearing_checklist_item","reopen_hearing_checklist_item"].includes(action.action_type))applied=hearingChecklist.get(String(action.hearing_checklist_item_id||action.target_id))===String(action.new_status||"");
    else if(["task_status","complete_task","reopen_task"].includes(action.action_type))applied=tasks.get(String(action.task_id||action.target_id))===String(action.new_status||"");
    else if(action.action_type==='planner_target_time'){
      const t=(candidate.plannerTaskTargets||[]).find(x=>String(x.task_id)===String(action.task_id||action.target_id));
      // A date-only task may legitimately have no row after clearing its time.
      applied=t?String(t.target_time||'')===String(action.target_time||'')&&!((action.plan_date||'') && String(t.plan_date||'')!==String(action.plan_date)) : !action.target_time && !action.plan_date;
    }
    else if(action.action_type==="upsert_task")applied=taskMobile.has(String(action.mobile_uid||action.target_id));
    else if(action.action_type==="upsert_appointment")applied=apptMobile.has(String(action.mobile_uid||action.target_id));
    else if(action.action_type==="upsert_hearing")applied=hearingMobile.has(String(action.mobile_uid||action.target_id));
    else if(["creset_mark_worked","creset_mark_constituted","creset_set_status"].includes(action.action_type)){const id=String(action.position_id||action.target_id);const desired=String(action.new_status||"").toUpperCase().replace(/_/g," ");const terminal=["LAVORATA","COSTITUITA","ARCHIVIATA"].includes(desired);applied=terminal?!cresetMap.has(id):cresetMap.get(id)===desired;}
    else if(action.action_type==="hearing_outcome"){
      const h=hearings.get(String(action.hearing_id||action.target_id));
      applied=!!h&&(!action.outcome||normalize(h.status)===normalize(action.outcome)||normalize(h.outcome_category)===normalize(action.outcome_category));
    }
    if(applied){
      await storeDelete("pending_mobile_actions",action.action_id);
      if(["upsert_task","upsert_appointment","upsert_hearing"].includes(action.action_type)){
        const localId=String(action.mobile_uid||action.target_id||"");
        if(localId)confirmedLocalIds.add(localId);
      }
    }else kept.push(action);
  }
  for(const localId of confirmedLocalIds)await storeDelete("local_tasks",localId);
  if(confirmedLocalIds.size)localTasks=localTasks.filter(t=>!confirmedLocalIds.has(String(t.id)));
  pendingMobileActions=kept;
  updatePendingIndicator();
}

