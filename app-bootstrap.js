function renderAll(){
  renderHome();
  renderHearings();
  renderAgenda();
  if($("plannerView"))renderMobilePlanner($("plannerDate")?.value||plannerLocalToday(),calendarItems().sort(eventSort));
  renderChecklists();
  renderPractices();
  renderGlobalSearch();
  renderPlugins();
  renderPrivacy();
  updatePendingIndicator();
}

function bindChecklistNavigation(){
  const add=$("addChecklistMobile"); if(add)add.onclick=()=>addMobileChecklist();
  const close=$("closeChecklistComposer"); if(close)close.onclick=()=>closeChecklistComposer();
  const clear=$("clearChecklistComposer"); if(clear)clear.onclick=()=>{$("checklistComposerItems").value="";$("checklistComposerTitle").focus();};
  const save=$("saveChecklistComposer"); if(save)save.onclick=()=>saveChecklistComposer();
  const todo=$("checklistTodo"),done=$("checklistDone");
  if(todo)todo.onclick=()=>{checklistMode="todo";todo.classList.add("active");done?.classList.remove("active");renderChecklists();};
  if(done)done.onclick=()=>{checklistMode="done";done.classList.add("active");todo?.classList.remove("active");renderChecklists();};
}
async function boot(){
  bindChecklistNavigation();
  const state=await CompanionVault.inspect();
  // Se il vecchio archivio era cifrato, è conservato separatamente: nessun PIN o password.
  for(const name of ['pairLegacyNotice','emptyLegacyNotice']){
    const notice=$(name);if(notice)notice.classList.toggle('hidden',!state.preservedLegacy);
  }
  if(state.mode==='new')await CompanionVault.setupDevice();
  else await CompanionVault.openAutomatically();
  await bootUnlocked();
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
    await importCompanionFile($("companionFile").files[0]);
    showApp();
  }catch(error){$("pairError").textContent=error.message}
  finally{button.disabled=false;button.textContent="Importa aggiornamento"}
};
document.querySelectorAll(".bottom-nav button").forEach(button=>{button.onclick=()=>switchView(button.dataset.target)});
$("applyUpdate")?.addEventListener("click",companionApplyUpdate);
$("laterUpdate")?.addEventListener("click",()=>$("updateNotice")?.classList.add("hidden"));
companionNetworkStatus();
document.querySelectorAll("[data-tool]").forEach(button=>{button.onclick=()=>{activeTool=button.dataset.tool;renderPlugins()}});
$("legalSearch")?.addEventListener("input",renderLegalResults);
$("legalTypeFilter")?.addEventListener("change",renderLegalResults);
if($("calculateQuickTerm"))$("calculateQuickTerm").onclick=calculateQuickTerm;
if($("calculateHalfInvoice"))$("calculateHalfInvoice").onclick=calculateHalfInvoiceMobile;
if($("calculateReserve"))$("calculateReserve").onclick=calculateReserveMobile;
if($("calculateSplit"))$("calculateSplit").onclick=calculateMobileSplit;
$("splitMode")?.addEventListener("change",updateSplitMode);
if($("calculateLocalTaxes"))$("calculateLocalTaxes").onclick=calculateLocalTaxesMobile;
$("taxViolation")?.addEventListener("change",syncTaxFields);
$("taxActType")?.addEventListener("change",syncTaxFields);
$("documentSearch")?.addEventListener("input",renderDocumentsTool);
$("documentCategoryFilter")?.addEventListener("change",renderDocumentsTool);
if($("openChecklistsFromTools"))$("openChecklistsFromTools").onclick=()=>switchView("checklistsView");
$("checklistComposerModal")?.addEventListener("click",event=>{if(event.target.id==="checklistComposerModal")closeChecklistComposer()});
document.addEventListener("keydown",event=>{if(event.key==="Escape")closeChecklistComposer()});

