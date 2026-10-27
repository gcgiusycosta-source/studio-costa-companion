function parseEuro(value){return CompanionCore.parseEuro(value)}
function euro(value){return new Intl.NumberFormat("it-IT",{style:"currency",currency:"EUR"}).format(Number(value||0))}
function euroFromCents(cents){return euro((Number(cents)||0)/100)}
function centsFromInput(value){return Math.round(parseEuro(value)*100)}
const TFC_LAWYERS=["Avv. Giusy Costa","Avv. Maria Fazio","Avv. Maria Elena Tomassoni"];
function fillTfcLawyerSelects(){
  ["splitBilledBy","splitHolder","splitSigner","splitDrafter"].forEach(id=>{const el=$(id);if(!el)return;const current=el.value;el.innerHTML=TFC_LAWYERS.map(name=>`<option>${escapeHtml(name)}</option>`).join("");if(current&&TFC_LAWYERS.includes(current))el.value=current});
}
function calculateHalfInvoiceMobile(){
  const total=centsFromInput($("splitHalfTotal")?.value);if(total<=0)return alert("Inserire un importo totale valido.");
  const half=Math.round(total*50/100);$("splitHalfResult").innerHTML=`<span>Importo totale: ${euroFromCents(total)}</span><strong>50% da fatturare: ${euroFromCents(half)}</strong>`;
}
function reserveDataMobile(){
  const billed=centsFromInput($("splitBilledAmount")?.value);if(billed<=0)throw new Error("Inserire l'importo effettivamente fatturato.");
  const reserve=Math.round(billed*19/100);return {billed,reserve,net:billed-reserve,billedBy:$("splitBilledBy")?.value||TFC_LAWYERS[0]};
}
function calculateReserveMobile(){
  try{const x=reserveDataMobile();$("splitReserveResult").innerHTML=`<span>Importo fatturato: ${euroFromCents(x.billed)}</span><span>19% accantonato a ${escapeHtml(x.billedBy)}: ${euroFromCents(x.reserve)}</span><strong>Residuo da ripartire: ${euroFromCents(x.net)}</strong>`}catch(e){alert(e.message)}
}
function calculateMobileSplit(){
  let x;try{x=reserveDataMobile()}catch(e){return alert(e.message)}
  const mode=$("splitMode")?.value||"thirds";const allocations=[];
  if(mode==="thirds"){
    const q1=Math.round(x.net/3),q2=Math.round(x.net/3),q3=x.net-q1-q2;
    TFC_LAWYERS.forEach((name,i)=>allocations.push({name,pct:i<2?"33,333333":"33,333334",value:[q1,q2,q3][i],role:"Quota uguale"}));
  }else{
    const holder=$("splitHolder")?.value,signer=$("splitSigner")?.value,drafter=$("splitDrafter")?.value;
    if(!holder||!signer||!drafter)return alert("Selezionare titolare, firmatario e redattore.");
    const roleRows=[{name:"Studio TFC",pct:30,role:"Studio"},{name:holder,pct:30,role:"Titolare della pratica"},{name:signer,pct:10,role:"Firmatario"},{name:drafter,pct:30,role:"Redattore dell'atto"}];
    const order=[];const agg={};const roles={};
    roleRows.forEach(r=>{if(!(r.name in agg)){agg[r.name]=0;roles[r.name]=[];order.push(r.name)}agg[r.name]+=r.pct;roles[r.name].push(r.role)});
    let running=0;order.forEach((name,i)=>{const value=i<order.length-1?Math.round(x.net*agg[name]/100):x.net-running;running+=value;allocations.push({name,pct:agg[name],value,role:roles[name].join(" + ")})});
  }
  const totals={};allocations.forEach(a=>totals[a.name]=(totals[a.name]||0)+a.value);totals[x.billedBy]=(totals[x.billedBy]||0)+x.reserve;
  const allocationLines=allocations.map(a=>`<span>${escapeHtml(a.name)} — ${String(a.pct).replace(".",",")}%${a.role?` (${escapeHtml(a.role)})`:""}: ${euroFromCents(a.value)}${a.name==="Studio TFC"?' · resta allo Studio':''}</span>`).join("");
  const totalLines=Object.entries(totals).map(([name,value])=>`<strong>${escapeHtml(name)}: ${euroFromCents(value)}${name===x.billedBy?' · comprende il 19% accantonato':''}${name==="Studio TFC"?' · quota Studio':''}</strong>`).join("");
  $("splitResult").innerHTML=`<span>Fatturato: ${euroFromCents(x.billed)}</span><span>Accantonamento 19% → ${escapeHtml(x.billedBy)}: ${euroFromCents(x.reserve)}</span><span>Residuo da ripartire: ${euroFromCents(x.net)}</span><div class="result-divider"></div>${allocationLines}<div class="result-divider"></div>${totalLines}`;
}
function updateSplitMode(){const tfc=$("splitMode")?.value==="tfc";$("splitTfcRoles")?.classList.toggle("hidden",!tfc)}

