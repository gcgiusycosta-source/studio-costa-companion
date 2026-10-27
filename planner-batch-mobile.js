/* Studio Legale Costa Companion V20.2 — pianificazione offline da testo.
 * Non modifica termini processuali e non effettua richieste di rete.
 */
(function(root){
  'use strict';
  const weekdays={LUN:1,LUNEDI:1,MAR:2,MARTEDI:2,MER:3,MERCOLEDI:3,GIO:4,GIOVEDI:4,
    VEN:5,VENERDI:5,SAB:6,SABATO:6,DOM:0,DOMENICA:0};
  function pad(n){return String(n).padStart(2,'0')}
  function iso(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
  function plus(day,n){const d=new Date(day+'T12:00:00');d.setDate(d.getDate()+n);return iso(d)}
  function startDay(when,today){
    let raw=when.trim().toUpperCase().replaceAll('Ì','I');const hard=raw.startsWith('ENTRO ');
    if(hard)raw=raw.slice(6).trim();
    let day='';
    if(raw==='OGGI'||raw==='QUESTA SETTIMANA'||raw==='SETTIMANA')day=today;
    else if(raw==='DOMANI')day=plus(today,1);
    else if(Object.prototype.hasOwnProperty.call(weekdays,raw)){
      const delta=(weekdays[raw]-new Date(today+'T12:00:00').getDay()+7)%7;
      day=plus(today,delta);
    }else{
      const match=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if(match){const [,dd,mm,yy]=match;const candidate=`${yy}-${mm}-${dd}`;
        if(iso(new Date(Number(yy),Number(mm)-1,Number(dd)))===candidate)day=candidate;
      }
    }
    if(!day)throw Error('Data non valida: usa OGGI, DOMANI, giorno della settimana o GG/MM/AAAA.');
    if(day<today)throw Error('La data indicata è passata.');
    return {day,hard};
  }
  function duration(value){const v=value.trim().toLowerCase().replace(',','.').replace(/\s+/g,' ');
    if(/^\d+$/.test(v))return Number(v);
    let m=v.match(/^(\d+(?:\.\d+)?)\s*(?:h|ora|ore)$/);if(m)return Math.round(60*Number(m[1]));
    m=v.match(/^(\d+)\s*(?:min|minuti|minuto|m)$/);if(m)return Number(m[1]);
    m=v.match(/^(\d+)\s*(?:h|ora|ore)\s*(?:e\s*)?(\d+)\s*(?:min|minuti|minuto)$/);
    if(m)return 60*Number(m[1])+Number(m[2]);
    throw Error('Durata non riconosciuta: scrivi 20 min, 1 ora oppure 2 ore.');
  }
  function clock(text){const m=text.toLowerCase().trim().replace(/^ore /,'').replace('.',':').match(/^(\d{1,2}):(\d{2})$/);
    if(!m||Number(m[1])>23||Number(m[2])>59)throw Error('Orario non valido (es. 08:45).');
    return Number(m[1])*60+Number(m[2]);
  }
  function parse(text,today){const items=[],errors=[];
    text.split(/\r?\n/).forEach((raw,index)=>{
      const line=raw.trim().replace(/^[•\-]\s*/,'').trim();if(!line||line.startsWith('#'))return;
      const cols=line.split('|').map(x=>x.trim());
      if(cols.length<4||cols.length>6){errors.push(`Riga ${index+1}: usa GIORNO | ORA/LIBERO | DURATA | ATTIVITÀ.`);return;}
      try{
        const when=startDay(cols[0],today),mins=duration(cols[2]);
        if(!Number.isInteger(mins)||mins<5||mins>480||mins%5)throw Error('La durata deve essere tra 5 e 480 minuti, multipla di 5.');
        const fixed=['LIBERO','FLESSIBILE','AUTO','DA ORGANIZZARE','—','-'].includes(cols[1].toUpperCase())?null:clock(cols[1]);
        if(fixed!==null&&fixed+mins>1440)throw Error('L’impegno termina dopo mezzanotte.');
        if(when.hard&&fixed!==null)throw Error('ENTRO richiede orario LIBERO: per un appuntamento fisso usa la data senza ENTRO.');
        const title=cols[3];if(!title||title.length>200)throw Error('Descrizione obbligatoria (max 200 caratteri).');
        let priority='NORMALE',kind=fixed===null?'ATTIVITÀ':'APPUNTAMENTO';
        for(const x of cols.slice(4)){
          const v=x.toUpperCase();
          if(['NORMALE','ALTA','URGENTE'].includes(v))priority=v;
          else if(['PERSONALE','APPUNTAMENTO','ATTIVITÀ','ATTIVITA','TELEFONATA','PROMEMORIA'].includes(v))kind=v==='ATTIVITA'?'ATTIVITÀ':v;
          else throw Error('Tipo o priorità non riconosciuti.');
        }
        items.push({line:index+1,title,preferred_day:when.day,fixed_start:fixed,minutes:mins,
          hard_deadline:when.hard?when.day:null,priority,kind,
          weekend_explicit:new Date(when.day+'T12:00:00').getDay()%6===0});
      }catch(error){errors.push(`Riga ${index+1}: ${error.message}`);}
    });
    if(!items.length&&!errors.length)errors.push('Incolla almeno una attività.');
    return {items,errors};
  }
  function arrange(items,getBusy,getWindows,now=new Date()){
    const today=iso(now);const plans={},issues={},reserved={};
    const intersects=(day,a,b)=>[...getBusy(day),...(reserved[day]||[])].some(([x,y])=>a<y&&b>x);
    const take=(day,a,b)=>{(reserved[day]??=[]).push([a,b])};
    const sorted=[...items].sort((a,b)=>Number(a.fixed_start===null)-Number(b.fixed_start===null)||
      ({URGENTE:0,ALTA:1,NORMALE:2}[a.priority]-{URGENTE:0,ALTA:1,NORMALE:2}[b.priority])||
      a.preferred_day.localeCompare(b.preferred_day)||a.line-b.line);
    for(const item of sorted){
      const startday=item.preferred_day;let remain=item.minutes;const parts=[];
      if(item.fixed_start!==null){
        const a=item.fixed_start,b=a+remain;
        if(startday<today||(startday===today&&a<now.getHours()*60+now.getMinutes()))
          issues[item.line]='Orario fisso già trascorso.';
        else if(intersects(startday,a,b))issues[item.line]='Orario occupato. Verifica gli impegni familiari e modifica l’eccezione del giorno prima di confermare.';
        else{take(startday,a,b);parts.push([startday,a,b]);}
      }else{
        const until=item.hard_deadline||plus(startday,13);
        for(let day=startday;day<=until&&day<=plus(startday,13)&&remain>0;day=plus(day,1)){
          let windows=getWindows(day).slice();const isWeekend=[0,6].includes(new Date(day+'T12:00:00').getDay());
          if(!windows.length&&!isWeekend)windows=[[540,780,false],[900,1140,false]];
          else if(!windows.length&&isWeekend&&item.weekend_explicit&&day===startday)
            windows=[[540,780,false],[900,1140,false]];
          windows.sort((a,b)=>Number(!a[2])-Number(!b[2])||a[0]-b[0]);
          for(const [wa,wb] of windows){
            let a=wa;if(day===today)a=Math.max(a,Math.ceil((now.getHours()*60+now.getMinutes())/5)*5);
            while(a<wb&&remain>0){
              if(intersects(day,a,a+5)){a+=5;continue;}
              let b=a;
              while(b+5<=wb&&b-a<Math.min(120,remain)&&!intersects(day,b,b+5))b+=5;
              if(b-a>=Math.min(10,remain)){
                take(day,a,b);parts.push([day,a,b]);remain-=b-a;
              }
              a=Math.max(a+5,b);
            }
            if(!remain)break;
          }
        }
        if(remain){
          for(const [day,a,b] of parts){const ix=(reserved[day]||[]).findIndex(([x,y])=>x===a&&y===b);if(ix>=0)reserved[day].splice(ix,1);}
          parts.length=0;issues[item.line]=`Non entrano ${remain} minuti prima del termine o nelle prossime due settimane.`;
        }
      }
      if(parts.length)plans[item.line]=parts;
    }
    return {plans,issues};
  }
  root.PlannerBatchCosta={parse,arrange,iso,plus};
})(typeof window!=='undefined'?window:globalThis);
