/* PIN locale della Companion. Nessun collegamento al server del PC. */
const CompanionAccess=(()=>{
  'use strict';
  const PIN_KEY='qt20-companion-pin-v1';
  const LOCK_KEY='qt20-companion-pin-lock-v1';
  const $id=id=>document.getElementById(id);
  const formatPin=value=>/^[0-9]{4}$/.test(String(value||''));
  const bytes64=bytes=>btoa(String.fromCharCode(...bytes));
  const from64=s=>Uint8Array.from(atob(s),x=>x.charCodeAt(0));
  async function derive(pin,salt){
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pin),'PBKDF2',false,['deriveBits']);
    return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},key,256));
  }
  async function setPin(){
    const current=localStorage.getItem(PIN_KEY);
    if(current){
      const old=prompt('Inserisci il PIN attuale per modificarlo:');
      if(!await verify(old)){alert('PIN attuale non valido.');return;}
    }
    const first=prompt('Scegli un PIN personale di esattamente 4 cifre:');
    if(!formatPin(first)){alert('Il PIN deve avere 4 cifre.');return;}
    const repeat=prompt('Ripeti il PIN di 4 cifre:');
    if(first!==repeat){alert('I PIN non coincidono.');return;}
    const salt=crypto.getRandomValues(new Uint8Array(16));
    const value=await derive(first,salt);
    localStorage.setItem(PIN_KEY,JSON.stringify({salt:bytes64(salt),hash:bytes64(value)}));
    localStorage.removeItem(LOCK_KEY);
    alert('PIN di accesso impostato. Sarà richiesto alla prossima apertura.');
  }
  async function verify(pin){
    if(!formatPin(pin))return false;
    const saved=JSON.parse(localStorage.getItem(PIN_KEY)||'null');
    if(!saved)return false;
    const actual=await derive(pin,from64(saved.salt));
    const expected=from64(saved.hash);
    if(actual.length!==expected.length)return false;
    let difference=0;
    for(let i=0;i<actual.length;i++)difference|=actual[i]^expected[i];
    return difference===0;
  }
  async function unlockAccess(){
    if(!localStorage.getItem(PIN_KEY)){
      // La prima configurazione rende il PIN obbligatorio per il nuovo dispositivo.
      while(!localStorage.getItem(PIN_KEY)){
        await setPin();
        if(!localStorage.getItem(PIN_KEY))throw Error('Configura un PIN di 4 cifre prima di utilizzare la Companion. Ricarica per riprovare.');
      }
      return;
    }
    const gate=$id('accessPinScreen');
    gate.classList.remove('hidden');
    const unlock=$id('accessPinUnlock'), input=$id('accessPinInput'),error=$id('accessPinError');
    return new Promise(resolve=>{
      async function attempt(){
        const lock=JSON.parse(localStorage.getItem(LOCK_KEY)||'{"count":0,"until":0}');
        if(Date.now()<lock.until){error.textContent='Accesso temporaneamente bloccato. Riprova più tardi.';return;}
        unlock.disabled=true;
        try{
          if(await verify(input.value)){
            localStorage.removeItem(LOCK_KEY);
            input.value='';gate.classList.add('hidden');resolve();return;
          }
          const count=(lock.count||0)+1;
          localStorage.setItem(LOCK_KEY,JSON.stringify({count,until:count>=5?Date.now()+300000:0}));
          error.textContent=count>=5?'Troppi tentativi: riprova tra 5 minuti.':'PIN errato.';
          input.value='';
        }finally{unlock.disabled=false;}
      }
      unlock.onclick=attempt;
      input.onkeydown=e=>{if(e.key==='Enter')attempt();};
      input.focus();
    });
  }
  function initialize(){
    $id('changeAccessPin')?.addEventListener('click',()=>setPin().catch(e=>alert(e.message)));
    $id('importBackButton')?.addEventListener('click',()=>{
      $id('pairScreen')?.classList.add('hidden');
      if(typeof snapshot!=='undefined'&&snapshot)showApp();
      else $id('emptyScreen')?.classList.remove('hidden');
    });
  }
  return {initialize,unlockAccess};
})();
