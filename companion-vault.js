/* Studio Costa Companion — Vault locale V1.
 * Cifra snapshot, attività e modifiche in attesa con AES-256-GCM.
 * NON modifica il formato dei pacchetti SCM1/SCMR1/SCL1.
 * Migrazione da V20.5 atomica: se fallisce, la transazione lascia gli store legacy intatti.
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
      return {initialized:!!meta,legacyCount:counts.reduce((a,b)=>a+b,0),legacyCounts:Object.fromEntries(PLAIN.map((s,i)=>[s,counts[i]]))};
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
  function requireUnlock(){if(!sessionKey)throw Error('Archivio bloccato: sbloccarlo prima di continuare.');return sessionKey;}
  async function setup(password){
    if(typeof password!=='string'||password.length<12)throw Error('La password locale deve contenere almeno 12 caratteri.');
    const state=await inspect();
    if(state.initialized)throw Error('Protezione locale già attivata.');
    const db=await openDB();
    try{
      // Tutte le letture prima dell'avvio della transazione di scrittura.
      const legacy={};
      for(const store of PLAIN){
        const tx=db.transaction(store,'readonly');
        const finish=done(tx);
        const values=req(tx.objectStore(store).getAll());
        const keys=store==='data'?req(tx.objectStore(store).getAllKeys()):null;
        legacy[store]=await values;
        if(keys){
          const sourceKeys=await keys;
          if(sourceKeys.some(k=>k!=='snapshot'))throw Error('Archivio precedente contiene chiavi non riconosciute: migrazione bloccata per evitare perdite di dati.');
        }
        await finish;
      }
      const salt=random(16), key=await derive(password,salt,ITERATIONS);
      const verifier=await seal(key,'verifier',{check:'STUDIO-COSTA-VAULT-READY',version:1});
      const encrypted=[];
      for(const store of PLAIN){
        for(const value of legacy[store]){
          const k=store==='data'?'snapshot':store==='local_tasks'?value.id:value.action_id;
          if(k===undefined||k===null||k==='')throw Error('Elemento legacy privo di identificativo: migrazione interrotta senza cancellazioni.');
          encrypted.push(await seal(key,recordId(store,k),value));
        }
      }
      // Verifica di un round-trip crittografico prima di cancellare gli originali.
      if(encrypted.length)await unseal(key,encrypted[0]);
      const tx=db.transaction([...PLAIN,META,RECORDS],'readwrite');
      const completion=done(tx);
      tx.objectStore(META).add({id:'vault',version:1,salt:b64(salt),iterations:ITERATIONS,verifier,createdAt:new Date().toISOString()});
      for(const record of encrypted)tx.objectStore(RECORDS).put(record);
      for(const store of PLAIN)tx.objectStore(store).clear();
      await completion;
      sessionKey=key;
      return {migrated:encrypted.length};
    }finally{db.close();}
  }
  async function unlock(password){
    sessionKey=null;
    const db=await openDB();
    let meta;
    try{
      const tx=db.transaction(META,'readonly');meta=await req(tx.objectStore(META).get('vault'));await done(tx);
    }finally{db.close();}
    if(!meta)throw Error('Protezione locale non ancora attivata.');
    if(meta.version!==1)throw Error('Versione archivio locale non supportata.');
    const key=await derive(password,from64(meta.salt),meta.iterations);
    try{
      const v=await unseal(key,meta.verifier);
      if(v.check!=='STUDIO-COSTA-VAULT-READY')throw Error('Verifica non riuscita');
    }catch(_){throw Error('Password locale errata o archivio danneggiato.');}
    sessionKey=key;
    return true;
  }
  // Rotazione password: nessun record viene rimosso prima che la nuova cifratura sia pronta.
  // La sostituzione di meta e record avviene in un'unica transazione IndexedDB.
  async function changePassword(oldPassword,newPassword){
    requireUnlock();
    if(typeof newPassword!=='string'||newPassword.length<12)throw Error('La nuova password deve contenere almeno 12 caratteri.');
    if(newPassword===oldPassword)throw Error('Scegli una password diversa da quella precedente.');
    const db=await openDB();
    try{
      const tx=db.transaction([META,RECORDS],'readonly');
      const complete=done(tx);
      const metaPromise=req(tx.objectStore(META).get('vault'));
      const recordsPromise=req(tx.objectStore(RECORDS).getAll());
      const [meta,records]=await Promise.all([metaPromise,recordsPromise]);
      await complete;
      if(!meta||meta.version!==1)throw Error('Formato Vault non supportato.');
      const oldKey=await derive(oldPassword,from64(meta.salt),meta.iterations);
      try{
        const v=await unseal(oldKey,meta.verifier);
        if(v.check!=='STUDIO-COSTA-VAULT-READY')throw Error('Controllo non valido');
      }catch(_){throw Error('Password locale attuale errata.');}
      // Decifratura totale: se un record e' corrotto, non modificare nulla.
      const plain=[];
      for(const record of records){
        if(!record?.id||typeof record.id!=='string')throw Error('Record del Vault non valido: rotazione annullata.');
        try{plain.push([record.id,await unseal(oldKey,record)]);}
        catch(_){throw Error("Un record del Vault non è leggibile: password invariata.");}
      }
      const salt=random(16),nextKey=await derive(newPassword,salt,ITERATIONS);
      const replacement=[];
      for(const [id,value] of plain)replacement.push(await seal(nextKey,id,value));
      const verifier=await seal(nextKey,'verifier',{check:'STUDIO-COSTA-VAULT-READY',version:1});
      // Il roundtrip crittografico avviene prima della scrittura.
      if(replacement.length)await unseal(nextKey,replacement[0]);
      await unseal(nextKey,verifier);
      const write=db.transaction([META,RECORDS],'readwrite');
      const written=done(write);
      write.objectStore(META).put({...meta,salt:b64(salt),iterations:ITERATIONS,verifier,rotatedAt:new Date().toISOString()});
      for(const row of replacement)write.objectStore(RECORDS).put(row);
      await written;
      sessionKey=nextKey;
      return {rotated:replacement.length};
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
  return {inspect,setup,unlock,changePassword,lock,isUnlocked,get,all,put,remove,clearEverything,openDB};
});