function renderDocumentsTool(){
  const root=$("documentsToolResults");if(!root||!snapshot)return;
  if(privacySettings().hideDocuments){root.innerHTML='<div class="empty">La visualizzazione dei documenti è disattivata nelle impostazioni privacy.</div>';return}
  const docs=snapshot.documents||[];const filter=$("documentCategoryFilter");
  if(filter){const selected=filter.value||"";const cats=[...new Set(docs.map(d=>d.category||d.document_type).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),"it"));filter.innerHTML='<option value="">Tutte le categorie</option>'+cats.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");if(cats.includes(selected))filter.value=selected}
  const q=normalize($("documentSearch")?.value||"");const cat=filter?.value||"";
  const rows=docs.filter(d=>{const p=practiceById(d.practice_id);const blob=normalize([d.filename,d.category,d.document_type,p?.assistito,p?.numero_principale].filter(Boolean).join(" "));return (!q||blob.includes(q))&&(!cat||(d.category||d.document_type)===cat)}).slice(0,120);
  root.innerHTML=rows.length?rows.map(d=>{const p=practiceById(d.practice_id);return `<article class="search-document"><strong>${escapeHtml(d.filename||"Documento")}</strong><span>${escapeHtml([p?.assistito,d.category,d.document_type,d.size_bytes?`${Math.max(1,Math.round(d.size_bytes/1024))} KB`:""].filter(Boolean).join(" · "))}</span><div class="mobile-action-row"><button data-open-doc="${escapeHtml(d.id)}">Apri</button>${p?`<button class="secondary-button" data-practice="${escapeHtml(p.id)}">Pratica</button>`:""}</div></article>`}).join(""):'<div class="empty">Nessun documento corrispondente.</div>';
  root.querySelectorAll("[data-open-doc]").forEach(btn=>btn.onclick=()=>openDocument(btn.dataset.openDoc));bindPracticeLinks(root);
}

