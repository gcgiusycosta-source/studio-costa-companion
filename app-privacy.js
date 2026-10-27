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
// Vault: lo snapshot e le azioni sono persistiti soltanto in forma cifrata.
async function clearArchive(){
  const notImported=pendingMobileActions.filter(a=>a.sync_status!=="IMPORTATA_DAL_GESTIONALE");
  if(notImported.length){
    alert(`Ci sono ${notImported.length} modifiche non ancora confermate dal gestionale. Esportale e sincronizza col desktop prima di eliminare l'archivio.`);
    return;
  }
  if(!confirm("Eliminare SOLO l'archivio importato? Le attività locali e le modifiche già registrate resteranno cifrate sul dispositivo."))return;
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
function openVaultPasswordChange(){
  closeSettings();
  ['vaultOldPassword','vaultNewPassword','vaultNewPasswordConfirm'].forEach(id=>$(id).value='');
  $('vaultChangeError').textContent='';
  $('changeVaultPasswordModal').classList.remove('hidden');
  document.body.style.overflow='hidden';
  $('vaultOldPassword').focus();
}
function closeVaultPasswordChange(){
  $('changeVaultPasswordModal').classList.add('hidden');
  ['vaultOldPassword','vaultNewPassword','vaultNewPasswordConfirm'].forEach(id=>$(id).value='');
  $('vaultChangeError').textContent='';
  document.body.style.overflow='';
}
async function saveVaultPasswordChange(){
  const oldPassword=$('vaultOldPassword').value;
  const newPassword=$('vaultNewPassword').value;
  const newConfirm=$('vaultNewPasswordConfirm').value;
  const button=$('saveVaultPasswordChange');
  $('vaultChangeError').textContent='';
  if(newPassword!==newConfirm){$('vaultChangeError').textContent='Le due nuove password non coincidono.';return;}
  button.disabled=true;
  try{
    await CompanionVault.changePassword(oldPassword,newPassword);
    closeVaultPasswordChange();
    companionLockNow(); // nuova password obbligatoria al successivo accesso
  }catch(error){$('vaultChangeError').textContent=error.message;}
  finally{button.disabled=false;}
}
function companionLockNow(){
  CompanionVault.lock();
  snapshot=null;localTasks=[];pendingMobileActions=[];
  // Ricaricare per rimuovere dal DOM i dettagli visualizzati e i campi compilati.
  location.reload();
}
let vaultActivityStarted=false;
function startVaultAutomaticLock(){
  if(vaultActivityStarted)return;
  vaultActivityStarted=true;
  let lastActivity=Date.now(),hiddenAt=null;
  const touch=()=>{lastActivity=Date.now();};
  for(const event of ['pointerdown','keydown','touchstart'])document.addEventListener(event,touch,{passive:true});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){hiddenAt=Date.now();return;}
    if(hiddenAt!==null&&Date.now()-hiddenAt>60000&&CompanionVault.isUnlocked())companionLockNow();
    hiddenAt=null;
  });
  setInterval(()=>{
    if(CompanionVault.isUnlocked() && Date.now()-lastActivity>=5*60*1000)companionLockNow();
  },30000);
}
function companionVaultUI(state){
  const setup=!state.initialized;
  $('vaultScreen').classList.remove('hidden');
  $('pairScreen').classList.add('hidden');
  $('emptyScreen').classList.add('hidden');
  $('app').classList.add('hidden');
  $('vaultHeading').textContent=setup?'Proteggi i dati locali':'Sblocca la Companion';
  $('vaultExplanation').textContent=setup
    ? state.legacyCount?`Sono presenti ${state.legacyCount} record della versione precedente non cifrati. Per proteggerli sarà eseguita una migrazione atomica: prima salva gli eventuali backup .scmr e .scl dalla V20.5.`:'Crea una password LOCALE di almeno 12 caratteri, distinta da quella del file .scmobile. Tutti i dati importati e le modifiche saranno cifrati sul dispositivo.'
    :'Inserisci la password locale impostata per questo dispositivo. Non è necessariamente la password del file .scmobile.';
  $('vaultConfirmRow').classList.toggle('hidden',!setup);
  $('vaultBackupRow').classList.toggle('hidden',!(setup&&state.legacyCount));
  $('vaultAction').textContent=setup?'Attiva protezione e continua':'Sblocca';
  $('vaultPassword').value='';$('vaultConfirm').value='';$('vaultError').textContent='';
  window._companionVaultState=state;
}
async function bootUnlocked(){
  $('vaultScreen').classList.add('hidden');
  const hasCache=await loadCached();
  startVaultAutomaticLock();
  if(hasCache)showApp();
  else $('emptyScreen').classList.remove('hidden');
}
async function vaultProceed(){
  const state=window._companionVaultState, password=$('vaultPassword').value;
  const button=$('vaultAction');button.disabled=true;
  $('vaultError').textContent='';
  try{
    if(!state.initialized){
      if(password!==$('vaultConfirm').value)throw Error('Le due password locali non coincidono.');
      if(state.legacyCount&&!$('vaultBackupConfirmed').checked)throw Error('Conferma di avere effettuato i backup prima della migrazione.');
      await CompanionVault.setup(password);
    }else await CompanionVault.unlock(password);
    $('vaultPassword').value='';$('vaultConfirm').value='';
    await bootUnlocked();
  }catch(error){$('vaultError').textContent=error.message;}
  finally{button.disabled=false;}
}

