/* Studio Costa Companion — Vault locale senza password V2.
 * I dati rimangono cifrati con AES-256-GCM tramite CryptoKey NON estraibile,
 * conservata nel database IndexedDB della medesima origine. Non esiste login.
 * La migrazione di un vecchio Vault V1 richiede una sola volta la vecchia password.
 * I dati precedenti rimangono integri se la conversione non termina.
 * ATTENZIONE: il possesso del dispositivo/profilo browser consente l'accesso.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.CompanionVault=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const DB_NAME='studio-costa-mobile', DB_VERSION=4;
  const PLAIN=['data','local_tasks','pending_mobile_actions'];
  const META='secure_meta', RECORDS='secure_records';
  const LABEL='STUDIO-COSTA-LOCAL-VAULT-V1';
  const ITERATIONS=350000;
  const encoder=new TextEncoder(), decoder=new TextDecoder();
  let sessionKey=null;
  const webcrypto=()=>globalThis.crypto;
  const random=n=>webcrypto().getRandomValues(new Uint8Array(n));
  function b64(buf){return BufferLikeToBase64(new Uint8Array(buf));}
  function BufferLikeToBase64(bytes){let s='';for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/g,'');}
  function from64(x){let s=String(x).replace(/-/g,'+').replace(/_/g,'/');while(s.length%4)s+='=';return Uint8Array.from(atob(s),x=>x.charCodeAt(0));}
  function req(request){return new Promise((ok,no)=>{request.onsuccess=()=>ok(request.result);request.onerror=()=>no(request.error);});}
  function done(tx){return new Promise((ok,no)=>{tx.oncomplete=()=>ok();tx.onabort=()=>no(tx.error||Error('Transazione annullata'));tx.onerror=()=>no(tx.error||Error('Errore IndexedDB'));});}
  function openDB(){return new Promise((resolve,reject)=>{
    const r=indexedDB.open(DB_NAME,DB_VERSION);
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
  async function inspect(){
    const db=await openDB();
    try{
      const tx=db.transaction([META,...PLAIN],'readonly');
      const requests=[req(tx.objectStore(META).get('vault')),...PLAIN.map(s=>req(tx.objectStore(s).count()))];
      const [meta,...counts]=await Promise.all(requests);
      await done(tx);
      if(meta&&counts.some(Boolean))throw Error('Dati legacy rilevati accanto al Vault: aggiornamento sospeso per sicurezza. Non cancellare nulla.');
      if(meta && ![1,2].includes(meta.version))throw Error('Versione del Vault non supportata: dati non modificati.');
      return {initialized:!!meta,mode:!meta?'new':meta.version===1?'password':'device',
        legacyCount:counts.reduce((a,b)=>a+b,0),legacyCounts:Object.fromEntries(PLAIN.map((s,i)=>[s,counts[i]]))};
    }finally{db.close();}
  }
  async function derive(password,salt,iterations){
    if(!webcrypto()?.subtle)throw Error('Web Crypto non disponibile: è necessario HTTPS o localhost.');
    const base=await webcrypto().subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveKey']);
    return webcrypto().subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
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
      if(meta.version===1)throw Error('Archivio precedente protetto da password: eseguire la conversione una sola volta.');
      if(meta.version!==2||!meta.key)throw Error('Chiave del dispositivo assente: archivio non modificato.');
      try{
        const value=await unseal(meta.key,meta.verifier);
        if(value.check!=='STUDIO-COSTA-VAULT-READY')throw Error('Verifica non riuscita.');
      }catch(_){throw Error('Chiave del dispositivo non valida: non cancellare i dati locali.');}
      sessionKey=meta.key;
      return true;
    }finally{db.close();}
  }
  // Il Vault protetto V1 non può essere aperto senza la password originale.
  // Conversione atomica: in caso di errore, rimangono intatti tutti i record V1.
  async function migratePasswordVault(oldPassword){
    if(typeof oldPassword!=='string'||!oldPassword)throw Error('Inserire una volta la password locale precedente.');
    const state=await inspect();
    if(state.mode!=='password')throw Error('Non è presente un archivio da convertire.');
    const db=await openDB();
    try{
      const read=db.transaction([META,RECORDS],'readonly');const readDone=done(read);
      const [meta,records]=await Promise.all([
        req(read.objectStore(META).get('vault')),
        req(read.objectStore(RECORDS).getAll())
      ]);
      await readDone;
      if(!meta||meta.version!==1)throw Error('Formato precedente non valido.');
      const oldKey=await derive(oldPassword,from64(meta.salt),meta.iterations);
      try{
        const result=await unseal(oldKey,meta.verifier);
        if(result.check!=='STUDIO-COSTA-VAULT-READY')throw Error('Verifica non riuscita.');
      }catch(_){throw Error('Password precedente errata: dati conservati, riprovare.');}
      const decrypted=[];
      for(const record of records){
        if(!record||typeof record.id!=='string')throw Error('Archivio incompleto: conversione annullata.');
        try{decrypted.push([record.id,await unseal(oldKey,record)]);}
        catch(_){throw Error('Record precedente non leggibile: conversione annullata senza cancellazioni.');}
      }
      const key=await deviceKey();
      const replacement=[];
      for(const [id,value] of decrypted)replacement.push(await seal(key,id,value));
      const verifier=await seal(key,'verifier',{check:'STUDIO-COSTA-VAULT-READY',version:2});
      await unseal(key,verifier);
      if(replacement.length)await unseal(key,replacement[0]);
      const write=db.transaction([META,RECORDS],'readwrite'), written=done(write);
      write.objectStore(META).put({id:'vault',version:2,mode:'device',key,verifier,createdAt:meta.createdAt||new Date().toISOString(),migratedAt:new Date().toISOString()});
      for(const record of replacement)write.objectStore(RECORDS).put(record);
      await written;
      sessionKey=key;
      return {migrated:replacement.length};
    }finally{db.close();}
  }
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
  return {inspect,setupDevice,openAutomatically,migratePasswordVault,lock,isUnlocked,get,all,put,remove,clearEverything,openDB};
});
