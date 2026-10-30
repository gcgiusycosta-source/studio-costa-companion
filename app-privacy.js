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
// Archivio cifrato automaticamente con chiave locale non estraibile, senza password.
async function clearArchive(){
  const notImported=pendingMobileActions.filter(a=>a.sync_status!=="IMPORTATA_DAL_GESTIONALE");
  if(notImported.length){
    alert(`Ci sono ${notImported.length} modifiche non ancora confermate dal gestionale. Esportale e sincronizza col desktop prima di eliminare l'archivio.`);
    return;
  }
  if(!confirm("Eliminare SOLO l'archivio importato? Le attività locali e le modifiche già registrate resteranno sul dispositivo."))return;
  await CompanionVault.remove("data","snapshot");
  snapshot=null;
  location.reload();
}
async function clearAllLocalData(){
  const pendingCount=pendingMobileActions.filter(a=>a.sync_status!=="IMPORTATA_DAL_GESTIONALE").length;
  const hasOldArchive=await CompanionVault.preservedLegacyVault();
  const warning=`Eliminazione dei dati della Companion attiva: archivio, ${localTasks.length} attività locali e ${pendingCount} modifiche non confermate. Non sarà possibile recuperarli senza backup.${hasOldArchive?' Il precedente archivio cifrato, separato, sarà conservato intatto.':''} Continuare?`;
  if(!confirm(warning))return;
  if(prompt('Per confermare scrivi esattamente ELIMINA')!=="ELIMINA")return;
  await CompanionVault.clearEverything();
  for(const key of ["studioCostaDeviceId","studioPairToken","studioPrivacy"])localStorage.removeItem(key);
  snapshot=null;localTasks=[];pendingMobileActions=[];
  location.reload();
}
// Schermata di errore di archivio; nessuna richiesta di credenziali.
function companionVaultUI(){
  $('vaultScreen').classList.remove('hidden');
  $('pairScreen').classList.add('hidden');
  $('emptyScreen').classList.add('hidden');
  $('app').classList.add('hidden');
  $('vaultError').textContent='';
}
async function bootUnlocked(){
  $('vaultScreen').classList.add('hidden');
  const hasCache=await loadCached();
  if(hasCache)showApp();
  else $('emptyScreen').classList.remove('hidden');
}

