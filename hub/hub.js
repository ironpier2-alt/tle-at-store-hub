/* TLE At-Store Hub engine: one look for every client.
   A client page loads its rule pack (window.HUB_PACK, from packs/*.js) and then this file.
   The pack says which steps exist, in what order, and what each step holds (its "parts").
   Part types this engine knows: checkin, photos, choice, ticks, counts, perProduct, buy, note, goal,
   details, tally, comments, total, signature, alert, blockLink, unblockLink, lines.
   "lines" (2026-11-21) shows a step's lines exactly as the confirmation email prints them ("* " bullets,
   "  * " sub-bullets, **bold**, [words](link)); the machine builds packs with it (TLE Machine, AtStoreHub.gs).
   Any part can have when:{k,is} so it only shows (and only counts) after that answer is picked.
   Sending (2026-11-21): a talent's own link (P.shiftKey, from job/?s=...) sends to the TLE Machine (window.HUB_API): the check-in on
   every job; on jobs where talent report in the hub (mode 'collect') each photo when it is kept, and the report when they press
   Send. Everything waits on the phone (IndexedDB) until it is sent, so no signal in the store loses nothing. P.preview: saves nothing. */
(function(){
const P=window.HUB_PACK;
const BASE=new URL('.',document.currentScript.src).href;
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const KEY='tleHub:'+P.key;
let S={}; try{S=JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}};
const has=k=>S[k]!==undefined&&S[k]!==null&&S[k]!==false&&String(S[k]).trim()!=='';
const val=k=>has(k)?esc(S[k]):'';
const clock=d=>d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'});
const SLOTS=P.photos||{};
const photos={};Object.keys(SLOTS).forEach(k=>photos[k]=[]);
const pending={},viewing={};
let signed=!!S.sig,sigData=S.sig||null;
const API=window.HUB_API||'';
const LIVE=!!(P.shiftKey&&API&&!P.preview);
const COLLECT=P.mode==='collect';
const stamp=d=>d.toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

/* ---------- the phone's outbox: photos and messages wait here until TLE has them ---------- */
const DB=(()=>{let op=null;const mem={photos:new Map(),out:new Map()};let seq=1;
  const open=()=>op||(op=new Promise((res,rej)=>{try{const r=indexedDB.open('tleHub',1);r.onupgradeneeded=()=>{const d=r.result;d.createObjectStore('photos',{keyPath:'id'});d.createObjectStore('out',{keyPath:'n',autoIncrement:true})};r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)}catch(e){rej(e)}}));
  const tx=(st,mode,fn)=>open().then(d=>new Promise((res,rej)=>{const t=d.transaction(st,mode),r=fn(t.objectStore(st));t.oncomplete=()=>res(r&&r.result);t.onerror=()=>rej(t.error)}));
  return{put:(st,v)=>tx(st,'readwrite',o=>o.put(v)).catch(()=>{if(st==='out'&&v.n==null)v.n=seq++;mem[st].set(st==='out'?v.n:v.id,v)}),
    del:(st,k)=>tx(st,'readwrite',o=>o.delete(k)).catch(()=>{mem[st].delete(k)}),
    all:st=>tx(st,'readonly',o=>o.getAll()).catch(()=>[...mem[st].values()])};})();
