/* Adapter unico per i dati sensibili: ogni lettura/scrittura passa dal Vault cifrato. */
(function(root){
  'use strict';
  const vault=root.CompanionVault;
  if(!vault)throw Error('CompanionVault non caricato.');
  root.CompanionStorage={
    dbGet:key=>vault.get('data',key),
    dbSet:(key,value)=>vault.put('data',key,value),
    storeAll:store=>vault.all(store),
    storePut:(store,value)=>{
      if(!['local_tasks','pending_mobile_actions'].includes(store))throw Error('Store non supportato.');
      const key=store==='local_tasks'?value.id:value.action_id;
      if(!key)throw Error('Identificativo mancante: non salvo un elemento privo di chiave.');
      return vault.put(store,key,value);
    },
    storeDelete:(store,key)=>vault.remove(store,key)
  };
})(globalThis);
