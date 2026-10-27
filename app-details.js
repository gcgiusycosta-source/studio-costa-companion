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
  if(!q){root.innerHTML='<div class="empty">Cerca un assistito, un numero di ruolo, un’udienza, un documento, una checklist o una posizione Creset.</div>';return}
  const practices=(snapshot.practices||[]).filter(p=>searchBlob(p).includes(q)).slice(0,20);
  const events=calendarItems().filter(e=>normalize([e.title,e.practice_name,e.practice_code,e.location,e.notes,fmtDate(e.event_date)].filter(Boolean).join(" ")).includes(q)).slice(0,20);
  const documents=(snapshot.documents||[]).filter(d=>{const p=practiceById(d.practice_id);return normalize([d.filename,d.category,d.document_type,p?.assistito].filter(Boolean).join(" ")).includes(q)}).slice(0,20);
  const legal=(snapshot.legalLibrary||[]).filter(r=>normalize([r.title,r.item_type,r.matter,r.keywords,r.code_name,r.article_number,r.heading,r.summary,r.text_body,r.notes,r.source_name,r.authority,r.decision_number].filter(Boolean).join(" ")).includes(q)).slice(0,20);
  const checklists=(snapshot.checklists||[]).filter(c=>{const items=(snapshot.checklistItems||[]).filter(i=>String(i.checklist_id)===String(c.checklist_id));return normalize([c.title,c.practice_name,c.priority,...items.map(i=>i.title)].filter(Boolean).join(" ")).includes(q)}).slice(0,20);
  const creset=(snapshot.creset||[]).filter(c=>normalize([c.taxpayer,c.municipality,c.rg_number,c.status,c.notes,c.participation_mode].filter(Boolean).join(" ")).includes(q)).slice(0,20);
  root.innerHTML=`
    ${practices.length?`<section class="search-group"><h3>Pratiche <span>${practices.length}</span></h3>${practices.map(practiceCard).join("")}</section>`:""}
    ${events.length?`<section class="search-group"><h3>Agenda <span>${events.length}</span></h3>${events.map(eventCard).join("")}</section>`:""}
    ${documents.length?`<section class="search-group"><h3>Documenti <span>${documents.length}</span></h3>${documents.map(d=>{const p=practiceById(d.practice_id);return `<article class="search-document"><strong>${escapeHtml(d.filename||"Documento")}</strong><span>${escapeHtml([p?.assistito,d.category,d.document_type].filter(Boolean).join(" · "))}</span><div class="mobile-action-row"><button data-open-doc="${escapeHtml(d.id)}">Apri</button>${p?`<button class="secondary-button" data-practice="${escapeHtml(p.id)}">Pratica</button>`:""}</div></article>`}).join("")}</section>`:""}
    ${checklists.length?`<section class="search-group"><h3>Checklist <span>${checklists.length}</span></h3>${checklists.map(c=>`<article class="search-document"><strong>${escapeHtml(c.title||"Checklist")}</strong><span>${escapeHtml([c.date,c.priority,c.practice_name].filter(Boolean).join(" · "))}</span><button data-open-checklists>Apri checklist</button></article>`).join("")}</section>`:""}
    ${creset.length?`<section class="search-group"><h3>Creset <span>${creset.length}</span></h3>${creset.map(c=>`<article class="search-document"><strong>${escapeHtml(c.taxpayer||"Posizione Creset")}</strong><span>${escapeHtml([c.municipality,c.rg_number&&`RG ${c.rg_number}`,effectiveCresetStatus(c)].filter(Boolean).join(" · "))}</span><button data-open-creset>Apri Creset</button></article>`).join("")}</section>`:""}
    ${legal.length?`<section class="search-group"><h3>Banca giuridica <span>${legal.length}</span></h3>${legal.map(r=>`<article class="search-document"><strong>${escapeHtml(r.title||[r.code_name,r.article_number,r.heading].filter(Boolean).join(" · ")||"Voce giuridica")}</strong><span>${escapeHtml([r.item_type,r.matter,r.authority||r.source_name].filter(Boolean).join(" · "))}</span></article>`).join("")}</section>`:""}
    ${!practices.length&&!events.length&&!documents.length&&!checklists.length&&!creset.length&&!legal.length?'<div class="empty">Nessun risultato.</div>':""}`;
  bindPracticeLinks(root);root.querySelectorAll("[data-open-doc]").forEach(btn=>btn.onclick=()=>openDocument(btn.dataset.openDoc));root.querySelectorAll("[data-open-checklists]").forEach(btn=>btn.onclick=()=>switchView("checklistsView"));root.querySelectorAll("[data-open-creset]").forEach(btn=>btn.onclick=()=>{activeTool="creset";switchView("toolsView");renderPlugins()});
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
  return `<button class="document-button" data-document="${escapeHtml(doc.id)}"><span>${escapeHtml(doc.filename)}</span><span>${Math.max(1,Math.round((doc.size_bytes||0)/1024))} KB</span></button>`;
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