const uid=()=>{const a=new Uint8Array(8);(window.crypto||{getRandomValues:x=>x.map(()=>Math.random()*256|0)}).getRandomValues(a);return[...a].map(b=>b.toString(16).padStart(2,'0')).join('')};
const dataUrl=b=>new Promise(res=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>res('');r.readAsDataURL(b)});
/* phone photos are big: 1600 px on the long side is plenty for a report and sends fast on a weak signal */
const shrink=f=>new Promise(res=>{const u=URL.createObjectURL(f),im=new Image();im.onload=()=>{const r=Math.min(1,1600/Math.max(im.naturalWidth,im.naturalHeight));const c=document.createElement('canvas');c.width=Math.round(im.naturalWidth*r);c.height=Math.round(im.naturalHeight*r);c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(u);c.toBlob(b=>res(b||f),'image/jpeg',.82)};im.onerror=()=>{URL.revokeObjectURL(u);res(f)};im.src=u});
let queued=0,busy=false,timer=null,wait=0,problem='',locating=0;
function enqueue(body){if(!LIVE)return Promise.resolve();return DB.put('out',{k:P.key,body}).then(()=>{wait=0;pump()})}
async function pump(){
  if(busy||!LIVE)return;busy=true;clearTimeout(timer);
  try{for(;;){
    const items=(await DB.all('out')).filter(x=>x.k===P.key).sort((a,b)=>a.n-b.n);
    queued=items.length;showSync();if(!items.length)break;
    const it=items[0];let body=it.body,ph=null;
    if(body.kind==='photo'){ph=(await DB.all('photos')).find(x=>x.id===body.id);if(!ph){await DB.del('out',it.n);continue}
      body=Object.assign({},body,{loc:ph.loc||null,data:await dataUrl(ph.blob)})}
    let r=null;
    try{const res=await fetch(API,{method:'POST',body:'HUB\n'+JSON.stringify(Object.assign({s:P.shiftKey},body))});r=await res.json()}catch(e){r=null}
    if(r&&(r.ok||r.stop)){
      await DB.del('out',it.n);wait=0;
      if(!r.ok)problem=r.message||'Something could not be sent. Text your TLE coordinator.';
      if(r.ok&&ph){ph.sent=true;await DB.put('photos',ph)}
      if(r.ok&&body.kind==='report'){S.reportOk=new Date().toISOString();save();const c=cur();if(c&&c.id==='send')render()}
      continue}
    wait=Math.min(wait?wait*2:5000,60000);break;
  }}finally{busy=false;showSync();if(queued)timer=setTimeout(pump,wait||5000)}
}
function showSync(){
  const el=$('sync');if(!el)return;
  if(!LIVE){el.hidden=true;return}
  const off=navigator.onLine===false;
  el.hidden=false;
  el.className='sync'+(queued?(off?' off':' busy'):' ok');
  el.textContent=queued?(off?`No signal. ${queued} waiting on this phone; they send by themselves when you are back online.`:`Sending to TLE… ${queued} left. Keep this page open.`)
    :S.reportOk?`Sent ✓ TLE has your report (${clock(new Date(S.reportOk))}).`:COLLECT?'Everything so far is with TLE ✓':(has('checkin')?'Your check-in is with TLE ✓':'');
  if(problem)el.textContent+=' '+problem;
  if(!el.textContent)el.hidden=true;
}
window.addEventListener('online',()=>{wait=0;pump()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){wait=0;pump()}});
const want=id=>S.blocked&&P.blockedPhotoCount&&P.blockedPhotoCount[id]?P.blockedPhotoCount[id]:SLOTS[id].n;
const noun=id=>SLOTS[id].noun||SLOTS[id].title.toLowerCase();

