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
  const warning=`Eliminazione completa dei dati nel browser: archivio, ${localTasks.length} attività locali e ${pendingCount} modifiche non confermate. Non sarà possibile recuperarle senza un backup. Continuare?`;
  if(!confirm(warning))return;
  if(prompt('Per confermare scrivi esattamente ELIMINA')!=="ELIMINA")return;
  await CompanionVault.clearEverything();
  for(const key of ["studioCostaDeviceId","studioPairToken","studioPrivacy"])localStorage.removeItem(key);
  snapshot=null;localTasks=[];pendingMobileActions=[];
  location.reload();
}
// La schermata di recupero compare soltanto per convertire un vecchio Vault V1.
function companionVaultUI(state){
  $('vaultScreen').classList.remove('hidden');
  $('pairScreen').classList.add('hidden');
  $('emptyScreen').classList.add('hidden');
  $('app').classList.add('hidden');
  $('vaultError').textContent='';
  $('vaultPassword').value='';
}
async function bootUnlocked(){
  $('vaultScreen').classList.add('hidden');
  const hasCache=await loadCached();
  if(hasCache)showApp();
  else $('emptyScreen').classList.remove('hidden');
}
async function vaultProceed(){
  const button=$('vaultAction');
  button.disabled=true;
  $('vaultError').textContent='';
  try{
    await CompanionVault.migratePasswordVault($('vaultPassword').value);
    $('vaultPassword').value='';
    await bootUnlocked();
  }catch(error){$('vaultError').textContent=error.message;}
  finally{button.disabled=false;}
}