document.querySelectorAll("[data-agenda-mode]").forEach(button=>{
  button.onclick=()=>{
    agendaMode=button.dataset.agendaMode;
    agendaSelectedDay=$("agendaDate").value||plannerLocalToday();
    document.querySelectorAll("[data-agenda-mode]").forEach(b=>b.classList.toggle("active",b===button));
    renderAgenda();
  };
});
$("agendaPrev").onclick=()=>{const current=$("agendaDate").value||plannerLocalToday();$("agendaDate").value=shiftPeriod(current,agendaMode==="month"?"month":agendaMode==="day"?"day":"week",-1);agendaSelectedDay=$("agendaDate").value;renderAgenda()};
$("agendaNext").onclick=()=>{const current=$("agendaDate").value||plannerLocalToday();$("agendaDate").value=shiftPeriod(current,agendaMode==="month"?"month":agendaMode==="day"?"day":"week",1);agendaSelectedDay=$("agendaDate").value;renderAgenda()};
$("agendaToday").onclick=()=>{$("agendaDate").value=plannerLocalToday();agendaSelectedDay=$("agendaDate").value;renderAgenda()};
$("agendaDate").onchange=()=>{agendaSelectedDay=$("agendaDate").value;renderAgenda()};
$("hearingPrev").onclick=()=>{const current=$("hearingDate").value||plannerLocalToday();$("hearingDate").value=shiftPeriod(current,hearingMode,-1);hearingSelectedDay=$("hearingDate").value;renderHearings()};
$("hearingNext").onclick=()=>{const current=$("hearingDate").value||plannerLocalToday();$("hearingDate").value=shiftPeriod(current,hearingMode,1);hearingSelectedDay=$("hearingDate").value;renderHearings()};
$("hearingToday").onclick=()=>{$("hearingDate").value=plannerLocalToday();hearingSelectedDay=$("hearingDate").value;renderHearings()};
$("hearingDate").onchange=()=>{hearingSelectedDay=$("hearingDate").value;renderHearings()};
document.querySelectorAll("[data-hearing-mode]").forEach(button=>{button.onclick=()=>{hearingMode=button.dataset.hearingMode;hearingSelectedDay=$("hearingDate").value||plannerLocalToday();document.querySelectorAll("[data-hearing-mode]").forEach(b=>b.classList.toggle("active",b===button));renderHearings();};});
$("practiceSearch")?.addEventListener("input",renderPractices);
  document.querySelectorAll("[data-practice-filter]").forEach(button=>button.onclick=()=>{activePracticeFilter=button.dataset.practiceFilter;renderPractices()});
$("globalSearch").addEventListener("input",renderGlobalSearch);
$("hideNotesSetting").onchange=()=>{savePrivacySettings();renderAll()};
$("hideDocumentsSetting").onchange=()=>{savePrivacySettings();renderAll()};
$("clearLocalArchive").onclick=()=>clearArchive().catch(error=>alert(error.message));
$("clearAllLocalData").onclick=()=>clearAllLocalData().catch(error=>alert(error.message));
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
$("importLocalTasks").onclick=async()=>{const file=$("localTasksFile").files[0];if(!file)return;try{await importLocalTasksFile(file);alert("Attività locali importate.")}catch(e){alert(e.message)}};
$("exportCalendarIcs").onclick=exportCalendarIcs;
boot().catch(error=>{companionVaultUI();$('vaultHeading').textContent='Archivio non disponibile';$('vaultExplanation').textContent='Nessun dato è stato eliminato. Non cancellare i dati del browser.';$('vaultError').textContent=error.message;});


document.querySelectorAll("[data-top-target]").forEach(button=>button.addEventListener("click",()=>switchView(button.dataset.topTarget)));

// V19 — navigazione del Planner indipendente dall'Agenda.
if($('plannerDate'))$('plannerDate').value=plannerLocalToday();
const plannerMove=(days)=>{const base=$('plannerDate').value||plannerLocalToday();$('plannerDate').value=addDays(base,days);renderMobilePlanner($('plannerDate').value,calendarItems());};
if($('plannerPrev'))$('plannerPrev').onclick=()=>plannerMove(-1);
if($('plannerNext'))$('plannerNext').onclick=()=>plannerMove(1);
if($('plannerToday'))$('plannerToday').onclick=()=>{$('plannerDate').value=plannerLocalToday();renderMobilePlanner($('plannerDate').value,calendarItems());};
if($('plannerDate'))$('plannerDate').onchange=()=>renderMobilePlanner($('plannerDate').value,calendarItems());