const GUIDE_TOP=P.mode==='guide';
/* ---------- shell ---------- */
document.body.innerHTML=`<div class="wrap">
  <div class="logo"><img src="${BASE}logo.png" alt="the Lynne experience"></div>
  <button class="tk" id="tkBtn" type="button" aria-expanded="false" aria-controls="tkMore">
    <span class="main"><b>${esc(P.title)}</b><small>${esc(P.store)} · shift details <span class="car">▾</span></small></span>
    <span class="pct" id="pct">0%</span>
  </button>
  <div class="more" id="tkMore" hidden>
    <dl>${(P.details||[]).map(([t,d])=>`<div><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join('')}</dl>
    ${(P.lists||[]).map(([h,items])=>`<div><h3>${esc(h)}</h3><ul>${items.map(i=>`<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}
  </div>
  <p class="proto">${P.preview?'Preview of this job\'s hub. Nothing you do here is saved or sent. Each talent opens their own link from their confirmation email.'
    :P.test?'TEST link: what you send is filed as a test.'
    :GUIDE_TOP?esc(P.guideNote||'Your guide for the day. Report everything in the ISDemos app.'):LIVE?'Your photos and report go to TLE from this page.':'Prototype. Nothing is sent anywhere yet.'}</p>
  <p class="sync" id="sync" role="status" aria-live="polite" hidden></p>
  <main id="view"></main>
</div>`;

/* ---------- small builders ---------- */
const row=(k,label)=>`<label class="row"><span>${esc(label)}</span><input type="text" inputmode="decimal" id="f-${k}" data-k="${k}" value="${val(k)}"></label>`;
const tick=(k,label)=>`<label class="tick"><input type="checkbox" id="f-${k}" data-k="${k}" ${S[k]?'checked':''}><span>${esc(label)}</span></label>`;
const seg=(k,opts)=>`<fieldset class="seg" id="g-${k}"><div class="opts">${opts.map((o,i)=>`<label><input type="radio" name="${k}" id="f-${k}-${i}" value="${esc(o)}" ${S[k]===o?'checked':''}><span>${esc(o)}</span></label>`).join('')}</div></fieldset>`;
const rules=id=>`<ul class="rules">${(SLOTS[id].yes||[]).map(r=>`<li class="yes">${esc(r)}</li>`).join('')}${(SLOTS[id].no||[]).map(r=>`<li class="no">${esc(r)}</li>`).join('')}</ul>`;
const qbtn=(key,label,sm)=>`<button type="button" class="q${sm?' sm':''}" data-q="${key}" aria-expanded="false" aria-controls="qa-${key}" aria-label="${esc(label)}">?</button>`;
const slot=id=>`<div class="box" id="slot-${id}"><div class="bh"><h3>${esc(SLOTS[id].title)}</h3><span class="count" id="cnt-${id}"></span>${qbtn('s-'+id,'What each '+SLOTS[id].title+' photo needs',1)}</div>
  <div class="qa" id="qa-s-${id}" hidden>${rules(id)}${SLOTS[id].tip?`<p>${esc(SLOTS[id].tip)}</p>`:''}</div>
  <div class="tiles" id="th-${id}"></div><p class="tap" id="tap-${id}">Tap the pink box to take the next photo.</p><p class="msg" id="msg-${id}" aria-live="polite"></p><div id="pend-${id}"></div>
  <input hidden type="file" accept="image/*" capture="environment" id="file-${id}" data-slot="${id}"></div>`;
const ph=id=>{const n=photos[id].length,w=want(id),nn=noun(id),sl=SLOTS[id];
  return{t:sl.plain?(w>1?`Photo ${Math.min(n+1,w)} of ${w}: ${sl.title}`:`Photo: ${sl.title}`):w>1?`Take ${nn} photo ${Math.min(n+1,w)} of ${w}`:`Take the ${nn} photo`,ok:n>=w,el:'slot-'+id,photo:id}};
const fld=(k,t)=>({t,ok:has(k),el:'f-'+k});
const money=v=>'$'+(+v).toFixed(2).replace(/\.00$/,'');
/* the email's wording → HTML (same rules as the machine's confirmMdToHtml_) */
const inl=s=>esc(s).replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>').replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>');
const md=t=>{const out=[];let list=null;
  String(t||'').split('\n').forEach(raw=>{const m=raw.match(/^(\s*)[*\-•]\s+(.*)$/);
    if(m){if(!list){list=[];out.push(list)}if(m[1].length>=2&&list.length)list[list.length-1].sub.push(m[2]);else list.push({t:m[2],sub:[]});return}
    list=null;if(raw.trim())out.push(raw.trim())});
  return out.map(b=>typeof b==='string'?`<p>${inl(b)}</p>`:`<ul>${b.map(i=>`<li>${inl(i.t)}${i.sub.length?`<ul>${i.sub.map(x=>`<li>${inl(x)}</li>`).join('')}</ul>`:''}</li>`).join('')}</ul>`).join('')};

/* ---------- parts: what each kind of tool looks like, and what it needs before the step is done ---------- */
const PARTS={
  checkin:{html:()=>`<div id="checkin"></div>`,need:()=>[{t:'Check me in',ok:has('checkin'),el:'checkin',act:'checkin'}]},
  photos:{html:p=>slot(p.id),need:p=>[ph(p.id)]},
  choice:{html:p=>`<div class="box" id="b-${p.k}"><div class="bh"><h3>${esc(p.title)}</h3></div>
      ${p.script?`<details class="mini"><summary>${esc(p.script.summary)}</summary><p>${esc(p.script.text)}</p></details>`:''}
      ${seg(p.k,p.options)}${p.warn?`<p class="alert" id="warn-${p.k}"></p>`:''}
      ${p.note?`<textarea id="f-${p.note.k}" data-k="${p.note.k}" placeholder="${esc(p.note.placeholder)}" aria-label="${esc(p.note.placeholder)}">${val(p.note.k)}</textarea>`:''}</div>`,
    need:p=>[{t:p.todo||'Answer: '+p.title.toLowerCase(),ok:has(p.k),el:'b-'+p.k},...(p.note&&!p.note.optional?[fld(p.note.k,p.note.todo||'Write what happened')]:[])]},
  ticks:{html:p=>`<div class="box" id="b-${p.id}"><div class="bh"><h3>${esc(p.title)}</h3></div>
      ${p.script?`<details class="mini"><summary>${esc(p.script.summary)}</summary><p>${esc(p.script.text)}</p></details>`:''}
      ${p.items.map(([k,l])=>tick(k,l)).join('')}</div>`,
    need:p=>p.items.map(([k,l])=>({t:`${p.title}: ${/^I\b/.test(l)?l:l.charAt(0).toLowerCase()+l.slice(1)}`,ok:has(k),el:'b-'+p.id}))},
  counts:{html:p=>`<div class="box" id="b-count-${p.field}"><div class="bh"><h3>${esc(p.title)}</h3></div>${P.products.map(x=>row(x.id+'_'+p.field,x.name)).join('')}</div>`,
    need:p=>P.products.map(x=>fld(x.id+'_'+p.field,`${p.todo||'Enter shelf count'}: ${x.name}`))},
  perProduct:{html:p=>P.products.map(x=>`<div class="box"><div class="bh"><h3>${esc(x.name)}</h3></div>${p.fields.map(([f,label])=>row(x.id+'_'+f,label)).join('')}</div>`).join(''),
    need:p=>P.products.flatMap(x=>p.fields.map(([f,,todo])=>fld(x.id+'_'+f,`${todo}: ${x.name}`)))},
  buy:{html:p=>`<div class="box"><div class="bh"><h3>${esc(p.title)}</h3>${P.cap?`<span class="count">Limit ${money(P.cap)}</span>`:''}</div><ul class="buy">
      ${p.items.map(([q,name,price])=>`<li><b>${esc(q)}</b><span>${esc(name)}</span>${price?`<em>${esc(price)}</em>`:''}</li>`).join('')}</ul>${p.note?`<p class="note">${esc(p.note)}</p>`:''}</div>`,need:()=>[]},
  note:{html:p=>`<p class="note">${esc(p.text)}</p>`,need:()=>[]},
  goal:{html:p=>`<p class="goal">${esc(p.text)}</p>`,need:()=>[]},
  alert:{html:p=>`<p class="alert soft">${esc(p.text)}</p>`,need:()=>[]},
  details:{html:p=>{const tag=p.ordered?'ol':'ul';return`<div class="box"><details class="mini"><summary>${esc(p.summary)}</summary><${tag}>${p.items.map(i=>`<li>${esc(i)}</li>`).join('')}</${tag}></details></div>`},need:()=>[]},
  tally:{html:p=>`<div class="box tally" id="tally"><h3>${esc(p.title||'Samples poured')}</h3><button type="button" class="minus" id="tMinus" aria-label="Take one off">−</button><output id="tOut">0</output><button type="button" id="tPlus" aria-label="Add one sample">+</button></div>`,
    need:()=>[{t:'Count your first sample',ok:(S.poured||0)>0,el:'tally'}]},
  comments:{html:p=>`<div class="box" id="b-comments"><div class="bh"><h3>${esc(p.title)}</h3></div>${Array.from({length:p.n},(_,j)=>j+1).map(i=>`<input type="text" id="f-c${i}" data-k="c${i}" value="${val('c'+i)}" placeholder="Comment ${i}" aria-label="Shopper comment ${i}">`).join('')}</div>`,
    need:p=>Array.from({length:p.n},(_,j)=>fld('c'+(j+1),`Write shopper comment ${j+1}`))},
  total:{html:p=>`<div class="box">${row(p.k,p.label)}<p class="alert" id="capMsg"></p></div>`,need:p=>[fld(p.k,p.todo||'Enter the receipt total')]},
  signature:{html:()=>`<div class="box"><div class="bh"><h3>Store manager</h3><button type="button" class="link" id="sigClear" style="padding:0">Clear signature</button></div>
      <input type="text" id="f-mgrName" data-k="mgrName" value="${val('mgrName')}" placeholder="Manager's full name" aria-label="Store manager full name">
      <canvas class="sig" id="sig" aria-label="Signature box. Hand the phone to the manager to sign."></canvas></div>`,
    need:()=>[fld('mgrName','Enter the manager\'s name'),{t:'Get the manager to sign',ok:signed,el:'sig'}]},
  blockLink:{html:p=>`<button class="link" type="button" id="blockBtn">${esc(p.label)}</button>`,need:()=>[]},
  unblockLink:{html:()=>`<button class="link" type="button" id="unblockBtn">Go back. I can run the demo after all</button>`,need:()=>[]},
  lines:{html:p=>`<div class="box lines">${p.title?`<div class="bh"><h3>${esc(p.title)}</h3></div>`:''}${md(p.md)}</div>`,need:()=>[]}
};
const on=p=>!p.when||(p.when.is!==undefined?S[p.when.k]===p.when.is:has(p.when.k));
const parts=s=>(s.parts||[]).filter(on);

/* ---------- guide-only mode (owner, 2026-11-21) ----------
   Talent report in ISDemos, so the hub collects nothing ISDemos collects: each such tool becomes one check-off,
   with the same rules shown. There is no "Send to TLE" step; the pack's last step is the ISDemos submit check. */
const GUIDE=P.mode==='guide';
const gtick=(k,label,body,id)=>`<div class="box" id="${id}">${body}${tick(k,label)}</div>`;
const gneed=(k,t,id)=>[{t,ok:has(k),el:id}];
const ptitle=id=>{const n=want(id),t=S.blocked?String(n):(SLOTS[id].countText||String(n));return`${SLOTS[id].title} · ${t} photo${t==='1'?'':'s'}`};
if(GUIDE)Object.assign(PARTS,{
  photos:{html:p=>{const sl=SLOTS[p.id],n=want(p.id),shots=(sl.shots||[]).slice(0,n);
      return gtick('g_ph_'+p.id,sl.guideTick||`Took ${n>1?'them':'it'} in ISDemos`,`<div class="bh"><h3>${esc(ptitle(p.id))}</h3></div>${shots.length&&!S.blocked?`<ol class="rules" style="padding-left:18px;list-style:decimal">${shots.map(s=>`<li style="display:list-item">${esc(s)}</li>`).join('')}</ol>`:''}${rules(p.id)}${sl.tip?`<p class="note">${esc(sl.tip)}</p>`:''}`,'b-g-ph-'+p.id)},
    need:p=>gneed('g_ph_'+p.id,`Take the ${noun(p.id)} photo${want(p.id)>1?'s':''} in ISDemos`,'b-g-ph-'+p.id)},
  counts:{html:p=>gtick('g_'+p.field,'Counted, and entered in ISDemos',`<div class="bh"><h3>${esc(p.title)}</h3></div><ul class="buy">${P.products.map(x=>`<li><span>${esc(x.name)}</span></li>`).join('')}</ul>`,'b-g-'+p.field),
    need:p=>gneed('g_'+p.field,p.guideTodo||'Count the shelf and enter it in ISDemos','b-g-'+p.field)},
  perProduct:{html:p=>gtick('g_end','Entered in ISDemos',`<div class="bh"><h3>For each product</h3></div><ul class="buy">${p.fields.map(([,label])=>`<li><span>${esc(label)}</span></li>`).join('')}</ul><p class="note">${P.products.map(x=>esc(x.name)).join(' · ')}</p>`,'b-g-end'),
    need:()=>gneed('g_end','Enter the final counts in ISDemos','b-g-end')},
  comments:{html:p=>gtick('g_comments',`Wrote ${p.n} comments in ISDemos`,`<div class="bh"><h3>${esc(p.title)}</h3></div><p class="note">Write down what shoppers say about the product, in their words.</p>`,'b-g-comments'),
    need:p=>gneed('g_comments',`Write ${p.n} shopper comments in ISDemos`,'b-g-comments')},
  total:{html:()=>gtick('g_total','Receipt photo and total are in ISDemos',`<div class="bh"><h3>Receipt</h3></div><p class="note">Lay it flat. Store name, date, every item and the total must show.</p>`,'b-g-total'),
    need:()=>gneed('g_total','Put the receipt photo and total in ISDemos','b-g-total')},
  signature:{html:()=>gtick('g_sig','The manager signed my ISDemos report',`<div class="bh"><h3>Store manager</h3></div><p class="note">Hand the manager your phone with the ISDemos report open, and ask them to sign.</p>`,'b-g-sig'),
    need:()=>gneed('g_sig','Get the manager to sign in ISDemos','b-g-sig')},
  tally:{html:PARTS.tally.html,need:()=>[]}
});

/* ---------- steps ---------- */
const SEND={id:'send',when:(P.send&&P.send.when)||'Last thing',title:(P.send&&P.send.title)||'Submit to TLE',info:(P.send&&P.send.info)||'Submit before you leave the store.',help:(P.send&&P.send.help)||[],need:()=>[]};
const step=id=>{const d=P.steps[id];return{id,...d,need:()=>parts(d).flatMap(p=>PARTS[p.type].need(p))}};
const work=()=>(S.blocked?P.blockedFlow:P.flow).map(step);
const all=()=>GUIDE?work():[...work(),SEND];
const T=s=>S.blocked&&s.titleBlocked?s.titleBlocked:s.title;
const I=s=>S.blocked&&s.infoBlocked?s.infoBlocked:s.info;
const stepDone=s=>s.id==='send'?!!S.sent:s.need().every(n=>n.ok);
const cur=()=>S.cur?all().find(s=>s.id===S.cur)||null:null;
const blockHome=()=>P.flow.find(id=>(P.steps[id].parts||[]).some(p=>p.type==='blockLink'))||P.flow[0];

function locate(done){
  try{if(!navigator.geolocation){done(null);return}
    navigator.geolocation.getCurrentPosition(p=>done([p.coords.latitude,p.coords.longitude]),()=>done(null),{enableHighAccuracy:true,timeout:10000,maximumAge:30000});
  }catch(e){done(null)}
}
function checkIn(){const d=new Date();S.checkin=clock(d);save();drawCheckin();refresh();
  locate(l=>{S.ciLoc=l?'on':'off';save();drawCheckin();enqueue({kind:'checkin',clock:S.checkin,at:stamp(d),t:d.toISOString(),loc:l})})}
function drawCheckin(){
  const el=$('checkin');if(!el)return;
  if(!has('checkin')){el.innerHTML=`<button class="btn" type="button" id="ciBtn">I'm here. Check me in</button>`;return}
  el.innerHTML=`<p class="stamp">Checked in at ${esc(S.checkin)}${S.ciLoc==='on'?' · location recorded':''}</p>${S.ciLoc==='off'?'<p class="alert soft" style="margin-top:8px">Your location did not come through. Turn on location for this page.</p>':''}`;
}
function drawSlot(id){
  const box=$('slot-'+id);if(!box)return;
  const list=photos[id],n=list.length,need=want(id),sl=SLOTS[id],cells=Math.max(need,n)+(sl.more&&n>=need?1:0);
  $('cnt-'+id).textContent=`${n} of ${need}`;
  box.classList.toggle('ok',n>=need);
  const loc=!!P.photoLocation;
  let h='';
  for(let i=0;i<cells;i++){
    const p=list[i];
    if(p)h+=`<button type="button" class="tile has" data-view="${id}:${i}" aria-label="Photo ${i+1}. Tap to review."><img src="${p.u}" alt=""><span class="nm">${i+1}</span>${loc?`<span class="st ${p.loc===undefined?'':p.loc?'on':'off'}"></span>`:''}</button>`;
    else h+=`<label class="tile${i===n?' next':''}" for="file-${id}" aria-label="Take photo ${i+1}">${i>=need?'+':i+1}${sl.min&&i===sl.min-1&&!S.blocked?'<span class="min">min</span>':''}</label>`;
  }
  $('th-'+id).innerHTML=h;
  const pd=pending[id],v=viewing[id],vp=v!==undefined?list[v]:null;
  $('tap-'+id).hidden=!!(pd||vp)||n>=cells;
  $('pend-'+id).innerHTML=pd?`<div class="pend"><img src="${pd.u}" alt="The photo you just took"><h4>Check it before it counts</h4>${rules(id)}<div class="two"><button type="button" class="btn" data-keep="${id}">It counts</button><button type="button" class="btn ghost" data-retake="${id}">Retake</button></div></div>`
    :vp?`<div class="pend"><img src="${vp.u}" alt="Photo ${v+1}"><p class="note">Photo ${v+1} · ${clock(vp.t)}${loc?` · ${vp.loc===undefined?'locating…':vp.loc?'located':'no location'}`:''}</p><div class="two"><button type="button" class="btn ghost" data-close="${id}">Keep</button><button type="button" class="btn ghost" data-rm="${id}:${v}" style="color:var(--bad)">Remove</button></div></div>`:'';
  const m=$('msg-'+id);let t='',c='msg';
  if(sl.min&&!S.blocked){
    if(n<sl.min){t=`${sl.min-n} more to reach the minimum of ${sl.min}.`}
    else if(n<need){t=`Minimum met. Keep going to ${need}.`;c='msg good'}
    else{t=`All ${need} in.${sl.more?' More new faces only help.':''}`;c='msg good'}
  }else if(n<need&&sl.shots&&!S.blocked){t=`Next: ${sl.shots[n]}`}
  const off=list.filter(p=>p.loc===null).length;
  if(loc&&off){t=`${off} photo${off>1?'s have':' has'} no location (red dot). Turn location on and retake.`;c='msg bad'}
  m.textContent=t;m.className=c;
}

