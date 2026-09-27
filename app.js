const $=id=>document.getElementById(id);
let snapshot=null;
let activeView="homeView";
let agendaMode="week";
let agendaSelectedDay="";
let homeMode="week";
let homeSelectedDate="";
let homeAnchorDate="";
let localTasks=[];
let pendingMobileActions=[];
let checklistMode="todo";
let activeTool="hearing";

function openDB(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open("studio-costa-mobile",3);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains("data")) db.createObjectStore("data");
      if(!db.objectStoreNames.contains("local_tasks")) db.createObjectStore("local_tasks",{keyPath:"id"});
      if(!db.objectStoreNames.contains("pending_mobile_actions")) db.createObjectStore("pending_mobile_actions",{keyPath:"action_id"});
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}
async function dbGet(key){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("data","readonly");
    const r=tx.objectStore("data").get(key);
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>reject(r.error);
  });
}
async function dbSet(key,value){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction("data","readwrite");
    tx.objectStore("data").put(value,key);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}

async function storeAll(storeName){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,"readonly");
    const r=tx.objectStore(storeName).getAll();
    r.onsuccess=()=>resolve(r.result||[]); r.onerror=()=>reject(r.error);
  });
}
async function storePut(storeName,value){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,"readwrite"); tx.objectStore(storeName).put(value);
    tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error);
  });
}
async function storeDelete(storeName,key){
  const db=await openDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(storeName,"readwrite"); tx.objectStore(storeName).delete(key);
    tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error);
  });
}
function uid(){return (crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`)}
function deviceId(){
  let value=localStorage.getItem("studioCostaDeviceId");
  if(!value){value=`iphone-${uid()}`;localStorage.setItem("studioCostaDeviceId",value)}
  return value;
}


async function ensureOfflineShell(){
  if(!location.protocol.startsWith("http")) return false;
  if(!("serviceWorker" in navigator)) return false;
  const registration=await navigator.serviceWorker.register(
    "service-worker.js?v=15.2.1",{scope:"./"}
  );
  await navigator.serviceWorker.ready;
  if(registration.active){
    registration.active.postMessage({type:"CACHE_APP_SHELL"});
  }
  return true;
}

function updateOfflineStatus(ready){
  const label=$("syncStatus");
  if(!label||!snapshot)return;
  const base=`Ultima sincronizzazione: ${fmtDateTime(snapshot.generated_at)}`;
  label.textContent=ready ? `${base} · Disponibile offline` : base;
}
function base64UrlToBytes(value){
  if(typeof value!=="string"||!value){
    throw new Error("File SCM1 non valido.");
  }
  let base64=value.replace(/-/g,"+").replace(/_/g,"/");
  while(base64.length%4!==0) base64+="=";
  const binary=atob(base64);
  return Uint8Array.from(binary,char=>char.charCodeAt(0));
}
const b64bytes=base64UrlToBytes;

async function decryptCompanion(packageData,password){
  if(!crypto?.subtle){
    throw new Error("Il browser non supporta la decifratura sicura.");
  }
  if(!packageData||packageData.format!=="SCM1"){
    throw new Error("File SCM1 non valido.");
  }
  if(Number(packageData.formatVersion||1)!==1){
    throw new Error("Versione del formato non supportata.");
  }
  if(!password||password.length<8){
    throw new Error("Inserire la password usata durante l’esportazione.");
  }

  let material;
  let key;
  try{
    material=await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    key=await crypto.subtle.deriveKey(
      {
        name:"PBKDF2",
        hash:"SHA-256",
        salt:base64UrlToBytes(packageData.salt),
        iterations:Number(packageData.iterations||300000)
      },
      material,
      {name:"AES-GCM",length:256},
      false,
      ["decrypt"]
    );
  }catch(_){
    throw new Error("File SCM1 non valido.");
  }

  let decryptedBytes;
  try{
    decryptedBytes=await crypto.subtle.decrypt(
      {
        name:"AES-GCM",
        iv:base64UrlToBytes(packageData.nonce),
        additionalData:new TextEncoder().encode(
          "STUDIO-COSTA-COMPANION-SCM1"
        )
      },
      key,
      base64UrlToBytes(packageData.ciphertext)
    );
  }catch(_){
    throw new Error("Password errata o archivio non autentico.");
  }

  let parsed;
  try{
    const plainText=new TextDecoder("utf-8").decode(decryptedBytes);
    parsed=JSON.parse(plainText);
  }catch(_){
    throw new Error("Contenuto decifrato non interpretabile come JSON.");
  }

  const archiveData=
    parsed&&parsed.data&&typeof parsed.data==="object"
      ? parsed.data
      : parsed;

  if(!archiveData||typeof archiveData!=="object"){
    throw new Error("Struttura dati non riconosciuta.");
  }

  const hasPractices=Array.isArray(archiveData.practices);
  const hasEvents=Array.isArray(archiveData.events);
  if(!hasPractices||!hasEvents){
    throw new Error("Struttura dati non riconosciuta.");
  }

  const normalized={
    formatVersion:Number(parsed?.formatVersion||1),
    exportedAt:parsed?.exportedAt||parsed?.generated_at||packageData.exportedAt||"",
    source:parsed?.source||"Studio Legale Costa",
    archiveId:parsed?.archiveId||parsed?.archive_id||packageData.archiveId||"",
    practices:archiveData.practices,
    events:archiveData.events,
    tasks:Array.isArray(archiveData.tasks)?archiveData.tasks:[],
    deadlines:Array.isArray(archiveData.deadlines)?archiveData.deadlines:[],
    documents:Array.isArray(archiveData.documents)?archiveData.documents:[],
    folderDocuments:Array.isArray(archiveData.folderDocuments)?archiveData.folderDocuments:[],
    checklists:Array.isArray(archiveData.checklists)?archiveData.checklists:[],
    checklistItems:Array.isArray(archiveData.checklistItems)?archiveData.checklistItems:[],
    hearingPlans:Array.isArray(archiveData.hearingPlans)?archiveData.hearingPlans:[],
    hearingChecklistItems:Array.isArray(archiveData.hearingChecklistItems)?archiveData.hearingChecklistItems:[],
    creset:Array.isArray(archiveData.creset)?archiveData.creset:[],
    legalLibrary:Array.isArray(archiveData.legalLibrary)?archiveData.legalLibrary:[],
    plugins:Array.isArray(archiveData.plugins)?archiveData.plugins:[],
    companion_schema:Number(archiveData.companion_schema||1),
    companion_version:archiveData.companion_version||"",
    capabilities:Array.isArray(archiveData.capabilities)?archiveData.capabilities:[],
    controlled_writeback:Boolean(archiveData.controlled_writeback)
  };

  console.log("Tipo payload:",typeof parsed);
  console.log("Chiavi payload:",Object.keys(parsed||{}));
  console.log("Chiavi data:",Object.keys(parsed?.data||{}));
  console.log("Pratiche:",normalized.practices.length);
  console.log("Eventi:",normalized.events.length);

  if(normalized.practices.length===0){
    throw new Error("Archivio valido ma privo di pratiche.");
  }
  return normalized;
}

async function importCompanionFile(file,password){
  if(!file){
    throw new Error("Selezionare il file StudioCostaMobile.scmobile.");
  }

  let packageData;
  try{
    packageData=JSON.parse(await file.text());
  }catch(_){
    throw new Error("File SCM1 non valido.");
  }

  const decoded=await decryptCompanion(packageData,password);
  const candidate={
    generated_at:decoded.exportedAt,
    archive_id:decoded.archiveId,
    practices:decoded.practices,
    events:decoded.events,
    tasks:decoded.tasks,
    deadlines:decoded.deadlines,
    documents:decoded.documents,
    folderDocuments:decoded.folderDocuments,
    checklists:decoded.checklists,
    checklistItems:decoded.checklistItems,
    hearingPlans:decoded.hearingPlans,
    hearingChecklistItems:decoded.hearingChecklistItems,
    creset:decoded.creset,
    legalLibrary:decoded.legalLibrary,
    plugins:decoded.plugins,
    companion_schema:decoded.companion_schema,
    companion_version:decoded.companion_version,
    capabilities:decoded.capabilities,
    controlled_writeback:decoded.controlled_writeback
  };

  await dbSet("snapshot",candidate);
  snapshot=candidate;
  await reconcilePendingActions(candidate);
  await ensureOfflineShell();
  return candidate;
}

function openImportScreen(){
  $("pairError").textContent="";
  $("pairScreen").classList.remove("hidden");
  $("emptyScreen").classList.add("hidden");
  $("app").classList.add("hidden");
}
async function decryptEnvelope(envelope){
  const keyBytes=b64bytes(envelope.key);
  const key=await crypto.subtle.importKey("raw",keyBytes,{name:"AES-GCM"},false,["decrypt"]);
  const plain=await crypto.subtle.decrypt(
    {
      name:"AES-GCM",
      iv:b64bytes(envelope.nonce),
      additionalData:new TextEncoder().encode("STUDIO-COSTA-SNAPSHOT-V1")
    },
    key,
    b64bytes(envelope.payload)
  );
  return JSON.parse(new TextDecoder().decode(plain));
}
function pairToken(){
  const queryToken=new URLSearchParams(location.search).get("token")||"";
  return document.querySelector('meta[name="pair-token"]')?.content||queryToken||localStorage.getItem("studioPairToken")||"";
}
async function loadCached(){
  const cached=await dbGet("snapshot");
  localTasks=await storeAll("local_tasks");
  pendingMobileActions=await storeAll("pending_mobile_actions");
  if(cached){snapshot=cached;return true}
  return false;
}

function fmtDate(value){
  if(!value)return "";
  const d=new Date(value+"T12:00:00");
  if(Number.isNaN(d.getTime()))return value;
  return new Intl.DateTimeFormat("it-IT",{day:"2-digit",month:"2-digit",year:"numeric"}).format(d);
}
function fmtDateTime(value){
  if(!value)return "—";
  const d=new Date(value);
  if(Number.isNaN(d.getTime()))return value;
  return new Intl.DateTimeFormat("it-IT",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"}).format(d);
}
function fmtWeekday(value){
  if(!value)return "";
  const d=new Date(value+"T12:00:00");
  if(Number.isNaN(d.getTime()))return "";
  return new Intl.DateTimeFormat("it-IT",{weekday:"long"}).format(d);
}
function isoDate(value){
  if(!value)return "";
  const text=String(value);
  const match=text.match(/\d{4}-\d{2}-\d{2}/);
  if(match)return match[0];
  const d=new Date(value);
  return Number.isNaN(d.getTime())?"":d.toISOString().slice(0,10);
}
function normalizeCalendarItem(item,sourceType){
  const eventDate=isoDate(item.event_date||item.date||item.due_date||item.deadline_date||item.start_date||item.data);
  const category=(item.category||item.type||item.kind||(sourceType==="DEADLINE"?"SCADENZA":sourceType==="TASK"?"ATTIVITA":"IMPEGNO")).toString().toUpperCase();
  const taskId=item.source_id??item.task_id??item.id;
  const pendingTask=[...pendingMobileActions].reverse().find(a=>["task_status","complete_task","reopen_task"].includes(a.action_type)&&String(a.task_id??a.target_id)===String(taskId));
  return {
    ...item,
    event_date:eventDate,
    start_time:item.start_time||item.time||item.ora||"",
    end_time:item.end_time||"",
    title:item.title||item.name||item.description||item.oggetto||(category==="SCADENZA"?"Scadenza":"Attività"),
    category,
    source_type:item.source_type||sourceType,
    practice_id:item.practice_id||item.pratica_id||item.practiceId||"",
    status:pendingTask?.new_status||item.status||""
  };
}

function calendarItems(){
  const raw=[
    ...(snapshot?.events||[]).map(i=>normalizeCalendarItem(i,i.source_type||"EVENT")),
    ...(snapshot?.tasks||[]).map(i=>normalizeCalendarItem(i,"TASK")),
    ...(snapshot?.deadlines||[]).map(i=>normalizeCalendarItem(i,"DEADLINE")),
    ...localTasks.filter(i=>!["ELIMINATA","COMPLETATA"].includes(String(i.status||"").toUpperCase())).map(i=>
      normalizeCalendarItem({...i,category:i.category||"ATTIVITÀ",source_type:"LOCAL",event_date:i.date,start_time:i.start_time,end_time:i.end_time},"LOCAL")
    )
  ].filter(i=>i.event_date).filter(i=>{
    const st=String(i.status||"").toUpperCase().replaceAll("_"," ");
    if(i.source_type==="TASK"||i.source_type==="DEADLINE")return !["ANNULLATA","CANCELLATA","COMPLETATA","COMPLETATO","DEPOSITATA"].includes(st);
    return !["ANNULLATA","CANCELLATA"].includes(st);
  });
  const seen=new Set();
  return raw.filter(i=>{
    const key=[i.uid||i.id||i.source_id||"",i.event_date,i.start_time||"",i.title||"",i.practice_id||""].join("|");
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}
function addDays(dateString,days){
  const d=new Date(dateString+"T12:00:00");
  d.setDate(d.getDate()+days);
  return d.toISOString().slice(0,10);
}
function startOfWeek(dateString){
  const d=new Date(dateString+"T12:00:00");
  const offset=(d.getDay()+6)%7; // lunedì=0 ... domenica=6
  d.setDate(d.getDate()-offset);
  return d.toISOString().slice(0,10);
}
function monthBounds(dateString){
  const d=new Date(dateString+"T12:00:00");
  const start=new Date(d.getFullYear(),d.getMonth(),1,12);
  const end=new Date(d.getFullYear(),d.getMonth()+1,0,12);
  return [start.toISOString().slice(0,10),end.toISOString().slice(0,10)];
}
function shiftPeriod(dateString,mode,step){
  if(mode==="month"){
    const d=new Date((dateString||new Date().toISOString().slice(0,10))+"T12:00:00");
    d.setMonth(d.getMonth()+step);
    return d.toISOString().slice(0,10);
  }
  return addDays(dateString||new Date().toISOString().slice(0,10),mode==="week"?step*7:step);
}

function escapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m]));
}
function nonEmpty(value){
  if(value===null||value===undefined)return false;
  if(typeof value==="string")return value.trim()!=="";
  if(Array.isArray(value))return value.length>0;
  if(typeof value==="object")return Object.values(value).some(nonEmpty);
  return true;
}
function practiceById(id){
  return snapshot?.practices?.find(p=>String(p.id)===String(id));
}

function showApp(){
  $("pairScreen")?.classList.add("hidden");
  $("emptyScreen")?.classList.add("hidden");
  $("app")?.classList.remove("hidden");
  const syncText=`Ultima sincronizzazione: ${fmtDateTime(snapshot.generated_at)}`;
  if($("syncStatus"))$("syncStatus").textContent=syncText;
  if($("headerSync"))$("headerSync").textContent=fmtDateTime(snapshot.generated_at);
  if($("agendaDate"))$("agendaDate").value=new Date().toISOString().slice(0,10);
  populatePracticeSelect();
  document.body.dataset.activeView = activeView || "homeView";
  renderAll();
  updatePendingIndicator();
  ensureOfflineShell().then(ready=>updateOfflineStatus(ready)).catch(()=>updateOfflineStatus(false));
}

function switchView(target){
  activeView=target;
  document.body.dataset.activeView=target;
  document.body.classList.add('is-switching-view');
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("hidden",v.id!==target));
  document.querySelectorAll(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.target===target));
  document.querySelectorAll("[data-top-target]").forEach(b=>b.classList.toggle("active",b.dataset.topTarget===target));
  const titles={homeView:"Home",agendaView:"Agenda",checklistsView:"Checklist",practicesView:"Pratiche",toolsView:"Strumenti",searchView:"Ricerca"};
  if($("pageTitle"))$("pageTitle").textContent=titles[target]||"Studio Costa";
  if(target==="homeView")renderHome();
  if(target==="agendaView")renderAgenda();
  if(target==="checklistsView")renderChecklists();
  if(target==="practicesView")renderPractices();
  if(target==="toolsView")renderPlugins();
  if(target==="searchView")renderGlobalSearch();
  window.scrollTo({top:0,behavior:"smooth"});
  setTimeout(()=>document.body.classList.remove('is-switching-view'),220);
}
function eventSort(a,b){
  return `${a.event_date||""} ${a.start_time||""}`.localeCompare(`${b.event_date||""} ${b.start_time||""}`);
}
function daysUntil(dateString){
  if(!dateString)return null;
  const start=new Date(new Date().toISOString().slice(0,10)+"T12:00:00");
  const target=new Date(dateString+"T12:00:00");
  if(Number.isNaN(target.getTime()))return null;
  return Math.round((target-start)/86400000);
}
function eventVisualMeta(event){
  const kind=eventKind(event);
  const map={
    UDIENZA:{icon:"⚖",label:"Udienza",tone:"tone-hearing"},
    SCADENZA:{icon:"⏳",label:"Scadenza",tone:"tone-deadline"},
    PREPARAZIONE:{icon:"✦",label:"Preparazione",tone:"tone-preparation"},
    APPUNTAMENTO:{icon:"◷",label:"Appuntamento",tone:"tone-appointment"},
    CRESET:{icon:"▦",label:"Creset",tone:"tone-creset"},
    ATTIVITÀ:{icon:"✓",label:"Attività",tone:"tone-activity"}
  };
  const base=map[kind]||map["ATTIVITÀ"];
  const delta=daysUntil(event.event_date);
  let urgency="";
  if(delta!==null){
    if(delta<0)urgency=`Scaduta da ${Math.abs(delta)} ${Math.abs(delta)===1?"giorno":"giorni"}`;
    else if(delta===0)urgency="Oggi";
    else if(delta===1)urgency="Domani";
    else urgency=`Tra ${delta} giorni`;
  }
  return {...base,urgency};
}

function eventCard(event){
  const linked=event.practice_id&&practiceById(event.practice_id);
  const kind=eventKind(event);
  const meta=eventVisualMeta(event);
  const dateText=event.event_date?`${fmtWeekday(event.event_date)} ${fmtDate(event.event_date)}`:"Data non indicata";
  const overdue=(event.event_date||"")<new Date().toISOString().slice(0,10)&&["TASK","DEADLINE"].includes(String(event.source_type||"").toUpperCase());
  const hearingAction=event.source_type==="HEARING"
    ?`<button class="secondary-button compact-action" data-hearing-manage="${escapeHtml(event.source_id||"")}">Esito / rinvio</button>`:"";
  const supporting=(linked?.autorita||linked?.tribunale||event.authority||event.location||"");
  return `<article class="event ${escapeHtml(kind)} ${meta.tone}">
    <div class="event-shell">
      <div class="event-icon">${meta.icon}</div>
      <div class="event-body">
        <div class="event-headerline">
          <span class="event-category-pill">${escapeHtml(meta.label)}</span>
          <span class="event-urgency">${escapeHtml(meta.urgency||dateText)}</span>
        </div>
        <div class="event-date-row"><span class="event-date">${escapeHtml(dateText)}</span><span class="event-category">${escapeHtml(kind)}</span></div>
        <div class="event-top"><span class="event-time">${escapeHtml(event.start_time||"Tutto il giorno")}${event.end_time?` – ${escapeHtml(event.end_time)}`:""}</span></div>
        <h3>${escapeHtml(event.title||"Impegno")}</h3>
        ${supporting?`<div class="event-meta emphasis">${escapeHtml(supporting)}</div>`:""}
        ${event.location&&supporting!==event.location?`<div class="event-meta">📍 ${escapeHtml(event.location)}</div>`:""}
        ${overdue?`<div class="event-meta overdue">Scaduta / arretrata: ${escapeHtml(fmtDate(event.event_date))}</div>`:""}
        ${event.notes?`<div class="event-note-inline">${escapeHtml(event.notes)}</div>`:""}
        ${!linked&&event.practice_name?`<div class="event-meta practice-inline">⚖ ${escapeHtml(event.practice_name)}${event.practice_code?` · ${escapeHtml(event.practice_code)}`:""}</div>`:""}
        <div class="local-actions">
          ${hearingAction}
          ${event.source_type==="LOCAL"?`<span class="local-badge">DA SINCRONIZZARE</span><span><button data-local-edit="${escapeHtml(event.id||"")}">Modifica</button></span>`:""}
          ${(event.source_type==="TASK"||event.source_type==="DEADLINE")?`<button data-task-complete="${escapeHtml(event.source_id??event.task_id??event.id??"")}" data-task-updated="${escapeHtml(event.updated_at||"")}">Fatta</button>`:""}
        </div>
        ${linked?`<button class="practice-link" data-practice="${linked.id}">Apri ${escapeHtml(linked.assistito||"pratica")}</button>`:""}
      </div>
    </div>
  </article>`;
}

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
function agendaInsightsCard(events,label,focusDate){
  const counts={UDIENZA:0,SCADENZA:0,ATTIVITÀ:0,PREPARAZIONE:0};
  events.forEach(e=>{const k=eventKind(e);if(k==='UDIENZA')counts.UDIENZA++; else if(k==='SCADENZA')counts.SCADENZA++; else if(k==='PREPARAZIONE')counts.PREPARAZIONE++; else counts.ATTIVITÀ++;});
  const focusCounts=focusDate?dayCounts(events,focusDate):{UDIENZA:0,SCADENZA:0,PREPARAZIONE:0,CHECKLIST:0};
  return `<section class="agenda-lux-hero">
    <div class="agenda-lux-copy">
      <span class="agenda-kicker">Vista agenda</span>
      <h3>${escapeHtml(label||'Agenda')}</h3>
      <p>${focusDate?`Selezionato: ${escapeHtml(fmtWeekday(focusDate))} ${escapeHtml(fmtDate(focusDate))}`:'Controllo immediato di udienze, attività e scadenze.'}</p>
    </div>
    <div class="agenda-lux-stats">
      <div class="agenda-mini-stat hearing"><strong>${counts.UDIENZA}</strong><span>udienze</span></div>
      <div class="agenda-mini-stat deadline"><strong>${counts.SCADENZA}</strong><span>scadenze</span></div>
      <div class="agenda-mini-stat task"><strong>${counts.ATTIVITÀ+counts.PREPARAZIONE}</strong><span>attività</span></div>
      <div class="agenda-mini-stat checklist"><strong>${focusCounts.CHECKLIST||0}</strong><span>checklist</span></div>
    </div>
  </section>`;
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
    homeAnchorDate=homeSelectedDate||homeAnchorDate||new Date().toISOString().slice(0,10);
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
    homeAnchorDate=shiftPeriod(homeAnchorDate||new Date().toISOString().slice(0,10),homeMode||"week",step);
    homeSelectedDate=homeAnchorDate;
    renderHome();
  });
  root.querySelector("[data-home-today]")?.addEventListener("click",()=>{
    homeAnchorDate=new Date().toISOString().slice(0,10);
    homeSelectedDate=homeAnchorDate;
    renderHome();
  });
  root.querySelector("#homeDate")?.addEventListener("change",event=>{
    homeAnchorDate=event.target.value||new Date().toISOString().slice(0,10);
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
  const today=new Date().toISOString().slice(0,10);
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

function renderHome(){
  const root=$("homeView");if(!root||!snapshot)return;
  const all=calendarItems().sort(eventSort);
  const today=new Date().toISOString().slice(0,10);
  const weekEnd=addDays(today,6);
  const stats={
    practices:(snapshot.practices||[]).filter(p=>!/(ARCHIVIAT|CHIUS|DEFINIT|ESTINT)/i.test(String(p.stato||""))).length || (snapshot.practices||[]).length,
    hearings:all.filter(e=>eventKind(e)==="UDIENZA" && (e.event_date||"")>=today && (e.event_date||"")<=weekEnd).length,
    deadlines:all.filter(e=>["SCADENZA","PREPARAZIONE","ATTIVITÀ"].includes(eventKind(e)) && (e.event_date||"")>=today && (e.event_date||"")<=weekEnd).length,
    sync:pendingMobileActions.filter(a=>a.sync_status!=="IMPORTATA_DAL_GESTIONALE").length
  };
  const next=nextEventCardData();
  const linked=next?.practice_id&&practiceById(next.practice_id);
  let syncTime='—';
  try{syncTime=new Intl.DateTimeFormat('it-IT',{hour:'2-digit',minute:'2-digit'}).format(new Date(snapshot.generated_at));}catch(e){}
  const longDate=new Intl.DateTimeFormat('it-IT',{weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date());

  root.innerHTML=`
    <section class="mobile-home-hero">
      <div class="mobile-home-top">
        <div class="mobile-brand-card">
          <div class="mobile-brand-logo"></div>
          <div>
            <div class="mobile-brand-overline">Studio Legale Costa</div>
            <div class="mobile-brand-subline">Companion</div>
          </div>
        </div>
        <div class="mobile-home-actions">
          <button class="circle-action" data-home-action="search" aria-label="Cerca">⌕</button>
          <button class="circle-action has-dot" data-home-action="agenda" aria-label="Agenda">◌</button>
          <button class="circle-action" data-home-action="settings" aria-label="Sistema">⋯</button>
        </div>
      </div>
      <div class="mobile-home-copy">
        <p class="mobile-greeting">${homeGreeting()}</p>
        <h2>Avvocato Costa</h2>
        <p class="mobile-date">${escapeHtml(longDate)}</p>
        <div class="sync-chip-home">✓ Sincronizzato oggi, ${escapeHtml(syncTime)}</div>
      </div>
    </section>

    <section class="mobile-home-grid">
      <button class="home-stat-card card-pratiche" data-open-view="practicesView">
        <span class="home-stat-icon">◫</span>
        <strong>${stats.practices}</strong>
        <small>Pratiche attive</small>
        <i>›</i>
      </button>
      <button class="home-stat-card card-udienze" data-open-view="agendaView">
        <span class="home-stat-icon">⚖</span>
        <strong>${stats.hearings}</strong>
        <small>Udienze</small>
        <i>›</i>
      </button>
      <button class="home-stat-card card-scadenze" data-open-view="agendaView">
        <span class="home-stat-icon">⌛</span>
        <strong>${stats.deadlines}</strong>
        <small>Scadenze</small>
        <i>›</i>
      </button>
      <button class="home-stat-card card-sync" data-open-view="toolsView">
        <span class="home-stat-icon">✓</span>
        <strong>${stats.sync}</strong>
        <small>Da sincronizzare</small>
        <i>›</i>
      </button>
    </section>

    <section class="mobile-panel next-panel">
      <div class="panel-head">
        <h3>Prossimo impegno</h3>
        <button class="panel-link" data-open-view="agendaView">Vedi agenda completa</button>
      </div>
      ${next?`<button class="next-engagement-card" ${linked?`data-practice="${linked.id}"`:'data-open-view="agendaView"'}>
        <div class="next-engagement-icon">${eventKind(next)==='UDIENZA'?'⚖':eventKind(next)==='APPUNTAMENTO'?'☷':'⌛'}</div>
        <div class="next-engagement-time">${escapeHtml(next.start_time||'—')}</div>
        <div class="next-engagement-body">
          <strong>${escapeHtml(next.title||eventKind(next))}</strong>
          <span>${escapeHtml(linked?.assistito || next.practice_name || next.location || '')}</span>
          ${(next.authority || next.location || linked?.autorita || linked?.tribunale)?`<small>${escapeHtml(next.authority || next.location || linked?.autorita || linked?.tribunale || '')}</small>`:''}
        </div>
        <div class="next-engagement-chevron">›</div>
      </button>`:'<div class="empty home-empty">Nessun impegno imminente.</div>'}
    </section>

    <section class="mobile-panel quick-panel">
      <div class="panel-head">
        <h3>Strumenti rapidi</h3>
        <button class="panel-link" data-open-view="toolsView">Tutti gli strumenti</button>
      </div>
      <div class="quick-tool-row">
        <button class="quick-icon-card tone-red" data-open-view="agendaView"><span>⚖</span><em>Udienze</em></button>
        <button class="quick-icon-card tone-sage" data-open-view="toolsView"><span>⌗</span><em>Creset</em></button>
        <button class="quick-icon-card tone-green" data-open-view="searchView"><span>▤</span><em>Banca giuridica</em></button>
        <button class="quick-icon-card tone-gold" data-open-view="toolsView"><span>⌛</span><em>Termini</em></button>
        <button class="quick-icon-card tone-cream" data-open-view="toolsView"><span>€</span><em>Riparto</em></button>
        <button class="quick-icon-card tone-deep" data-open-view="checklistsView"><span>✓</span><em>Checklist</em></button>
      </div>
    </section>`;

  root.querySelectorAll('[data-open-view]').forEach(btn=>btn.onclick=()=>switchView(btn.dataset.openView));
  root.querySelectorAll('[data-practice]').forEach(btn=>btn.onclick=()=>openPractice(btn.dataset.practice));
  root.querySelectorAll('[data-home-action]').forEach(btn=>btn.onclick=()=>{
    const action=btn.dataset.homeAction;
    if(action==='search')switchView('searchView');
    else if(action==='agenda')switchView('agendaView');
    else if(action==='settings')$("settingsButton")?.click();
  });
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
function renderAgenda(){
  const today=new Date().toISOString().slice(0,10);
  const anchor=$("agendaDate").value||today; const all=calendarItems().sort(eventSort); let events=[]; let periodLabel=""; let contentHtml=""; let focusDate=anchor;
  if(agendaMode==="day"){
    agendaSelectedDay=anchor; focusDate=anchor; events=all.filter(e=>e.event_date===anchor); periodLabel=`${fmtWeekday(anchor)} ${fmtDate(anchor)}`;
    contentHtml=agendaInsightsCard(events,periodLabel,focusDate)+dayOperationalHtml(all,anchor);
  }else if(agendaMode==="week"){
    const start=startOfWeek(anchor),end=addDays(start,6);
    if(!agendaSelectedDay||agendaSelectedDay<start||agendaSelectedDay>end)agendaSelectedDay=(today>=start&&today<=end)?today:start;
    focusDate=agendaSelectedDay;
    events=all.filter(e=>e.event_date>=start&&e.event_date<=end);periodLabel=`Lun–Dom ${fmtDate(start)} – ${fmtDate(end)}`;
    contentHtml=agendaInsightsCard(events,periodLabel,focusDate)+`${weekOverview(all,start,agendaSelectedDay,"data-agenda-week-day")}<div class="selected-agenda-day"><strong>${escapeHtml(fmtWeekday(agendaSelectedDay))}</strong><span>${fmtDate(agendaSelectedDay)}</span></div>${dayOperationalHtml(all,agendaSelectedDay)}`;
  }else{
    const [start,end]=monthBounds(anchor);
    if(!agendaSelectedDay||agendaSelectedDay<start||agendaSelectedDay>end)agendaSelectedDay=anchor;
    focusDate=agendaSelectedDay;
    events=all.filter(e=>e.event_date>=start&&e.event_date<=end);
    periodLabel=new Intl.DateTimeFormat("it-IT",{month:"long",year:"numeric"}).format(new Date(anchor+"T12:00:00"));
    contentHtml=agendaInsightsCard(events,periodLabel,focusDate)+`${renderMonthGrid(events,agendaSelectedDay)}<div class="selected-day-label">${escapeHtml(fmtWeekday(agendaSelectedDay))} ${fmtDate(agendaSelectedDay)}</div>${dayOperationalHtml(all,agendaSelectedDay)}`;
  }
  $("agendaContent").innerHTML=contentHtml;
  if(agendaMode==="week")$("agendaContent").querySelectorAll("[data-agenda-week-day]").forEach(b=>b.onclick=()=>{agendaSelectedDay=b.dataset.agendaWeekDay;renderAgenda()});
  if(agendaMode==="month")$("agendaContent").querySelectorAll("[data-agenda-day]").forEach(b=>b.onclick=()=>{agendaSelectedDay=b.dataset.agendaDay;renderAgenda()});
  $("agendaPeriodLabel").textContent=periodLabel; bindPracticeLinks($("agendaContent"));bindInlineChecklist($("agendaContent"));
}


function renderAppointments(){
  const root=$("appointmentsContent");if(!root||!snapshot)return;
  const today=new Date().toISOString().slice(0,10);const future=calendarItems().filter(e=>eventKind(e)==="APPUNTAMENTO"&&(e.event_date||"")>=today).sort(eventSort);
  root.innerHTML=future.length?groupedAgenda(future):'<div class="empty">Nessun appuntamento futuro registrato.</div>';
  bindPracticeLinks(root);
}

function icsEscape(value){return String(value??"").replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\r?\n/g,"\\n")}
function icsDateTime(date,time){return `${String(date||"").replaceAll("-","")}${String(time||"09:00").replace(":","").padEnd(6,"0")}`}
function icsAlarm(trigger,label){return `BEGIN:VALARM\r\nTRIGGER:${trigger}\r\nACTION:DISPLAY\r\nDESCRIPTION:${icsEscape(label)}\r\nEND:VALARM`}
function exportCalendarIcs(){
  const today=new Date().toISOString().slice(0,10);const limit=addDays(today,365);
  const rows=calendarItems().filter(e=>e.event_date>=today&&e.event_date<=limit&&["UDIENZA","APPUNTAMENTO","SCADENZA","CRESET"].includes(eventKind(e))).sort(eventSort);
  if(!rows.length){alert("Nessun evento da esportare nel calendario.");return}
  const now=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
  const chunks=["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Studio Legale Costa//Companion V14//IT","CALSCALE:GREGORIAN","METHOD:PUBLISH","X-WR-CALNAME:Studio Legale Costa"];
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
function practiceCard(p){
  const hearing=p.prossima_udienza;
  const deadline=p.prossima_scadenza;
  const progress = Math.min(100, Math.max(12, ((hearing?30:10)+(deadline?20:5)+(nonEmpty(p.numero_principale)?15:0)+(nonEmpty(p.autorita||p.tribunale)?15:0)+(nonEmpty(p.oggetto)?20:0))));
  const matter=(p.area||"PRATICA").toUpperCase();
  const theme={PENALE:"theme-penale",CIVILE:"theme-civile",TRIBUTARIO:"theme-tributario"}[matter]||"theme-generic";
  const badgeStatus = hearing?`Udienza ${fmtDate(hearing.event_date)}${hearing.start_time?` · ${escapeHtml(hearing.start_time)}`:''}`:deadline?`Scadenza ${fmtDate(deadline.event_date)}`:"Nessuna imminenza";
  return `<article class="practice-card ${escapeHtml(p.area||"")} ${theme}" data-practice="${p.id}" role="button" tabindex="0" aria-label="Apri scheda pratica ${escapeHtml(p.assistito||'')}">
    <div class="practice-cover">
      <div class="practice-cover-content">
        <span class="area-badge area-${escapeHtml(matter)}">${escapeHtml(matter)}</span>
        <span class="status-badge">${escapeHtml(p.stato||"In corso")}</span>
      </div>
    </div>
    <div class="practice-top">
      <div class="practice-heading">
        <h3>${escapeHtml(p.assistito||"Assistito non indicato")}</h3>
        <div class="practice-subline">${escapeHtml(p.tipologia||p.tipologia_difesa||p.oggetto||"")}</div>
      </div>
    </div>
    <div class="practice-spotlight">${escapeHtml(badgeStatus)}</div>
    <div class="practice-grid two-lines">
      ${fieldHtml("Numero",p.numero_principale)}
      ${fieldHtml("Autorità",p.autorita||p.tribunale)}
      ${fieldHtml("Controparte",p.controparte)}
      ${fieldHtml("Fase",p.fase)}
    </div>
    <div class="practice-progress">
      <div class="progress-row"><span>Completezza scheda</span><b>${progress}%</b></div>
      <div class="progress-bar"><i style="width:${progress}%"></i></div>
    </div>
    <div class="next-row modern-next-row">
      <div class="next-box">
        <span class="label">Prossima udienza</span>
        <div class="value">${hearing?`${fmtDate(hearing.event_date)}${hearing.start_time?` · ${escapeHtml(hearing.start_time)}`:''}`:"—"}</div>
      </div>
      <div class="next-box">
        <span class="label">Prossima attività</span>
        <div class="value">${deadline?`${fmtDate(deadline.event_date)} · ${escapeHtml(deadline.title||"Attività")}`:"—"}</div>
      </div>
    </div>
    <div class="practice-action-row">
      <span class="practice-pill">Apri scheda</span>
      <span class="practice-pill muted">Dettagli e documenti</span>
    </div>
  </article>`;
}
function fieldHtml(label,value){
  return nonEmpty(value)?`<div class="field"><span class="label">${escapeHtml(label)}</span><span class="value">${escapeHtml(value)}</span></div>`:"";
}
function renderPractices(){
  const query=normalize($("practiceSearch").value);
  const area=$("areaFilter").value;
  const office=$("officeFilter").checked;
  const hearing=$("hearingFilter").checked;
  const deadline=$("deadlineFilter").checked;
  const practices=(snapshot.practices||[]).filter(p=>{
    if(query&&!searchBlob(p).includes(query))return false;
    if(area&&p.area!==area)return false;
    if(office&&!normalize(`${p.tipologia_difesa} ${p.stato_difesa}`).includes("ufficio"))return false;
    if(hearing&&!p.prossima_udienza)return false;
    if(deadline&&!p.prossima_scadenza)return false;
    return true;
  });
  const base=(snapshot.practices||[]);
  const counts={
    total:base.length,
    penal:base.filter(p=>p.area==='PENALE').length,
    civil:base.filter(p=>p.area==='CIVILE').length,
    trib:base.filter(p=>p.area==='TRIBUTARIO').length,
    hearings:practices.filter(p=>p.prossima_udienza).length,
    deadlines:practices.filter(p=>p.prossima_scadenza).length,
    office:practices.filter(p=>normalize(`${p.tipologia_difesa} ${p.stato_difesa}`).includes('ufficio')).length
  };
  $("practiceCount").innerHTML=`<div class="practices-dashboard">
      <div class="practice-mini-stat primary"><strong>${practices.length}</strong><span>visualizzate</span></div>
      <div class="practice-mini-stat"><strong>${counts.hearings}</strong><span>con udienza</span></div>
      <div class="practice-mini-stat"><strong>${counts.deadlines}</strong><span>con attività</span></div>
      <div class="practice-mini-stat"><strong>${counts.office}</strong><span>ufficio</span></div>
    </div>
    <div class="practices-overview"><span><b>${counts.penal}</b> penali · <b>${counts.civil}</b> civili · <b>${counts.trib}</b> tributarie</span><span>${query||area||office||hearing||deadline?'filtri attivi':'tutte le pratiche'}</span></div>`;
  $("practiceCards").innerHTML=practices.length?practices.map(practiceCard).join(""):'<div class="empty">Nessuna pratica corrisponde ai filtri</div>';
  bindPracticeLinks($("practiceCards"));
}
function renderActivities(){
  const today=new Date().toISOString().slice(0,10);
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
    source_archive_id:snapshot?.archive_id||"",source_generated_at:snapshot?.generated_at||"",companion_version:"13",
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
  const toast=$("undoToast");
  const undo=$("undoAction");
  if(toast&&undo){
    toast.classList.remove("hidden");
    undo.onclick=async()=>{await setChecklistItemStatus(item,previous);toast.classList.add("hidden")};
    setTimeout(()=>toast.classList.add("hidden"),5000);
  }
}
async function addMobileChecklist(){
  const title=prompt("Titolo della checklist");if(!title?.trim())return;
  const checklistDate=prompt("Data (AAAA-MM-GG)",new Date().toISOString().slice(0,10));if(!isoDate(checklistDate)){alert("Data non valida.");return}
  const practiceText=prompt("Assistito o codice pratica (facoltativo)","")?.trim()||"";
  let practiceId="";
  if(practiceText){
    const needle=normalize(practiceText);const matches=(snapshot?.practices||[]).filter(p=>normalize([p.client,p.internal_code,p.rgnr,p.sius,p.siep].filter(Boolean).join(" ")).includes(needle));
    if(matches.length!==1){alert(matches.length?"Sono state trovate più pratiche: indicare un codice più preciso.":"Pratica non riconosciuta. Lasciare vuoto oppure indicare assistito/codice esatto.");return}
    practiceId=matches[0].id||matches[0].practice_id||"";
  }
  const pasted=prompt("Incolla le voci: una riga corrisponde a una voce. Puoi iniziare con data e ora.","");
  const items=String(pasted||"").split(/\r?\n/).map(x=>parseMobileChecklistLine(x,isoDate(checklistDate))).filter(Boolean);
  if(!items.length){alert("Inserire almeno una voce.");return}
  const mobileUid=uid();
  await queueMobileAction({action_type:"upsert_checklist",mobile_uid:mobileUid,target_id:mobileUid,payload:{title:title.trim(),date:isoDate(checklistDate),priority:"MEDIA",practice_id:practiceId,items}});
  renderChecklists();
  alert("Checklist registrata. Esporta le modifiche per inserirla nel gestionale.");
}
function parseMobileChecklistLine(raw,commonDate){
  let text=String(raw||"").trim().replace(/^[-•*☐☑✓]+\s*/,"");if(!text)return null;
  let dueDate=commonDate||"",dueTime="";
  const dm=text.match(/\b(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?\b/);
  if(dm){let year=dm[3]?Number(dm[3]):Number((commonDate||new Date().toISOString()).slice(0,4));if(year<100)year+=2000;dueDate=`${year}-${String(Number(dm[2])).padStart(2,"0")}-${String(Number(dm[1])).padStart(2,"0")}`;text=text.replace(dm[0]," ")}
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
function cresetWorkedLocally(id){return !!latestAction("creset_mark_worked",id)}
function cresetConstitutedLocally(id){return !!latestAction("creset_mark_constituted",id)}
async function markCresetWorked(item){
  if(cresetWorkedLocally(item.id))return;
  if(!confirm(`Segnare come LAVORATA la posizione ${item.taxpayer||item.rg_number||item.id}? La modifica sarà applicata al gestionale dopo l'importazione del file risposte.`))return;
  await queueMobileAction({action_type:"creset_mark_worked",position_id:item.id,target_id:item.id,new_status:"LAVORATA",base_updated_at:item.updated_at||""});
  renderPlugins();
}
async function markCresetConstituted(item){
  if(cresetConstitutedLocally(item.id))return;
  if(!confirm(`Segnare come COSTITUITA la posizione ${item.taxpayer||item.rg_number||item.id}? La posizione uscirà dall'elenco attivo dopo la sincronizzazione.`))return;
  await queueMobileAction({action_type:"creset_mark_constituted",position_id:item.id,target_id:item.id,new_status:"COSTITUITA",base_updated_at:item.updated_at||""});
  renderPlugins();
}
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
  const today=new Date().toISOString().slice(0,10);
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
  const items=all.filter(item=>!cresetWorkedLocally(item.id)&&!cresetConstitutedLocally(item.id));
  root.innerHTML=items.length?items.map(item=>`<article class="creset-mobile-card"><div class="readiness-row"><h3>${escapeHtml(item.taxpayer||"Posizione Creset")}</h3><span class="readiness-badge">${escapeHtml(item.status||"DA LAVORARE")}</span></div><div class="creset-meta">${escapeHtml([item.municipality,item.rg_number&&`RG ${item.rg_number}`,item.hearing_date&&`Udienza ${fmtDate(item.hearing_date)}`,item.participation_mode&&`Partecipazione: ${item.participation_mode}`,item.preparation_due_date&&`Memoria ${fmtDate(item.preparation_due_date)}`,item.filing_due_date&&`Deposito ${fmtDate(item.filing_due_date)}`].filter(Boolean).join(" · "))}</div>${item.notes?`<p>${escapeHtml(item.notes)}</p>`:""}<div class="mobile-action-row"><button data-creset-worked="${escapeHtml(item.id)}">Segna Lavorata</button><button class="secondary-button" data-creset-constituted="${escapeHtml(item.id)}">Segna Costituita</button></div></article>`).join(""):'<div class="empty">Nessuna posizione Creset da lavorare.</div>';
  root.querySelectorAll("[data-creset-worked]").forEach(btn=>btn.onclick=()=>{const item=all.find(x=>String(x.id)===String(btn.dataset.cresetWorked));if(item)markCresetWorked(item)});
  root.querySelectorAll("[data-creset-constituted]").forEach(btn=>btn.onclick=()=>{const item=all.find(x=>String(x.id)===String(btn.dataset.cresetConstituted));if(item)markCresetConstituted(item)});
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
    return `<details class="legal-hit"><summary><span>${r.favorite?"★ ":""}${escapeHtml(title)}</span><small>${escapeHtml(meta)}</small></summary>${r.summary?`<div class="legal-summary"><strong>Sintesi</strong><p>${escapeHtml(r.summary)}</p></div>`:""}${r.text_body?`<div class="legal-full"><strong>Testo</strong><p>${escapeHtml(r.text_body)}</p></div>`:""}${r.notes?`<div class="legal-notes"><strong>Note Studio</strong><p>${escapeHtml(r.notes)}</p></div>`:""}${!r.summary&&!r.text_body&&preview?`<p>${escapeHtml(preview)}</p>`:""}</details>`;
  }).join(""):'<div class="empty small">Nessun risultato nella banca giuridica sincronizzata.</div>';
}
function calculateQuickTerm(){
  const start=$("termStartDate").value; const days=Math.max(0,Number($("termDays").value||0)); const direction=Number($("termDirection").value||1); if(!start)return alert("Indicare la data di partenza.");
  const d=new Date(`${start}T12:00:00`); d.setDate(d.getDate()+direction*days); $("termResult").textContent=`${fmtDate(d.toISOString().slice(0,10))} · calcolo di calendario non certificato`;
}
function parseEuro(value){const raw=String(value||"").trim().replace(/\s/g,"");const normalized=raw.includes(",")?raw.replace(/\./g,"").replace(",","."):raw;return Number(normalized)||0}
function euro(value){return new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(Number(value||0))}
function calculateMobileSplit(){
  const total=parseEuro($("splitTotal")?.value); if(total<=0)return alert("Inserire un importo valido.");
  const half=!!$("splitHalf")?.checked; const mode=$("splitMode")?.value||"thirds";
  const base=half?total/2:total; const outside=total-base; const reserve=base*.19; const net=base-reserve;
  let lines=[`Importo totale: ${euro(total)}`,`Base di riparto: ${euro(base)}`];
  if(half)lines.push(`Quota residua non ripartita (50%): ${euro(outside)}`);
  lines.push(`Accantonamento 19%: ${euro(reserve)}`,`Netto da ripartire: ${euro(net)}`);
  if(mode==="tfc"){
    lines.push(`Quota 30%: ${euro(net*.30)}`,`Quota 30%: ${euro(net*.30)}`,`Quota 10%: ${euro(net*.10)}`,`Quota 30%: ${euro(net*.30)}`);
  }else{
    lines.push(`Quota 1/3: ${euro(net/3)}`,`Quota 1/3: ${euro(net/3)}`,`Quota 1/3: ${euro(net/3)}`);
  }
  $("splitResult").innerHTML=lines.map((x,i)=>i===3||(!half&&i===2)?`<strong>${escapeHtml(x)}</strong>`:`<span>${escapeHtml(x)}</span>`).join("");
}
function renderPlugins(){
  if(!snapshot)return;
  const plugins=snapshot.plugins||[];
  const status=$("pluginStatus"); if(status)status.innerHTML=plugins.map(pluginChip).join("")||'<span class="plugin-chip">Core Companion</span>';
  const availableKeys=new Set(plugins.map(p=>String(p.key||"")));
  const oldArchive=plugins.length===0;
  const toolPlugin={hearing:"smart_hearings",creset:"creset",terms:"legal_tools",codes:"local_norms"};
  const coreTools=new Set(["split","checklist"]);
  const buttons=[...document.querySelectorAll("[data-tool]")];
  buttons.forEach(b=>{const required=toolPlugin[b.dataset.tool];const enabled=coreTools.has(b.dataset.tool)||oldArchive||!required||availableKeys.has(required);b.classList.toggle("hidden",!enabled)});
  if(!buttons.some(b=>b.dataset.tool===activeTool&&!b.classList.contains("hidden"))){const first=buttons.find(b=>!b.classList.contains("hidden"));if(first)activeTool=first.dataset.tool}
  document.querySelectorAll(".plugin-tool").forEach(el=>el.classList.add("hidden"));
  const map={hearing:"hearingTool",creset:"cresetTool",terms:"termsTool",codes:"codesTool",split:"splitTool",checklist:"checklistTool"}; if($(map[activeTool]))$(map[activeTool]).classList.remove("hidden");
  buttons.forEach(b=>b.classList.toggle("active",b.dataset.tool===activeTool));
  const toolsView=$("toolsView");
  const labels={hearing:"Udienze",codes:"Banca giuridica",terms:"Termini",split:"Riparto",creset:"Creset",checklist:"Checklist"};
  const descriptions={
    hearing:"Calendario udienze, checklist, esiti e rinvii da sincronizzare.",
    codes:"Norme, giurisprudenza, prassi, formule e note Studio.",
    terms:"Supporto rapido per il calcolo dei termini e delle date.",
    split:"Riparto Studio / TFC con opzione 50% e accantonamento.",
    creset:"Posizioni Creset, lavorazioni e costituzioni da segnare al volo.",
    checklist:"Liste operative sincronizzate e voci da spuntare fuori studio."
  };
  if(toolsView){
    let hero=toolsView.querySelector('.tools-lux-hero');
    if(!hero){
      hero=document.createElement('section');
      hero.className='tools-lux-hero';
      const tabs=toolsView.querySelector('.tool-tabs');
      if(tabs)tabs.before(hero);
    }
    hero.innerHTML=`<div class="tools-lux-copy"><span class="tools-kicker">Dashboard strumenti</span><h3>${escapeHtml(labels[activeTool]||'Strumenti')}</h3><p>${escapeHtml(descriptions[activeTool]||'Tocca una scheda per aprire subito la funzione.')}</p></div><div class="tools-lux-side"><strong>${buttons.filter(b=>!b.classList.contains('hidden')).length}</strong><span>moduli attivi</span></div>`;
  }
  const pending=pendingMobileActions.filter(a=>a.sync_status!=="IMPORTATA_DAL_GESTIONALE").length;
  [$("exportPluginActions"),$("exportMobileActions")].filter(Boolean).forEach(b=>{b.textContent=pending?`Esporta modifiche (${pending}) per il gestionale`:"Esporta modifiche per il gestionale"});
  renderHearingTool(); renderCresetTool(); renderLegalResults();
  if($("termStartDate")&&!$("termStartDate").value)$("termStartDate").value=new Date().toISOString().slice(0,10);
}
async function exportMobileActions(){
  const actions=pendingMobileActions.filter(a=>a.sync_status!=="IMPORTATA_DAL_GESTIONALE");
  if(!actions.length){alert("Non ci sono modifiche da esportare.");return}
  const password=prompt("Password del file modifiche (almeno 8 caratteri)");
  if(!password||password.length<8){if(password)alert("La password deve avere almeno 8 caratteri.");return}
  const payload={formatVersion:3,companionVersion:"14.0",sourceArchiveId:snapshot?.archive_id||"",sourceGeneratedAt:snapshot?.generated_at||"",deviceId:deviceId(),createdAt:new Date().toISOString(),actions:actions.map(a=>({actionId:a.action_id,actionType:a.action_type,actionAt:a.action_at,deviceId:a.device_id,...a}))};
  const envelope=await encryptEnvelope(payload,password,"SCMR1","STUDIO-COSTA-COMPANION-SCMR1");
  downloadJson(envelope,`StudioCostaMobile_Risposte_${new Date().toISOString().slice(0,16).replace(/[:T]/g,"-")}.scmr`);
  for(const a of actions){a.sync_status="ESPORTATA";await storePut("pending_mobile_actions",a)}
  updatePendingIndicator();renderHome();
}
async function encryptEnvelope(payload,password,format,aadText){
  const salt=crypto.getRandomValues(new Uint8Array(16)); const nonce=crypto.getRandomValues(new Uint8Array(12)); const iterations=300000;
  const material=await crypto.subtle.importKey("raw",new TextEncoder().encode(password),"PBKDF2",false,["deriveKey"]);
  const key=await crypto.subtle.deriveKey({name:"PBKDF2",hash:"SHA-256",salt,iterations},material,{name:"AES-GCM",length:256},false,["encrypt"]);
  const cipher=new Uint8Array(await crypto.subtle.encrypt({name:"AES-GCM",iv:nonce,additionalData:new TextEncoder().encode(aadText)},key,new TextEncoder().encode(JSON.stringify(payload))));
  const enc=b=>{let s="";b.forEach(x=>s+=String.fromCharCode(x));return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"")};
  return {format,formatVersion:1,iterations,salt:enc(salt),nonce:enc(nonce),ciphertext:enc(cipher),createdAt:new Date().toISOString()};
}
function downloadJson(data,name){const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)}

