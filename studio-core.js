/* Modello personale separato dal gestionale. Nessun invio di dati in rete. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.StudioCore=api;})(globalThis,function(){
'use strict';
const collections=['reminders','events','projects','notebooks','habits','goals'];
function blank(){return {schema:'COSTA_STUDIO',version:1,updatedAt:null,reminders:[],events:[],projects:[],notebooks:[],habits:[],goals:[],focus:{minutes:25,remaining:1500,state:'idle',deadline:null,notified:false},sessions:[]};}
const id=()=>crypto.randomUUID();
function date(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
const validId=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(x);
const validTitle=x=>typeof x==='string'&&!!x.trim()&&x.length<=500;
function clock(value){return value===''||typeof value==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(value);}
function validate(data){
 if(!data||data.schema!=='COSTA_STUDIO'||data.version!==1)throw Error('Backup Companion Studio non riconosciuto.');
 if(JSON.stringify(data).length>25000000)throw Error('Backup troppo grande (massimo 25 MB).');
 for(const col of collections){if(!Array.isArray(data[col])||data[col].length>10000)throw Error('Elenco non valido: '+col);const seen=new Set();for(const x of data[col]){if(!x||!validId(x.id)||seen.has(x.id)||!validTitle(x.title))throw Error('Voce non valida: '+col);seen.add(x.id);}}
 for(const r of data.reminders)if(!date(r.date)||typeof r.done!=='boolean')throw Error('Promemoria non valido.');
 for(const e of data.events)if(!date(e.date)||!clock(e.start)||!clock(e.end)||(e.end&&(!e.start||e.end<=e.start))||!['studio','personale','lavoro'].includes(e.category))throw Error('Impegno non valido.');
 for(const p of data.projects){if(!Array.isArray(p.tasks)||p.tasks.length>10000||!['aperto','in-corso','completato'].includes(p.status))throw Error('Progetto non valido.');for(const t of p.tasks)if(!validId(t.id)||!validTitle(t.title)||typeof t.done!=='boolean')throw Error('Attività del progetto non valida.');}
 for(const n of data.notebooks){if(!Array.isArray(n.pages)||n.pages.length>500)throw Error('Quaderno non valido.');for(const p of n.pages){if(!validId(p.id)||typeof p.title!=='string'||p.title.length>500||typeof p.text!=='string'||p.text.length>1000000||!Array.isArray(p.strokes)||p.strokes.length>10000)throw Error('Pagina non valida.');for(const s of p.strokes){if(!['#314d42','#9b6a77','#55758d'].includes(s.color)||![2,4,7].includes(s.width)||!Array.isArray(s.points)||s.points.length>10000||s.points.some(v=>!Array.isArray(v)||v.length!==2||v.some(c=>typeof c!=='number'||!Number.isFinite(c)||c<0||c>1)))throw Error('Tratto non valido.');}}}
 for(const h of data.habits)if(!Array.isArray(h.days)||h.days.some(d=>!date(d)))throw Error('Abitudine non valida.');
 for(const g of data.goals)if(!Array.isArray(g.steps)||g.steps.some(s=>!validId(s.id)||!validTitle(s.title)||typeof s.done!=='boolean'))throw Error('Obiettivo non valido.');
 if(!data.focus||![25,50].includes(data.focus.minutes)||!['idle','running','paused','finished'].includes(data.focus.state)||!Number.isFinite(data.focus.remaining)||data.focus.remaining<0||data.focus.remaining>data.focus.minutes*60||(data.focus.state==='running'&&!Number.isFinite(data.focus.deadline))||!Array.isArray(data.sessions))throw Error('Timer non valido.');
 for(const p of data.projects)if(p.due&&!date(p.due))throw Error('Data del progetto non valida.');
 for(const group of [...data.projects.map(p=>p.tasks),...data.goals.map(g=>g.steps),...data.notebooks.map(n=>n.pages)])if(new Set(group.map(x=>x.id)).size!==group.length)throw Error('Identificativi duplicati.');
 if(data.sessions.length>10000||data.sessions.some(s=>!s||!validId(s.id)||!date(s.date)||![25,50].includes(s.minutes)))throw Error('Sessioni non valide.');
 return data;
}
function newRecord(title,extra={}){const t=String(title||'').trim();if(!t||t.length>500)throw Error('Inserisci un titolo (massimo 500 caratteri).');return {id:id(),title:t,createdAt:new Date().toISOString(),...extra};}
function countdown(f,now=Date.now()){if(f.state==='running'){f.remaining=Math.max(0,Math.min(f.minutes*60,Math.ceil((f.deadline-now)/1000)));if(!f.remaining){f.state='finished';f.deadline=null;}}return Math.ceil(f.remaining);}
function start(f,now=Date.now()){countdown(f,now);if(f.state==='running')return;if(f.state==='finished'){f.remaining=f.minutes*60;f.notified=false;}f.deadline=now+f.remaining*1000;f.state='running';}
function pause(f,now=Date.now()){countdown(f,now);if(f.state==='running'){f.state='paused';f.deadline=null;}}
return {blank,id,date,clock,validate,newRecord,countdown,start,pause,collections};
});