let sig=null,ctx=null,drawing=false;
function sizeSig(){const r=sig.getBoundingClientRect(),d=window.devicePixelRatio||1;if(!r.width)return;sig.width=r.width*d;sig.height=r.height*d;ctx.setTransform(d,0,0,d,0,0);ctx.lineWidth=2.2;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=getComputedStyle(document.body).color}
const pt=e=>{const r=sig.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top]};

function render(){
  const s=cur();
  if(!s){$('view').innerHTML=`<div class="list" id="list"></div><p class="home-note" id="homeNote"></p>`;refresh();return}
  const list=all(),idx=list.findIndex(x=>x.id===s.id);
  let body;
  if(s.id==='send'){
    const was=!LIVE&&S.sent?(P.preview?`<p class="stamp">Preview: nothing was sent.</p><p class="note">From a talent's own link, the photos, counts, comments and signature now go to TLE, filed to their shift.</p>`
      :`<p class="stamp">Prototype: nothing was sent.</p><p class="note">In the live hub your photos, receipt and report would now be with TLE, filed to this shift.</p>`)
      :LIVE&&S.sent?`<p class="stamp" id="sentNote">${S.reportOk?'Sent ✓ TLE has your photos and report.':'Sending… keep this page open until it says Sent.'}</p>`:'';
    body=`${P.send&&P.send.md?`<div class="box lines">${md(P.send.md)}</div>`:''}${was}${P.send&&P.send.note?`<p class="goal">${esc(P.send.note)}</p>`:''}<div class="box"><ul class="sum" id="sum"></ul></div><button class="btn" type="button" id="sendBtn"></button>`;
  }else body=parts(s).map(p=>PARTS[p.type].html(p)).join('');
  $('view').innerHTML=`<button type="button" class="back" data-home="1">‹ All steps</button>
    <div class="shead"><div><div class="when">Step ${idx+1} of ${list.length} · ${esc(s.when)}</div><h2>${esc(T(s))}</h2></div>${qbtn(s.id,'Help with this step')}</div>
    <div class="qa" id="qa-${s.id}" hidden><p>${esc(I(s))}</p><dl>${(s.help||[]).map(([q,a])=>`<div><dt>${esc(q)}</dt><dd>${esc(a)}</dd></div>`).join('')}<div><dt>Still stuck?</dt><dd>${P.phone?`Text ${esc(P.phone)} with your name, your store and what happened.`:'Contact your TLE coordinator. Their number will show here in the live hub.'}</dd></div></dl></div>
    ${body}<div id="todo"></div>`;
  drawCheckin();Object.keys(SLOTS).forEach(drawSlot);
  sig=$('sig');
  if(sig){ctx=sig.getContext('2d');sizeSig();
    if(sigData){signed=true;const im=new Image();im.onload=()=>ctx.drawImage(im,0,0,sig.getBoundingClientRect().width,sig.getBoundingClientRect().height);im.src=sigData}
    sig.addEventListener('pointerdown',e=>{drawing=true;sig.setPointerCapture(e.pointerId);ctx.beginPath();ctx.moveTo(...pt(e))});
    sig.addEventListener('pointermove',e=>{if(!drawing)return;ctx.lineTo(...pt(e));ctx.stroke();if(!signed){signed=true;refresh()}});
    ['pointerup','pointercancel'].forEach(n=>sig.addEventListener(n,()=>{if(drawing&&signed){sigData=sig.toDataURL();S.sig=sigData;save()}drawing=false}));}
  refresh();
}
function refresh(){
  const list=all(),c=cur();
  let done=0,total=0;
  work().forEach(s=>s.need().forEach(n=>{if(n.photo){const w=want(n.photo);total+=w;done+=Math.min(photos[n.photo].length,w)}else{total++;if(n.ok)done++}}));
  $('pct').textContent=Math.round(total?done/total*100:0)+'%';
  const allDone=work().every(stepDone);
  if(!c){
    const nx=list.find(s=>!stepDone(s));
    $('list').innerHTML=list.map((s,i)=>{const d=stepDone(s),miss=s.need().filter(n=>!n.ok);
      const k=miss.filter(n=>!n.photo).length,p=miss.filter(n=>n.photo).reduce((a,n)=>a+want(n.photo)-photos[n.photo].length,0);
      const left=[k?`${k} thing${k>1?'s':''} to do`:'',p?`${p} photo${p>1?'s':''} to take`:''].filter(Boolean).join(' · ');
      const sub=d?'Done':s.id==='send'?(allDone?'Ready to submit':'Finish the steps above first'):left;
      return`<button type="button" class="sg${d?' done':''}${s===nx?' nx':''}" data-go="${s.id}" aria-label="Step ${i+1}: ${esc(T(s))}${d?', done':''}"><span class="t">${i+1} · ${esc(T(s))}<small>${sub}</small></span><span class="ck" aria-hidden="true">${d?'✓':''}</span></button>`}).join('');
    $('homeNote').textContent=S.blocked?'The demo could not run, so you only have the short report to do.':'Do the steps in order. Each one gets a check when it is done.';
    return;
  }
  const idx=list.findIndex(x=>x.id===c.id),next=list[idx+1];
  if(c.id==='send'){
    const sum=$('sum');if(sum)sum.innerHTML=work().map((w,i)=>{const left=w.need().filter(n=>!n.ok).length;return`<li><span>${i+1}. ${esc(T(w))}</span><b class="${left?'no':'ok'}">${left?left+' left':'Done'}</b></li>`}).join('');
    const sb=$('sendBtn');if(sb){sb.textContent=!allDone?'Finish the steps above first':S.sent?'Send again (replaces what you sent)':'Send my demo to TLE';sb.disabled=!allDone;sb.className=allDone&&!S.sent?'btn go':allDone?'btn ghost':'btn'}
    $('todo').innerHTML=`<button class="btn ghost" type="button" data-home="1">Back to the list</button>`;
  }else{
    const miss=c.need().filter(n=>!n.ok);
    $('todo').innerHTML=(miss.length?`<div class="box todo"><h3>Still to do here</h3>${miss.map((n,i)=>`<button type="button" data-do="${i}"><span>${esc(n.t)}</span><i>›</i></button>`).join('')}</div>`
      :`<p class="stamp">Step ${idx+1} is done.</p>${next?`<button class="btn go" type="button" data-go="${next.id}">Next: ${esc(T(next))}</button>`:''}`)
      +`<button class="btn ghost" type="button" data-home="1">Back to the list</button>`;
  }
  const tOut=$('tOut');if(tOut)tOut.textContent=S.poured||0;
  parts(c).forEach(p=>{if(p.type==='choice'&&p.warn){const w=$('warn-'+p.k);if(w)w.textContent=S[p.k]===p.warn.is?p.warn.text:''}});
  const cap=$('capMsg');if(cap){const v=parseFloat(String(S.receiptTotal||'').replace(/[^0-9.]/g,''));cap.textContent=P.cap&&v>P.cap?`Over your ${money(P.cap)} limit. Tell your TLE coordinator before you leave.`:''}
}
function goTo(id){S.cur=id;save();render();window.scrollTo(0,0)}
/* what tapping a "Still to do" item does */
function doItem(i){
  const c=cur();if(!c)return;
  const miss=c.need().filter(n=>!n.ok)[i];if(!miss)return;
  if(miss.act==='checkin'){checkIn();return}
  if(miss.photo&&pending[miss.photo]){$('pend-'+miss.photo).scrollIntoView({block:'center'});return}
  const el=$(miss.el);if(!el)return;
  if(miss.photo){el.scrollIntoView({block:'center'});$('file-'+miss.photo).click();return}
  el.scrollIntoView({block:'center'});
  const b=el.closest('.box')||el;b.classList.remove('flash');void b.offsetWidth;b.classList.add('flash');
  if(el.matches('input,textarea'))el.focus({preventScroll:true});
}