function openLocalTask(id=""){
  populatePracticeSelect();
  const task=localTasks.find(t=>t.id===id)||{};
  $("localTaskModal").classList.remove("hidden");
  $("localTaskId").value=task.id||"";
  $("localCategory").value=task.category||"APPUNTAMENTO";
  $("localPractice").value=String(task.practice_id||"");
  $("localTitle").value=task.title||"";
  $("localDate").value=task.date||new Date().toISOString().slice(0,10);
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
async function exportLocalTasks(){const password=prompt("Password backup attività locali (almeno 8 caratteri)");if(!password||password.length<8)return;const payload={formatVersion:1,deviceId:deviceId(),createdAt:new Date().toISOString(),localTasks};const env=await encryptEnvelope(payload,password,"SCL1","STUDIO-COSTA-LOCAL-TASKS-SCL1");downloadJson(env,`AttivitaLocaliCosta_${new Date().toISOString().slice(0,10)}.scl`)}
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
  const cresetIds=new Set((candidate.creset||[]).map(i=>String(i.id)));
  const hearings=new Map((candidate.events||[]).filter(e=>e.source_type==="HEARING").map(e=>[String(e.source_id),e]));
  const kept=[];
  const confirmedLocalIds=new Set();
  for(const action of pendingMobileActions){
    let applied=false;
    if(["complete_checklist_item","reopen_checklist_item"].includes(action.action_type))applied=checklist.get(String(action.checklist_item_id))===String(action.new_status||"");
    else if(["hearing_checklist_status","complete_hearing_checklist_item","reopen_hearing_checklist_item"].includes(action.action_type))applied=hearingChecklist.get(String(action.hearing_checklist_item_id||action.target_id))===String(action.new_status||"");
    else if(["task_status","complete_task","reopen_task"].includes(action.action_type))applied=tasks.get(String(action.task_id||action.target_id))===String(action.new_status||"");
    else if(action.action_type==="upsert_task")applied=taskMobile.has(String(action.mobile_uid||action.target_id));
    else if(action.action_type==="upsert_appointment")applied=apptMobile.has(String(action.mobile_uid||action.target_id));
    else if(action.action_type==="upsert_hearing")applied=hearingMobile.has(String(action.mobile_uid||action.target_id));
    else if(["creset_mark_worked","creset_mark_constituted"].includes(action.action_type))applied=!cresetIds.has(String(action.position_id||action.target_id));
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

function populatePracticeSelect(){
  const select=$("localPractice");if(!select||!snapshot)return;
  const current=select.value;
  const rows=[...(snapshot.practices||[])].sort((a,b)=>String(a.assistito||"").localeCompare(String(b.assistito||""),"it"));
  select.innerHTML='<option value="">Nessuna pratica</option>'+rows.map(p=>`<option value="${escapeHtml(p.id)}">${escapeHtml([p.assistito,p.numero_principale||p.rgnr||p.rg,p.area].filter(Boolean).join(" · "))}</option>`).join("");
  if(rows.some(p=>String(p.id)===String(current)))select.value=current;
}
function updateLocalFormMode(){
  const category=$("localCategory")?.value||"";
  const isHearing=category==="UDIENZA";
  $("hearingExtraFields")?.classList.toggle("hidden",!isHearing);
  $("localPrivateRow")?.classList.toggle("hidden",isHearing);
  if(isHearing){
    $("localPrivate").checked=false;
    $("localBusy").checked=true;
    $("localModalTitle").textContent="Nuova udienza";
  }else{
    if($("localFirstHearing")) $("localFirstHearing").checked=false;
    $("localModalTitle").textContent=category==="APPUNTAMENTO"?"Nuovo appuntamento":"Nuova attività";
  }
}
function updatePendingIndicator(){
  const count=pendingMobileActions.filter(a=>a.sync_status!=="IMPORTATA_DAL_GESTIONALE").length;
  if($("quickExportActions"))$("quickExportActions").textContent=`${count} ${count===1?"modifica":"modifiche"}`;
  if($("pendingActionsInfo"))$("pendingActionsInfo").textContent=count?`${count} modifiche registrate sul telefono da importare nel gestionale.`:"Nessuna modifica in attesa.";
}
function openSettings(){
  renderPrivacy();updatePendingIndicator();
  $("settingsModal")?.classList.remove("hidden");
  document.body.style.overflow="hidden";
}
function closeSettings(){
  $("settingsModal")?.classList.add("hidden");
  document.body.style.overflow="";
}
function openHearingOutcome(id){
  const h=hearingEventById(id);if(!h)return;
  const p=practiceById(h.practice_id);
  $("outcomeHearingId").value=String(id);
  $("hearingOutcomeTitle").textContent=[p?.assistito,h.title,fmtDate(h.event_date)].filter(Boolean).join(" · ");
  $("outcomeValue").value="";
  $("outcomeNextDate").value="";
  $("outcomeNextTime").value="";
  $("outcomeReason").value="";
  $("outcomeTermsGranted").checked=false;
  $("outcomeJudgeOrders").value="";
  $("outcomePerformed").value="";
  $("hearingOutcomeModal").classList.remove("hidden");
  document.body.style.overflow="hidden";
}
function closeHearingOutcome(){
  $("hearingOutcomeModal")?.classList.add("hidden");
  document.body.style.overflow="";
}
async function saveHearingOutcome(){
  const id=$("outcomeHearingId").value;
  const h=hearingEventById(id);if(!h)return;
  let outcome=$("outcomeValue").value;
  const next=$("outcomeNextDate").value;
  const nextTime=$("outcomeNextTime").value;
  const reason=$("outcomeReason").value.trim();
  const termsGranted=$("outcomeTermsGranted").checked;
  const orders=$("outcomeJudgeOrders").value.trim();
  const performed=$("outcomePerformed").value.trim();
  if(next&&!outcome)outcome="RINVIO";
  if(!outcome&&!next&&!orders&&!performed){alert("Indicare almeno l'esito, il rinvio o un provvedimento.");return}
  const outcomeCategory={"RINVIO":"RINVIO","DISCUSSIONE":"DISCUSSIONE","RISERVA":"RISERVA","SENTENZA":"DECISIONE/SENTENZA","CTU AMMESSA":"CTU","TERMINI CONCESSI":"TERMINI GIUDICE","ALTRO":"ALTRO"}[outcome]||outcome;
  await queueMobileAction({
    action_type:"hearing_outcome",hearing_id:h.source_id,target_id:h.source_id,practice_id:h.practice_id,
    outcome,outcome_category:outcomeCategory,next_hearing_date:next,next_hearing_time:nextTime,adjournment_reason:reason,
    terms_granted:termsGranted?"SÌ":"",judge_orders:orders,performed_activities:performed,note:"",base_updated_at:h.updated_at||""
  });
  closeHearingOutcome();renderAll();
}
function renderGlobalSearch(){
  const root=$("globalSearchResults");if(!root||!snapshot)return;
  const q=normalize($("globalSearch")?.value||"");
  if(!q){root.innerHTML='<div class="empty">Cerca un assistito, un numero di ruolo, un’udienza, un’attività o un documento.</div>';return}
  const practices=(snapshot.practices||[]).filter(p=>searchBlob(p).includes(q)).slice(0,20);
  const events=calendarItems().filter(e=>normalize([e.title,e.practice_name,e.practice_code,e.location,e.notes,fmtDate(e.event_date)].filter(Boolean).join(" ")).includes(q)).slice(0,20);
  const documents=(snapshot.documents||[]).filter(d=>normalize([d.filename,d.category,d.document_type].filter(Boolean).join(" ")).includes(q)).slice(0,20);
  const legal=(snapshot.legalLibrary||[]).filter(r=>normalize([r.title,r.item_type,r.matter,r.keywords,r.code_name,r.article_number,r.heading,r.summary,r.text_body,r.notes,r.source_name,r.authority,r.decision_number].filter(Boolean).join(" ")).includes(q)).slice(0,20);
  root.innerHTML=`
    ${practices.length?`<section class="search-group"><h3>Pratiche <span>${practices.length}</span></h3>${practices.map(practiceCard).join("")}</section>`:""}
    ${events.length?`<section class="search-group"><h3>Agenda <span>${events.length}</span></h3>${events.map(eventCard).join("")}</section>`:""}
    ${documents.length?`<section class="search-group"><h3>Documenti <span>${documents.length}</span></h3>${documents.map(d=>{const p=practiceById(d.practice_id);return `<article class="search-document"><strong>${escapeHtml(d.filename||"Documento")}</strong><span>${escapeHtml([p?.assistito,d.category,d.document_type].filter(Boolean).join(" · "))}</span>${p?`<button data-practice="${escapeHtml(p.id)}">Apri pratica</button>`:""}</article>`}).join("")}</section>`:""}
    ${legal.length?`<section class="search-group"><h3>Banca giuridica <span>${legal.length}</span></h3>${legal.map(r=>`<article class="search-document"><strong>${escapeHtml(r.title||[r.code_name,r.article_number,r.heading].filter(Boolean).join(" · ")||"Voce giuridica")}</strong><span>${escapeHtml([r.item_type,r.matter,r.authority||r.source_name].filter(Boolean).join(" · "))}</span></article>`).join("")}</section>`:""}
    ${!practices.length&&!events.length&&!documents.length&&!legal.length?'<div class="empty">Nessun risultato.</div>':""}`;
  bindPracticeLinks(root);
}

function detailField(label,value){
  return nonEmpty(value)?`<div class="detail-field"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`:"";
}
function section(title,content){
  return content&&content.trim()?`<section class="detail-section"><h3>${escapeHtml(title)}</h3>${content}</section>`:"";
}
function listItems(items,formatter){
  if(!items||!items.length)return "";
  return `<div class="detail-list">${items.map(formatter).join("")}</div>`;
}
function dataFields(object,mapping){
  if(!object)return "";
  return `<div class="detail-fields">${mapping.map(([label,key])=>detailField(label,object[key])).join("")}</div>`;
}
function processFields(p){
  if(p.area==="PENALE"){
    return dataFields(p,[
      ["RGNR","rgnr"],["SIUS","sius"],["SIEP","siep"],["Autorità","autorita"],
      ["Tribunale","tribunale"],["Giudice","giudice"],["Fase","fase"],
      ["Qualità processuale","ruolo_processuale"],["Tipologia difesa","tipologia_difesa"],
      ["Stato difesa","stato_difesa"],["Articoli di reato","articoli_reato"],
      ["Descrizione reato","descrizione_reato"],["Misura cautelare","misura_cautelare"]
    ]);
  }
  if(p.area==="CIVILE"){
    return dataFields({...p,...(p.dati_civili||{})},[
      ["Codice / RG","rg"],["Autorità","autorita"],["Tribunale","tribunale"],
      ["Sezione","sezione"],["Giudice","giudice"],["Materia","materia"],
      ["Sottocategoria","sottocategoria"],["Fase","fase"],
      ["Tipo procedimento","tipo_procedimento"],["Valore","valore"],
      ["Numero mediazione","mediazione_numero"],["Organismo","organismo_mediazione"],
      ["Sede mediazione","sede_mediazione"]
    ]);
  }
  return dataFields({...p,...(p.dati_tributari||{})},[
    ["Numero RG","numero_rg"],["Autorità","autorita"],["Oggetto","oggetto"],
    ["Controparte","controparte"],["Stato","stato"],["Fase","fase"]
  ]);
}
function eventDetailItem(e){
  return `<div class="detail-item"><strong>${fmtDate(e.event_date)}${e.start_time?` · ${escapeHtml(e.start_time)}`:""} — ${escapeHtml(e.title||e.category)}</strong><span>${escapeHtml(e.location||e.notes||e.status||"")}</span></div>`;
}
function documentButton(doc){
  return `<button class="document-button" data-document="${doc.id}"><span>${escapeHtml(doc.filename)}</span><span>${Math.max(1,Math.round((doc.size_bytes||0)/1024))} KB</span></button>`;
}
function openPractice(id){
  const p=practiceById(id);
  if(!p)return;
  $("detailTitle").textContent=p.assistito||"Pratica";
  $("detailSync").textContent=`Ultima sincronizzazione: ${fmtDateTime(snapshot.generated_at)}`;
  const privacy=privacySettings();
  const docs=privacy.hideDocuments?[]:(snapshot.documents||[]).filter(d=>String(d.practice_id)===String(p.id));
  const folderDocs=(snapshot.folderDocuments||[]).filter(d=>String(d.practice_id)===String(p.id));
  const c=p.assistito_contatti||{};
  const essentialContacts=dataFields(c,[
    ["Codice fiscale","codice_fiscale"],["Indirizzo","indirizzo"],
    ["Comune","comune"],["CAP","cap"],["Provincia","provincia"]
  ]);
  const extraContacts=dataFields(c,[
    ["Data di nascita","data_nascita"],["Luogo di nascita","luogo_nascita"],
    ["Residenza","residenza"],["Domicilio","domicilio"],
    ["Telefono","telefono"],["E-mail","email"],["PEC","pec"]
  ]);
  const summary=dataFields(p,[
    ["Area","area"],["Tipologia","tipologia"],["Numero principale","numero_principale"],
    ["Autorità","autorita"],["Stato","stato"],["Fase","fase"],
    ["Oggetto","oggetto"],["Controparte","controparte"]
  ]);
  const nextH=p.prossima_udienza?eventCard(p.prossima_udienza):`<p class="muted">Nessuna prossima udienza registrata.</p>`;
  const deadlines=listItems(p.scadenze,eventDetailItem);
  const activities=listItems(p.attivita,eventDetailItem);
  const history=listItems([...(p.storico_udienze||[])].sort(eventSort).reverse(),eventDetailItem);
  $("practiceDetail").innerHTML=`
    <div class="detail-hero">
      <div class="eyebrow">${escapeHtml(p.area||"PRATICA")}</div>
      <h3>${escapeHtml(p.assistito||"")}</h3>
      <div class="sub">${escapeHtml(p.numero_principale||"")}${p.tipologia?` · ${escapeHtml(p.tipologia)}`:""}</div>
    </div>
    ${section("Essenziale",summary)}
    ${section("Dati processuali",processFields(p))}
    ${section("Prossima udienza",nextH)}
    ${section("Scadenze",deadlines)}
    ${section("Attività manuali / promemoria",activities)}
    ${section("Cronologia udienze",history)}
    ${section("Assistito",essentialContacts)}
    ${extraContacts?`<details class="detail-disclosure"><summary>Altri dati già presenti</summary>${extraContacts}</details>`:""}
    ${section("Documenti disponibili offline",docs.length?docs.map(documentButton).join(""):`<p class="muted">Nessun documento autorizzato offline.</p>`)}
    ${section("Indice cartella fascicolo",folderDocs.length?folderDocs.map(d=>`<div class="detail-item"><strong>${escapeHtml(d.file_name||"")}</strong><span>${escapeHtml(d.relative_path||"")}</span></div>`).join(""):`<p class="muted">Nessun file indicizzato.</p>`)}
    ${section("Fonti collegate",(snapshot.legalLibrary||[]).filter(r=>(r.practice_ids||[]).map(String).includes(String(p.id))).map(r=>`<div class="detail-item"><strong>${escapeHtml(r.title||"Fonte giuridica")}</strong><span>${escapeHtml([r.item_type,r.matter,r.authority||r.source_name].filter(Boolean).join(" · "))}</span></div>`).join(""))}
    ${(!privacy.hideNotes&&p.note)?section("Note autorizzate",`<div class="note-box">${escapeHtml(p.note)}</div>`):""}
  `;
  $("practiceModal").classList.remove("hidden");
  document.body.style.overflow="hidden";
  document.querySelectorAll("[data-document]").forEach(button=>{button.onclick=()=>openDocument(button.dataset.document)});
  bindPracticeLinks($("practiceDetail"));
}
function openDocument(id){
  const doc=(snapshot.documents||[]).find(d=>String(d.id)===String(id));
  if(!doc||!doc.content_base64)return;
  const bytes=b64bytes(doc.content_base64);
  const blob=new Blob([bytes],{type:doc.mime_type||"application/octet-stream"});
  const url=URL.createObjectURL(blob);
  window.open(url,"_blank");
  setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function closePractice(){
  $("practiceModal").classList.add("hidden");
  document.body.style.overflow="";
}

function privacySettings(){
  return Object.assign(
    {hideNotes:false,hideDocuments:false},
    JSON.parse(localStorage.getItem("studioPrivacy")||"{}")
  );
}
function savePrivacySettings(){
  const settings={
    hideNotes:$("hideNotesSetting").checked,
    hideDocuments:$("hideDocumentsSetting").checked
  };
  localStorage.setItem("studioPrivacy",JSON.stringify(settings));
}
function renderPrivacy(){
  const settings=privacySettings();
  $("hideNotesSetting").checked=!!settings.hideNotes;
  $("hideDocumentsSetting").checked=!!settings.hideDocuments;
  const practices=(snapshot?.practices||[]).length;
  const events=(snapshot?.events||[]).length;
  const documents=(snapshot?.documents||[]).length;
  $("localArchiveInfo").textContent=
    `Ultima sincronizzazione: ${fmtDateTime(snapshot?.generated_at)} · ${practices} pratiche · ${events} eventi · ${documents} documenti.`;
}
async function clearArchive(){
  if(!confirm("Eliminare l’archivio locale da questo iPhone?"))return;
  const db=await openDB();
  await new Promise((resolve,reject)=>{
    const tx=db.transaction("data","readwrite");
    tx.objectStore("data").clear();
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(tx.error);
  });
  snapshot=null;
  location.reload();
}

function renderAll(){
  renderHome();
  renderAgenda();
  renderChecklists();
  renderPractices();
  renderGlobalSearch();
  renderPlugins();
  renderPrivacy();
  updatePendingIndicator();
}

function bindChecklistNavigation(){
  const add=$("addChecklistMobile"); if(add)add.onclick=()=>addMobileChecklist();
  const todo=$("checklistTodo"),done=$("checklistDone");
  if(todo)todo.onclick=()=>{checklistMode="todo";todo.classList.add("active");done?.classList.remove("active");renderChecklists();};
  if(done)done.onclick=()=>{checklistMode="done";done.classList.add("active");todo?.classList.remove("active");renderChecklists();};
}
async function boot(){
  bindChecklistNavigation();
  const hasCache=await loadCached();
  if(hasCache){
    showApp();
  }else{
    $("emptyScreen").classList.remove("hidden");
  }
}
const companionFileInput=$("companionFile");
if(companionFileInput){
  companionFileInput.onchange=()=>{
    const label=$("companionFileName");
    if(label)label.textContent=companionFileInput.files?.[0]?.name||"Nessun file selezionato";
  };
}
$("companionFilePicker")?.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();$("companionFile")?.click()}});
$("companionImportButton").onclick=async()=>{
  $("pairError").textContent="";
  const button=$("companionImportButton");
  button.disabled=true; button.textContent="Importazione in corso…";
  try{
    await importCompanionFile($("companionFile").files[0],$("companionPassword").value);
    showApp();
  }catch(error){$("pairError").textContent=error.message}
  finally{button.disabled=false;button.textContent="Importa aggiornamento"}
};
document.querySelectorAll(".bottom-nav button").forEach(button=>{button.onclick=()=>switchView(button.dataset.target)});
document.querySelectorAll("[data-tool]").forEach(button=>{button.onclick=()=>{activeTool=button.dataset.tool;renderPlugins()}});
$("legalSearch")?.addEventListener("input",renderLegalResults);
$("legalTypeFilter")?.addEventListener("change",renderLegalResults);
if($("calculateQuickTerm"))$("calculateQuickTerm").onclick=calculateQuickTerm;
if($("calculateSplit"))$("calculateSplit").onclick=calculateMobileSplit;
if($("openChecklistsFromTools"))$("openChecklistsFromTools").onclick=()=>switchView("checklistsView");
document.querySelectorAll("[data-agenda-mode]").forEach(button=>{
  button.onclick=()=>{
    agendaMode=button.dataset.agendaMode;
    agendaSelectedDay=$("agendaDate").value||new Date().toISOString().slice(0,10);
    document.querySelectorAll("[data-agenda-mode]").forEach(b=>b.classList.toggle("active",b===button));
    renderAgenda();
  };
});
$("agendaPrev").onclick=()=>{const current=$("agendaDate").value||new Date().toISOString().slice(0,10);$("agendaDate").value=addDays(current,agendaMode==="day"?-1:agendaMode==="week"?-7:-30);agendaSelectedDay=$("agendaDate").value;renderAgenda()};
$("agendaNext").onclick=()=>{const current=$("agendaDate").value||new Date().toISOString().slice(0,10);$("agendaDate").value=addDays(current,agendaMode==="day"?1:agendaMode==="week"?7:30);agendaSelectedDay=$("agendaDate").value;renderAgenda()};
$("agendaToday").onclick=()=>{$("agendaDate").value=new Date().toISOString().slice(0,10);agendaSelectedDay=$("agendaDate").value;renderAgenda()};
$("agendaDate").onchange=()=>{agendaSelectedDay=$("agendaDate").value;renderAgenda()};
["practiceSearch","areaFilter","officeFilter","hearingFilter","deadlineFilter"].forEach(id=>{$(id).addEventListener(id==="practiceSearch"?"input":"change",renderPractices)});
$("globalSearch").addEventListener("input",renderGlobalSearch);
$("hideNotesSetting").onchange=()=>{savePrivacySettings();renderAll()};
$("hideDocumentsSetting").onchange=()=>{savePrivacySettings();renderAll()};
$("clearLocalArchive").onclick=()=>clearArchive().catch(error=>alert(error.message));
$("emptyImportButton").onclick=openImportScreen;
$("privacyImportButton").onclick=openImportScreen;
$("settingsButton").onclick=openSettings;
$("closeSettings").onclick=closeSettings;
$("quickExportActions").onclick=()=>exportMobileActions().catch(e=>alert(e.message));
$("closePractice").onclick=closePractice;
window.addEventListener("popstate",closePractice);
if("serviceWorker" in navigator && location.protocol.startsWith("http")){ensureOfflineShell().catch(()=>{})}
$("addLocalTask").onclick=()=>openLocalTask();
$("closeLocalTask").onclick=closeLocalTask;
$("localCategory").onchange=updateLocalFormMode;
$("saveLocalTask").onclick=()=>saveLocalTask().catch(e=>alert(e.message));
$("deleteLocalTask").onclick=()=>deleteLocalTask().catch(e=>alert(e.message));
$("closeHearingOutcome").onclick=closeHearingOutcome;
$("saveHearingOutcome").onclick=()=>saveHearingOutcome().catch(e=>alert(e.message));
$("exportMobileActions").onclick=()=>exportMobileActions().catch(e=>alert(e.message));
$("exportLocalTasks").onclick=()=>exportLocalTasks().catch(e=>alert(e.message));
$("importLocalTasks").onclick=async()=>{const file=$("localTasksFile").files[0];if(!file)return;const password=prompt("Password del backup attività locali");if(!password)return;try{await importLocalTasksFile(file,password);alert("Attività locali importate.")}catch(e){alert(e.message)}};
$("exportCalendarIcs").onclick=exportCalendarIcs;
boot().catch(error=>{$("emptyScreen").classList.remove("hidden");$("emptyScreen").querySelector("p").textContent=error.message});


document.querySelectorAll("[data-top-target]").forEach(button=>button.addEventListener("click",()=>switchView(button.dataset.topTarget)));
