/* Studio Costa Companion — Vault locale senza password V20.11.
 * Per un Vault V1 cifrato: non chiedere credenziali e non alterare i dati.
 * Aprire un archivio parallelo senza password, conservando l'originale integro.
 * Dati cifrati con AES-256-GCM e chiave di dispositivo non estraibile.
 * ATTENZIONE: il possesso del browser/profilo consente l'accesso.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CompanionVault=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DB_NAME='studio-costa-mobile', PASSWORDLESS_DB_NAME='studio-costa-mobile-no-password-v3', DB_VERSION=4;
  const PLAIN=['data','local_tasks','pending_mobile_actions'];
  const META='secure_meta', RECORDS='secure_records';
  const LABEL='STUDIO-COSTA-LOCAL-VAULT-V1';
  const encoder=new TextEncoder(), decoder=new TextDecoder();
  let sessionKey=null, selectedDatabase=null, choosingDatabase=null;
  const webcrypto=()=>globalThis.crypto;
  const random=n=>webcrypto().getRandomValues(new Uint8Array(n));
  function b64(buf){return BufferLikeToBase64(new Uint8Array(buf));}
  function BufferLikeToBase64(bytes){let s='';for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');}
  function from64(x){let s=String(x).replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return Uint8Array.from(atob(s),x=>x.charCodeAt(0));}
  function req(request){return new Promise((ok,no)=>{request.onsuccess=()=>ok(request.result);request.onerror=()=>no(request.error);});}
  function done(tx){return new Promise((ok,no)=>{tx.oncomplete=()=>ok();tx.onabort=()=>no(tx.error||Error('Transazione annullata'));tx.onerror=()=>no(tx.error||Error('Errore IndexedDB'));});}
  function rawOpenDB(name){return new Promise((resolve,reject)=>{
    const r=indexedDB.open(name,DB_VERSION);
    r.onupgradeneeded=()=>{
      const db=r.result;
      if(!db.objectStoreNames.contains('data'))db.createObjectStore('data');
      if(!db.objectStoreNames.contains('local_tasks'))db.createObjectStore('local_tasks',{keyPath:'id'});
      if(!db.objectStoreNames.contains('pending_mobile_actions'))db.createObjectStore('pending_mobile_actions',{keyPath:'action_id'});
      if(!db.objectStoreNames.contains(META))db.createObjectStore(META,{keyPath:'id'});
      if(!db.objectStoreNames.contains(RECORDS))db.createObjectStore(RECORDS,{keyPath:'id'});
    };
    r.onsuccess=()=>resolve(r.result);
    r.onerror=()=>reject(r.error);
    r.onblocked=()=>reject(Error('Chiudere le altre schede della Companion e riprovare.'));
  });}
  async function chooseDatabase(){
    if(selectedDatabase)return selectedDatabase;
    if(!choosingDatabase){
      choosingDatabase=(async()=>{
        const old=await rawOpenDB(DB_NAME);
        try{
          const tx=old.transaction(META,'readonly'),complete=done(tx);
          const meta=await req(tx.objectStore(META).get('vault'));
          await complete;
          // Un Vault V1 usa una password ignota: lasciarlo intatto nel DB originario.
          // La Companion usa un altro DB per poter funzionare senza password.
          selectedDatabase=meta?.version===1?PASSWORDLESS_DB_NAME:DB_NAME;
          return selectedDatabase;
        }finally{old.close();}
      })().catch(error=>{choosingDatabase=null;throw error;});
    }
    return choosingDatabase;
  }
  async function openDB(){return rawOpenDB(await chooseDatabase());}
  async function preservedLegacyVault(){return (await chooseDatabase())===PASSWORDLESS_DB_NAME;}
  async function inspect(){
    const db=await openDB();
    try{
      const tx=db.transaction([META,...PLAIN],'readonly');
      const requests=[req(tx.objectStore(META).get('vault')),...PLAIN.map(s=>req(tx.objectStore(s).count()))];
      const [meta,...counts]=await Promise.all(requests);
      await done(tx);
      if(meta&&counts.some(Boolean))throw Error('Dati legacy rilevati accanto al Vault: aggiornamento sospeso per sicurezza. Non cancellare nulla.');
      if(meta && ![1,2].includes(meta.version))throw Error('Versione del Vault non supportata: dati non modificati.');
      if(meta?.version===1)throw Error('Archivio parallelo non valido: i dati non sono stati modificati.');
      return {initialized:!!meta,mode:!meta?'new':'device',preservedLegacy:await preservedLegacyVault(),
        legacyCount:counts.reduce((a,b)=>a+b,0),legacyCounts:Object.fromEntries(PLAIN.map((s,i)=>[s,counts[i]]))};
    }finally{db.close();}
  }
  async function seal(key,id,value){
    const iv=random(12), aad=encoder.encode(`${LABEL}:${id}`);
    const cipher=await webcrypto().subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,encoder.encode(JSON.stringify(value)));
    return {id,nonce:b64(iv),ciphertext:b64(cipher)};
  }
  async function unseal(key,record){
    const bytes=await webcrypto().subtle.decrypt({name:'AES-GCM',iv:from64(record.nonce),additionalData:encoder.encode(`${LABEL}:${record.id}`)},key,from64(record.ciphertext));
    return JSON.parse(decoder.decode(bytes));
  }
  const recordId=(store,k)=>`${store}:${encodeURIComponent(String(k))}`;
  function requireUnlock(){if(!sessionKey)throw Error('Archivio non inizializzato: ricaricare la Companion.');return sessionKey;}
  async function deviceKey(){
    if(!webcrypto()?.subtle)throw Error('Web Crypto non disponibile: utilizzare HTTPS o localhost.');
    // Non salvare password automatiche nel codice, nei cookie o nel localStorage.
    return webcrypto().subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  }
  async function setupDevice(){
    const state=await inspect();
    if(state.initialized)throw Error('Archivio locale già inizializzato.');
    const db=await openDB();
    try{
      const legacy={};
      for(const store of PLAIN){
        const tx=db.transaction(store,'readonly'), completion=done(tx);
        const values=req(tx.objectStore(store).getAll());
        const keys=store==='data'?req(tx.objectStore(store).getAllKeys()):null;
        legacy[store]=await values;
        if(keys){
          const names=await keys;
          if(names.some(k=>k!=='snapshot'))throw Error('Archivio precedente contiene chiavi sconosciute: dati non modificati.');
        }
        await completion;
      }
      const key=await deviceKey();
      const verifier=await seal(key,'verifier',{check:'STUDIO-COSTA-VAULT-READY',version:2});
      const encrypted=[];
      for(const store of PLAIN){
        for(const value of legacy[store]){
          const k=store==='data'?'snapshot':store==='local_tasks'?value.id:value.action_id;
          if(k===undefined||k===null||k==='')throw Error('Elemento privo di identificativo: migrazione annullata.');
          encrypted.push(await seal(key,recordId(store,k),value));
        }
      }
      if(encrypted.length)await unseal(key,encrypted[0]);
      const tx=db.transaction([...PLAIN,META,RECORDS],'readwrite');
      const completion=done(tx);
      tx.objectStore(META).add({id:'vault',version:2,mode:'device',key,verifier,createdAt:new Date().toISOString()});
      for(const record of encrypted)tx.objectStore(RECORDS).put(record);
      for(const store of PLAIN)tx.objectStore(store).clear();
      await completion;
      sessionKey=key;
      return {migrated:encrypted.length};
    }finally{db.close();}
  }
  async function openAutomatically(){
    sessionKey=null;
    const db=await openDB();
    try{
      const tx=db.transaction(META,'readonly'),complete=done(tx);
      const meta=await req(tx.objectStore(META).get('vault'));
      await complete;
      if(!meta)throw Error('Archivio non inizializzato.');
      if(meta.version===1)throw Error('Archivio non compatibile: i dati esistenti non sono stati modificati.');
      if(meta.version!==2||!meta.key)throw Error('Chiave del dispositivo assente: archivio non modificato.');
      try{
        const value=await unseal(meta.key,meta.verifier);
        if(value.check!=='STUDIO-COSTA-VAULT-READY')throw Error('Verifica non riuscita.');
      }catch(_){throw Error('Chiave del dispositivo non valida: non cancellare i dati locali.');}
      sessionKey=meta.key;
      return true;
    }finally{db.close();}
  }
  // La migrazione silenziosa di dati cifrati con chiave ignota è impossibile.
  // Nessun dato V1 viene cancellato, migrato o sovrascritto senza consenso.
  function lock(){sessionKey=null;}
  function isUnlocked(){return !!sessionKey;}
  async function get(store,k){
    const key=requireUnlock(), id=recordId(store,k), db=await openDB();
    let entry;
    try{const tx=db.transaction(RECORDS,'readonly');entry=await req(tx.objectStore(RECORDS).get(id));await done(tx);}finally{db.close();}
    return entry?unseal(key,entry):undefined;
  }
  async function all(store){
    const key=requireUnlock(), prefix=`${store}:`,db=await openDB();let rows;
    try{const tx=db.transaction(RECORDS,'readonly');rows=await req(tx.objectStore(RECORDS).getAll());await done(tx);}finally{db.close();}
    return Promise.all(rows.filter(x=>x.id.startsWith(prefix)).map(row=>unseal(key,row)));
  }
  async function put(store,k,value){
    const key=requireUnlock(),row=await seal(key,recordId(store,k),value),db=await openDB();
    try{const tx=db.transaction(RECORDS,'readwrite');const completion=done(tx);tx.objectStore(RECORDS).put(row);await completion;}finally{db.close();}
  }
  async function remove(store,k){
    requireUnlock();const db=await openDB();
    try{const tx=db.transaction(RECORDS,'readwrite');const completion=done(tx);tx.objectStore(RECORDS).delete(recordId(store,k));await completion;}finally{db.close();}
  }
  async function clearEverything(){
    requireUnlock();const db=await openDB();
    try{
      const tx=db.transaction([...PLAIN,META,RECORDS],'readwrite');const completion=done(tx);
      for(const store of [...PLAIN,META,RECORDS])tx.objectStore(store).clear();
      await completion;sessionKey=null;
    }finally{db.close();}
  }
  return {inspect,setupDevice,openAutomatically,preservedLegacyVault,lock,isUnlocked,get,all,put,remove,clearEverything,openDB};
});