document.addEventListener('input',e=>{const t=e.target,k=t.dataset&&t.dataset.k;if(k&&t.type!=='checkbox'){S[k]=t.value;save();refresh()}});
document.addEventListener('change',e=>{
  const t=e.target;
  if(t.type==='radio'){S[t.name]=t.value;save();const c=cur();if(c&&(c.parts||[]).some(p=>p.when&&p.when.k===t.name))render();else refresh()}
  if(t.type==='checkbox'&&t.dataset.k){S[t.dataset.k]=t.checked;save();refresh()}
  if(t.dataset&&t.dataset.slot&&t.files[0]){const id=t.dataset.slot;delete viewing[id];pending[id]={u:URL.createObjectURL(t.files[0]),t:new Date(),file:t.files[0]};t.value='';drawSlot(id);$('pend-'+id).scrollIntoView({block:'center'})}
});
document.addEventListener('click',e=>{
  const t=e.target.closest('button,label')||e.target,id=t.id,d=t.dataset||{};
  if(id==='tkBtn'){const m=$('tkMore');m.hidden=!m.hidden;t.setAttribute('aria-expanded',String(!m.hidden))}
  if(id==='ciBtn')checkIn();
  if(id==='tPlus'){S.poured=(S.poured||0)+1;save();refresh()}
  if(id==='tMinus'){S.poured=Math.max(0,(S.poured||0)-1);save();refresh()}
  if(id==='sigClear'){sizeSig();signed=false;sigData=null;delete S.sig;save();refresh()}
  if(id==='blockBtn'){S.blocked=true;goTo('blocked')}
  if(id==='unblockBtn'){S.blocked=false;goTo(blockHome())}
  if(id==='sendBtn'&&!t.disabled)sendReport();
  if(d.home)goTo('');
  if(d.go)goTo(d.go);
  if(d.do!==undefined)doItem(+d.do);
  if(d.q){const p=$('qa-'+d.q);p.hidden=!p.hidden;t.setAttribute('aria-expanded',String(!p.hidden))}
  if(d.keep)keepPhoto(d.keep);
  if(d.retake){const s=d.retake;URL.revokeObjectURL(pending[s].u);delete pending[s];drawSlot(s);$('file-'+s).click()}
  if(d.view){const[s,i]=d.view.split(':');viewing[s]=viewing[s]===+i?undefined:+i;drawSlot(s)}
  if(d.close){delete viewing[d.close];drawSlot(d.close)}
  if(d.rm){const[s,i]=d.rm.split(':');const gone=photos[s].splice(+i,1)[0];delete viewing[s];drawSlot(s);refresh();
    if(gone&&gone.id)DB.all('photos').then(all=>{const r=all.find(x=>x.id===gone.id);DB.del('photos',gone.id);if(r&&r.sent)enqueue({kind:'remove',id:gone.id})})}
});