function isoDateFromParts(y,m,d){const dt=new Date(Date.UTC(y,m-1,d));return dt.toISOString().slice(0,10)}
function addDaysIso(iso,days){const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+Number(days||0));return d.toISOString().slice(0,10)}
function addYearsIso(iso,years){const d=new Date(`${iso}T12:00:00Z`);const month=d.getUTCMonth(),day=d.getUTCDate();d.setUTCFullYear(d.getUTCFullYear()+Number(years||0));if(d.getUTCMonth()!==month)d.setUTCDate(0);return d.toISOString().slice(0,10)}
function calculateLocalTaxesMobile(){
  const y=Number($("taxYear")?.value);if(!Number.isInteger(y)||y<1990||y>2100)return alert("Indicare un'annualità valida.");
  const declaration=$("taxViolation")?.value==="DECLARATION";let ref=y;if(declaration){const dy=Number($("taxDeclarationYear")?.value||y+1);if(!Number.isInteger(dy))return alert("Indicare l'anno in cui la dichiarazione era dovuta.");ref=dy}
  const ordinary=isoDateFromParts(ref+5,12,31);const covid=!!$("taxCovid")?.checked;const covidApplicable=covid&&ref>=2015&&ref<=2019&&ordinary>="2020-03-08";const finalDeadline=covidApplicable?addDaysIso(ordinary,85):ordinary;
  const lines=[];lines.push(`<strong>${escapeHtml($("taxType")?.value||"Tributo locale")} — annualità ${y}</strong>`);lines.push(`<span>Base decadenza: ${declaration?`anno dichiarazione dovuta ${ref}`:`anno del versamento ${ref}`}</span>`);lines.push(`<span>Termine ordinario ex art. 1, c. 161, L. 296/2006: ${fmtDate(ordinary)}</span>`);lines.push(`<strong>Termine risultante: ${fmtDate(finalDeadline)}${covidApplicable?' · +85 giorni COVID/IFEL':covid?' · sospensione COVID non applicabile automaticamente':''}</strong>`);
  const regime=$("taxRegime")?.value||"EXECUTIVE";const definitive=$("taxDefinitiveDate")?.value;const payment=$("taxPaymentDeadline")?.value;const notice=$("taxNoticeDate")?.value;
  lines.push('<div class="result-divider"></div><strong>Riscossione / esecutività</strong>');
  if(regime==="PREVIOUS"){
    if(definitive){let ordinaryTitle=isoDateFromParts(Number(definitive.slice(0,4))+3,12,31),title=ordinaryTitle,note="";const dy=Number(definitive.slice(0,4));if(covid&&[2017,2018].includes(dy)){title="2023-12-31";note=" · proroga COVID/IFEL"}else if(covid&&dy===2019){title="2024-06-25";note=" · proroga COVID/IFEL"}lines.push(`<span>Accertamento definitivo: ${fmtDate(definitive)}</span><span>Termine ordinario titolo coattivo: ${fmtDate(ordinaryTitle)}</span><strong>Termine titolo coattivo: ${fmtDate(title)}${note}</strong>`)}else lines.push('<span>Per il titolo coattivo separato indicare la data di definitività dell’accertamento.</span>');
  }else if(regime==="EXECUTIVE"){
    lines.push('<span>Accertamento esecutivo locale ex art. 1, c. 792, L. 160/2019: il medesimo avviso può costituire titolo esecutivo senza successiva cartella/ingiunzione.</span>');if(notice)lines.push(`<span>Notifica indicata: ${fmtDate(notice)}</span>`);if(payment){const entrusted=addDaysIso(payment,30),reference=addDaysIso(payment,60);lines.push(`<span>Scadenza ricorso/pagamento: ${fmtDate(payment)}</span><span>Affidamento in carico decorsi 30 giorni: ${fmtDate(entrusted)}</span><span>Riferimento 60 giorni per la riscossione: ${fmtDate(reference)}</span>`);const cm=$("taxCollectorMode")?.value;if(cm==="SAME"||cm==="OTHER"){const days=cm==="SAME"?120:180;lines.push(`<strong>Sospensione teorica esecuzione dall'affidamento: ${days} giorni → ${fmtDate(addDaysIso(entrusted,days))}</strong>`)}}else lines.push('<span>Per la timeline operativa indicare la scadenza del termine di ricorso/pagamento già verificata.</span>');
  }else lines.push('<span>Regime da verificare: nessun termine di riscossione viene applicato automaticamente.</span>');
  lines.push('<div class="result-divider"></div><strong>Prescrizione</strong>');const last=$("taxLastActDate")?.value;if(last){const years=$("taxJudgment")?.checked?10:5;lines.push(`<span>Ultimo atto interruttivo: ${fmtDate(last)}</span><strong>Termine teorico ${years} anni: ${fmtDate(addYearsIso(last,years))}</strong>`)}else lines.push('<span>Indicare l’ultimo atto interruttivo validamente notificato per ottenere il calcolo.</span>');
  lines.push('<div class="result-divider"></div><span>Supporto generale: verificare sempre disciplina speciale, regolamento del tributo, notificazioni, sospensioni, impugnazioni e atti interruttivi del caso concreto.</span>');$("taxResult").innerHTML=lines.join("");
}
function syncTaxFields(){const decl=$("taxViolation")?.value==="DECLARATION";$("taxDeclarationYearRow")?.classList.toggle("hidden",!decl);const act=$("taxActType")?.value;if(act==="EXECUTIVE"&&$("taxRegime"))$("taxRegime").value="EXECUTIVE";else if(["ORDINARY","TITLE"].includes(act)&&$("taxRegime"))$("taxRegime").value="PREVIOUS"}
function renderPlugins(){
  if(!snapshot)return;
  const plugins=snapshot.plugins||[];
  const status=$("pluginStatus"); if(status)status.innerHTML=plugins.map(pluginChip).join("")||'<span class="plugin-chip">Core Companion</span>';
  const availableKeys=new Set(plugins.map(p=>String(p.key||"")));
  const oldArchive=plugins.length===0;
  const toolPlugin={creset:"creset",terms:"legal_tools",codes:"local_norms",taxes:"legal_tools"};
  const coreTools=new Set(["split","checklist","documents","taxes"]);
  const buttons=[...document.querySelectorAll("[data-tool]")];
  buttons.forEach(b=>{const required=toolPlugin[b.dataset.tool];const enabled=coreTools.has(b.dataset.tool)||oldArchive||!required||availableKeys.has(required);b.classList.toggle("hidden",!enabled)});
  if(!buttons.some(b=>b.dataset.tool===activeTool&&!b.classList.contains("hidden"))){const first=buttons.find(b=>!b.classList.contains("hidden"));if(first)activeTool=first.dataset.tool}
  document.querySelectorAll(".plugin-tool").forEach(el=>el.classList.add("hidden"));
  const map={creset:"cresetTool",terms:"termsTool",taxes:"taxesTool",codes:"codesTool",split:"splitTool",documents:"documentsTool",checklist:"checklistTool"}; if(map[activeTool]&&$(map[activeTool]))$(map[activeTool]).classList.remove("hidden");
  buttons.forEach(b=>b.classList.toggle("active",b.dataset.tool===activeTool));
  const pending=pendingMobileActions.filter(a=>a.sync_status!=="IMPORTATA_DAL_GESTIONALE").length;
  [$("exportPluginActions"),$("exportMobileActions")].filter(Boolean).forEach(b=>{b.textContent=pending?`Esporta modifiche (${pending}) per il gestionale`:"Esporta modifiche per il gestionale"});
  renderHearingTool(); renderCresetTool(); renderLegalResults(); renderDocumentsTool(); fillTfcLawyerSelects(); updateSplitMode();
  if($("termStartDate")&&!$("termStartDate").value)$("termStartDate").value=plannerLocalToday();
  if($("taxYear")&&!$("taxYear").value)$("taxYear").value=String(new Date().getFullYear()-1);
  syncTaxFields();
}
async function exportMobileActions(){
  const actions=pendingMobileActions.filter(a=>a.sync_status!=="IMPORTATA_DAL_GESTIONALE");
  if(!actions.length){alert("Non ci sono modifiche da esportare.");return}
  // Il rientro Qt17 V18 beta8 accetta soltanto queste tipologie.
  // Le altre rimangono esportabili per conservazione, ma non devono risultare sincronizzate.
  const desktopSupported=new Set(["complete_task","reopen_task","task_status", "creset_mark_worked","creset_mark_constituted","creset_set_status", "hearing_note","hearing_outcome", "complete_checklist_item","reopen_checklist_item", "hearing_checklist_status"]);
  const unsupported=actions.filter(a=>!desktopSupported.has(a.action_type));
  if(unsupported.length){
    const types=[...new Set(unsupported.map(a=>a.action_type))].sort().join(", ");
    const warning=`ATTENZIONE: ${unsupported.length} operazioni non sono importabili dal gestionale V18 beta8.\n\nTipi: ${types}\n\nIl file cifrato le conserverà, ma il desktop NON le applicherà: andranno gestite separatamente. Vuoi comunque esportare tutte le modifiche?`;
    if(!confirm(warning))return;
  }
  const password=prompt("Password del file modifiche (almeno 8 caratteri)");
  if(!password||password.length<8){if(password)alert("La password deve avere almeno 8 caratteri.");return}
  const payload={formatVersion:3,companionVersion:COMPANION_BUILD,sourceArchiveId:snapshot?.archive_id||"",sourceGeneratedAt:snapshot?.generated_at||"",deviceId:deviceId(),createdAt:new Date().toISOString(),actions:actions.map(a=>({actionId:a.action_id,actionType:a.action_type,actionAt:a.action_at,deviceId:a.device_id,...a}))};
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

