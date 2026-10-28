const $=id=>document.getElementById(id);
function plannerLocalToday(){return CompanionCore.localDate();}
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
let hearingMode="week";
let hearingSelectedDay="";
let activePracticeFilter="all";
let activeTool="codes";

// Tutti i dati persistenti sensibili passano esclusivamente da CompanionStorage.
const {dbGet,dbSet,storeAll,storePut,storeDelete}=CompanionStorage;
function uid(){return (crypto.randomUUID?crypto.randomUUID():`${Date.now()}-${Math.random().toString(16).slice(2)}`)}
function deviceId(){
  let value=localStorage.getItem("studioCostaDeviceId");
  if(!value){value=`iphone-${uid()}`;localStorage.setItem("studioCostaDeviceId",value)}
  return value;
}

const COMPANION_BUILD=COMPANION_VERSION;
async function invalidateOldAppShell(){
  const key="studioCostaCompanionBuild";
  if(localStorage.getItem(key)===COMPANION_BUILD)return;
  // Non cancellare a mano la cache del service worker: la nuova versione si
  // attiva solo dopo precache completo e conferma dell'utente.
  localStorage.setItem(key,COMPANION_BUILD);
}


let _companionSWRegistration=null;
let _companionSWListening=false;
let _companionUserRequestedReload=false;
function companionShowPendingUpdate(registration){
  if(!registration?.waiting)return;
  const notice=$("updateNotice");
  if(notice)notice.classList.remove("hidden");
}
function companionNetworkStatus(){
  const node=$("networkStatus");
  if(!node)return;
  const online=navigator.onLine;
  node.textContent=online?"Connesso":"Offline";
  node.classList.toggle("is-offline",!online);
}
async function ensureOfflineShell(){
  companionNetworkStatus();
  if(!location.protocol.startsWith("http")||!("serviceWorker" in navigator))return false;
  const registration=await navigator.serviceWorker.register(
    "service-worker.js?v="+encodeURIComponent(COMPANION_BUILD),{scope:"./",updateViaCache:"none"}
  );
  _companionSWRegistration=registration;
  if(!_companionSWListening){
    _companionSWListening=true;
    navigator.serviceWorker.addEventListener("controllerchange",()=>{
      if(_companionUserRequestedReload)location.reload();
    });
    window.addEventListener("online",companionNetworkStatus);
    window.addEventListener("offline",companionNetworkStatus);
  }
  if(!registration._companionWatching){
    registration._companionWatching=true;
    registration.addEventListener("updatefound",()=>{
      const installing=registration.installing;
      if(!installing)return;
      installing.addEventListener("statechange",()=>{
        if(installing.state==="installed"&&navigator.serviceWorker.controller)companionShowPendingUpdate(registration);
      });
    });
  }
  companionShowPendingUpdate(registration);
  await registration.update().catch(()=>{});
  companionShowPendingUpdate(registration);
  await navigator.serviceWorker.ready;
  return true;
}
function companionApplyUpdate(){
  const registration=_companionSWRegistration;
  if(!registration?.waiting)return;
  const pending=pendingMobileActions.filter(a=>a.sync_status!=="IMPORTATA_DAL_GESTIONALE").length;
  const message=pending
    ?`Sono presenti ${pending} modifiche ancora da riportare al desktop. I dati registrati non saranno cancellati, ma prima di aggiornare è prudente esportare le modifiche e salvare eventuali campi aperti. Continuare?`
    :"Hai salvato le modifiche che stavi scrivendo? L'app verrà riaperta nella nuova versione, senza cancellare i dati locali.";
  if(!confirm(message))return;
  _companionUserRequestedReload=true;
  registration.waiting.postMessage({type:"ACTIVATE_UPDATE"});
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
  let parsed;
  if(packageData?.format==='SCM0'){
    parsed=await decodePlainExchange(packageData,'SCM0');
  }else{
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


  try{
    const plainText=new TextDecoder("utf-8").decode(decryptedBytes);
    parsed=JSON.parse(plainText);
  }catch(_){
    throw new Error("Contenuto decifrato non interpretabile come JSON.");
  }

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
    plannerWindows:Array.isArray(archiveData.plannerWindows)?archiveData.plannerWindows:[],
    plannerBlocks:Array.isArray(archiveData.plannerBlocks)?archiveData.plannerBlocks:[],
    plannerBlockExceptions:Array.isArray(archiveData.plannerBlockExceptions)?archiveData.plannerBlockExceptions:[],
    plannerProfileSettings:archiveData.plannerProfileSettings||{},
    plannerComputedDays:Array.isArray(archiveData.plannerComputedDays)?archiveData.plannerComputedDays:[],
    plannerTaskTargets:Array.isArray(archiveData.plannerTaskTargets)?archiveData.plannerTaskTargets:[],
    plannerUndatedTasks:Array.isArray(archiveData.plannerUndatedTasks)?archiveData.plannerUndatedTasks:[],
    plannerChecklistEstimates:Array.isArray(archiveData.plannerChecklistEstimates)?archiveData.plannerChecklistEstimates:[],
    plannerChecklistSessions:Array.isArray(archiveData.plannerChecklistSessions)?archiveData.plannerChecklistSessions:[],
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
    plannerWindows:decoded.plannerWindows,
    plannerBlocks:decoded.plannerBlocks,
    plannerBlockExceptions:decoded.plannerBlockExceptions,
    plannerProfileSettings:decoded.plannerProfileSettings,
    plannerComputedDays:decoded.plannerComputedDays,
    plannerTaskTargets:decoded.plannerTaskTargets,
    plannerUndatedTasks:decoded.plannerUndatedTasks,
    plannerChecklistEstimates:decoded.plannerChecklistEstimates,
    plannerChecklistSessions:decoded.plannerChecklistSessions,
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
// Calcoli di calendario eseguiti come date locali, senza conversioni UTC.
function addDays(dateString,days){return CompanionCore.addDays(dateString,days)}
function startOfWeek(dateString){return CompanionCore.startOfWeek(dateString)}
function monthBounds(dateString){return CompanionCore.monthBounds(dateString)}
function shiftPeriod(dateString,mode,step){return CompanionCore.shiftPeriod(dateString,mode,step)}

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
  if($("agendaDate"))$("agendaDate").value=plannerLocalToday();
  if($("hearingDate"))$("hearingDate").value=plannerLocalToday();
  populatePracticeSelect();
  document.body.dataset.activeView = activeView || "homeView";
  renderAll();
  updatePendingIndicator();
  ensureOfflineShell().then(ready=>updateOfflineStatus(ready)).catch(()=>updateOfflineStatus(false));
}

function switchView(target){
  activeView=target;
  document.body.dataset.activeView=target;
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("hidden",v.id!==target));
  document.querySelectorAll(".bottom-nav button").forEach(b=>{const active=b.dataset.target===target;b.classList.toggle("active",active);if(active)b.setAttribute("aria-current","page");else b.removeAttribute("aria-current")});
  document.querySelectorAll("[data-top-target]").forEach(b=>b.classList.toggle("active",b.dataset.topTarget===target));
  const titles={homeView:"Home",hearingsView:"Udienze",agendaView:"Agenda",plannerView:"Planner",checklistsView:"Checklist",practicesView:"Pratiche",toolsView:"Strumenti",searchView:"Ricerca"};
  if($("pageTitle"))$("pageTitle").textContent=titles[target]||"Studio Costa";
  if(target==="homeView")renderHome();
  if(target==="hearingsView")renderHearings();
  if(target==="agendaView")renderAgenda();
  if(target==="plannerView")renderMobilePlanner($("plannerDate")?.value||plannerLocalToday(),calendarItems().sort(eventSort));
  if(target==="checklistsView")renderChecklists();
  if(target==="practicesView")renderPractices();
  if(target==="toolsView")renderPlugins();
  if(target==="searchView")renderGlobalSearch();
  window.scrollTo({top:0,behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
}

async function makePlainExchange(payload,format){
  const text=JSON.stringify(payload);
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));
  return {format,formatVersion:1,encrypted:false,payload:text,sha256:Array.from(new Uint8Array(hash)).map(v=>v.toString(16).padStart(2,'0')).join('')};
}
async function decodePlainExchange(data,format){
  if(data?.format!==format||data.formatVersion!==1||typeof data.payload!=='string')throw new Error('Formato non valido');
  const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(data.payload));
  const digest=Array.from(new Uint8Array(hash)).map(v=>v.toString(16).padStart(2,'0')).join('');
  if(digest!==data.sha256)throw new Error('Checksum del file non valido');
  return JSON.parse(data.payload);
}