/* a kept photo: made smaller, kept on the phone, located, then sent */
async function keepPhoto(s){
  const p=pending[s];delete pending[s];if(!p)return;
  p.id=uid();photos[s].push(p);drawSlot(s);refresh();locating++;
  let blob=p.file;try{blob=await shrink(p.file)}catch(e){}
  const rec={id:p.id,k:P.key,slot:s,t:p.t.toISOString(),blob,loc:undefined,sent:false};
  await DB.put('photos',rec);
  locate(async l=>{p.loc=l;rec.loc=l;drawSlot(s);await DB.put('photos',rec);locating--;
    if(COLLECT)enqueue({kind:'photo',id:p.id,slot:s,title:SLOTS[s].title,n:photos[s].indexOf(p)+1,at:stamp(p.t),clock:clock(p.t)})});
}
/* the report: everything the steps collected, labelled, so TLE can read it as it is */
function sendReport(){
  if(!LIVE){S.sent=true;save();render();return}
  if(locating>0){const b=$('sendBtn');if(b){b.disabled=true;b.textContent='Finishing your photos…'}setTimeout(sendReport,800);return}
  const ticks=[];(S.blocked?P.blockedFlow:P.flow).forEach(id=>{const st=P.steps[id];if(st)parts(st).forEach(p=>{if(p.type==='ticks')p.items.forEach(([k,l])=>{if(S[k])ticks.push(l)})})});
  const cnt=f=>(P.products||[]).map(x=>[x.name,S[x.id+'_'+f]||'']);
  const comments=[];for(let i=1;i<=20;i++)if(has('c'+i))comments.push(S['c'+i]);
  const nPhotos=Object.keys(photos).reduce((a,k)=>a+photos[k].length,0);
  S.sent=new Date().toISOString();S.reportOk='';save();
  enqueue({kind:'report',blocked:!!S.blocked,why:S.why||'',note:S.whatHappened||'',at:stamp(new Date()),countsIn:cnt('countIn'),countsOut:cnt('countOut'),
    poured:S.poured||0,comments,receiptTotal:S.receiptTotal||'',mgrName:S.mgrName||'',sig:S.sig||'',ticks,photos:nPhotos});
  render();
}

S.cur='';
/* photos kept on this phone come back when the page is opened again */
DB.all('photos').then(all=>{all.filter(r=>r.k===P.key&&photos[r.slot]).sort((a,b)=>a.t<b.t?-1:1).forEach(r=>{
  photos[r.slot].push({id:r.id,u:URL.createObjectURL(r.blob),t:new Date(r.t),loc:r.loc===undefined?null:r.loc})});
  if(all.some(r=>r.k===P.key))render()}).finally(()=>{showSync();pump()});
render();
})();
