/* Required Notice: Copyright (c) 2026 Joshua Ott — LadderLens (https://ladderlens.com)
   PolyForm Noncommercial 1.0.0 — commercial use requires a separate license. */

import {esc,truthy,pnum} from './engine.js';

/* The plant simulation + P&ID canvas. It reads and writes PLC tags only
   through hooks.env() — the environment of the controller it is wired to —
   and reports topology changes through hooks.onChange(). */
export function createPlant(hooksIn={}){
const hooks=Object.assign({env:()=>({}), onChange(){}, onLoadPair(){}},hooksIn);
const env=hooks.env;

/* ================= PLANT — P&ID canvas + process simulation =================
   Devices live on an SVG canvas and share the logic's tag environment:
   transmitters WRITE their tank's level to a tag before each scan; valves and
   pumps READ their tags after the scan and move flow; tanks integrate it.
   Flow units: %/s of a tank at 100% open/speed. The plant is saved in
   localStorage; the .st file carries only the logic. */
const PSTORE='ladderlens.plant.v1';
let plant={devices:[]};
let pSel=null, pDrag=null;

const pById=id=>plant.devices.find(d=>d.id===id);
const clamp01=v=>Math.max(0,Math.min(100,v));

function plantSensorTagSet(){
  const s=new Set();
  for(const d of plant.devices) if(d.type==='lt'&&d.pvTag) s.add(d.pvTag);
  return s;
}
function plantActuatorTags(){
  const m=new Map();
  for(const d of plant.devices){
    if(d.type==='valve'&&d.posTag) m.set(d.posTag,'num');
    if(d.type==='pump'){ if(d.runTag) m.set(d.runTag,'bool'); if(d.speedTag) m.set(d.speedTag,'num'); }
  }
  return m;
}
function plantSensors(){
  for(const d of plant.devices)
    if(d.type==='lt'&&d.pvTag){ const t=pById(d.tank); env()[d.pvTag]= t&&t.type==='tank' ? t.level||0 : 0; }
}
function plantTick(dt){
  const flows={};
  for(const d of plant.devices){
    if(d.type!=='valve'&&d.type!=='pump') continue;
    let f=0;
    if(d.type==='valve'){
      const pos=d.posTag ? pnum(env()[d.posTag]) : (d.posConst||0);
      f=(d.maxFlow||0)*clamp01(pos)/100;
    } else {
      const run=d.runTag ? truthy(env()[d.runTag]) : true;
      const spd=d.speedTag ? clamp01(pnum(env()[d.speedTag])) : 100;
      f=run ? (d.maxFlow||0)*spd/100 : 0;
    }
    const src=pById(d.from);
    if(src&&src.type==='tank'&&(src.level||0)<=0) f=0;   // can't draw from empty
    flows[d.id]=f; d._flow=f;
  }
  // conservation: a tank can't surrender more than it holds this tick —
  // prorate its outflows so downstream tanks never receive created mass
  for(const t of plant.devices){
    if(t.type!=='tank') continue;
    let out=0;
    for(const fd of plant.devices)
      if(flows[fd.id]!==undefined&&fd.from===t.id) out+=flows[fd.id];
    const need=out*dt/1000, avail=t.level||0;
    if(need>avail){
      const k=need>0?avail/need:0;
      for(const fd of plant.devices)
        if(flows[fd.id]!==undefined&&fd.from===t.id){ flows[fd.id]*=k; fd._flow=flows[fd.id]; }
    }
  }
  for(const d of plant.devices){
    if(d.type!=='tank') continue;
    let net=0;
    for(const fd of plant.devices){
      if(flows[fd.id]===undefined) continue;
      if(fd.to===d.id) net+=flows[fd.id];
      if(fd.from===d.id) net-=flows[fd.id];
    }
    d.level=clamp01((d.level||0)+net*dt/1000);
    d._over=d.level>=100&&net>0;
  }
}
function plantReset(){
  for(const d of plant.devices){
    if(d.type==='tank'){ d.level=d.level0!==undefined?d.level0:0; d._over=false; }
    else if(d.type==='valve'||d.type==='pump') d._flow=0;   // stop pipe animation
  }
}
function plantSave(){ try{ localStorage.setItem(PSTORE,JSON.stringify(plant)); }catch(e){} }
function plantLoad(){
  // localStorage persists across reloads — malformed entries must never brick boot
  try{
    const s=localStorage.getItem(PSTORE);
    if(s){
      const p=JSON.parse(s);
      if(p&&Array.isArray(p.devices)){
        const TYPES=['tank','valve','pump','lt','supply','drain'];
        const seen=new Set();
        p.devices=p.devices.filter(d=>{
          if(!d||typeof d!=='object'||typeof d.id!=='string'||!TYPES.includes(d.type)||seen.has(d.id)) return false;
          seen.add(d.id);
          d.name=typeof d.name==='string'?d.name:d.id;
          d.x=isFinite(d.x)?d.x:100; d.y=isFinite(d.y)?d.y:100;
          for(const f of ['level','level0','maxFlow','posConst']) if(d[f]!==undefined&&!isFinite(d[f])) d[f]=0;
          return true;
        });
        plant=p;
        return true;
      }
    }
  }catch(e){}
  return false;
}

/* ---- geometry ---- */
function outPort(d){ return d.type==='tank' ? {x:d.x,y:d.y+45} : {x:d.x+14,y:d.y}; }
function inPort(d){ return d.type==='tank' ? {x:d.x,y:d.y-45} : {x:d.x-14,y:d.y}; }
function routeTo(s,e,startVert){       // source port -> flow device inlet
  if(s.y===e.y) return `M ${s.x} ${s.y} L ${e.x} ${e.y}`;
  if(startVert) return `M ${s.x} ${s.y} L ${s.x} ${e.y} L ${e.x} ${e.y}`;
  const mx=(s.x+e.x)/2;
  return `M ${s.x} ${s.y} L ${mx} ${s.y} L ${mx} ${e.y} L ${e.x} ${e.y}`;
}
function routeFrom(s,e,endVert){       // flow device outlet -> dest port
  if(endVert) return `M ${s.x} ${s.y} L ${e.x} ${s.y} L ${e.x} ${e.y}`;
  if(s.y===e.y) return `M ${s.x} ${s.y} L ${e.x} ${e.y}`;
  const mx=(s.x+e.x)/2;
  return `M ${s.x} ${s.y} L ${mx} ${s.y} L ${mx} ${e.y} L ${e.x} ${e.y}`;
}

function symbolSVG(d){
  const sel=pSel===d.id?' sel':'';
  const g=`<g class="sym${sel}" data-pid="${esc(d.id)}" transform="translate(${d.x},${d.y})">`;
  switch(d.type){
    case 'tank': return g+`
      <rect class="hull" x="-35" y="-45" width="70" height="90" fill="#151a1e" stroke="#3d7a6b" rx="3"/>
      <rect class="tanklevel" data-lvl x="-33" y="43" width="66" height="0" rx="2"/>
      <text y="-52" text-anchor="middle" font-size="11">${esc(d.name)}</text>
      <text data-lvltxt y="4" text-anchor="middle" font-size="11" fill="#9fe3cb">—</text>
      <text data-over y="-32" text-anchor="middle" font-size="9" fill="#e0864a"></text></g>`;
    case 'valve': return g+`
      <path class="hull" d="M -14 -9 L 0 0 L -14 9 Z M 14 -9 L 0 0 L 14 9 Z" fill="#1e2a31" stroke="#c8963e" stroke-width="1.5"/>
      <line x1="0" y1="0" x2="0" y2="-12" stroke="#c8963e" stroke-width="1.5"/>
      <circle cx="0" cy="-15" r="4" fill="none" stroke="#c8963e" stroke-width="1.5"/>
      <text y="-26" text-anchor="middle" font-size="10">${esc(d.name)}</text>
      <text data-postxt y="24" text-anchor="middle" font-size="9" fill="#7fa89a">—</text></g>`;
    case 'pump': return g+`
      <circle class="hull" r="13" fill="#1e2a31" stroke="#3d7a6b" stroke-width="1.5"/>
      <path data-rotor d="M -5 -7 L 8 0 L -5 7 Z" fill="#6c7a85"/>
      <text y="-19" text-anchor="middle" font-size="10">${esc(d.name)}</text>
      <text data-runtxt y="26" text-anchor="middle" font-size="9" fill="#7fa89a">—</text></g>`;
    case 'lt': return g+`
      <circle class="hull" r="11" fill="#1d1712" stroke="#e0864a" stroke-width="1.2"/>
      <text y="3" text-anchor="middle" font-size="8" fill="#e0864a">LT</text>
      <text y="-16" text-anchor="middle" font-size="10">${esc(d.name)}</text>
      <text data-pvtxt y="24" text-anchor="middle" font-size="9" fill="#7fa89a">${esc(d.pvTag||'—')}</text></g>`;
    case 'supply': return g+`
      <circle class="hull" r="10" fill="#151a1e" stroke="#6c7a85" stroke-width="1.5"/>
      <path d="M -4 0 L 6 0 M 2 -4 L 6 0 L 2 4" stroke="#6c7a85" stroke-width="1.5" fill="none"/>
      <text y="-16" text-anchor="middle" font-size="10">${esc(d.name)}</text></g>`;
    case 'drain': return g+`
      <circle class="hull" r="10" fill="#151a1e" stroke="#6c7a85" stroke-width="1.5"/>
      <path d="M -6 0 L 4 0 M 0 -4 L 4 0 L 0 4" stroke="#6c7a85" stroke-width="1.5" fill="none"/>
      <text y="-16" text-anchor="middle" font-size="10">${esc(d.name)}</text></g>`;
  }
  return g+'</g>';
}

function plantRebuild(){
  const svg=document.getElementById('pcanvas');
  if(!svg) return;
  const W=Math.max(svg.clientWidth,400), H=440;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  let pipes='', inst='', syms='';
  for(const d of plant.devices){
    if(d.type==='valve'||d.type==='pump'){
      const s=pById(d.from), t=pById(d.to);
      if(s) pipes+=`<path class="pipe" data-pipe="${esc(d.id)}" d="${routeTo(outPort(s),{x:d.x-14,y:d.y},s.type==='tank')}"/>`;
      if(t) pipes+=`<path class="pipe" data-pipe="${esc(d.id)}" d="${routeFrom({x:d.x+14,y:d.y},inPort(t),t.type==='tank')}"/>`;
    }
    if(d.type==='lt'&&d.tank){
      const t=pById(d.tank);
      if(t) inst+=`<path class="instline" d="M ${d.x} ${d.y+11} L ${t.x+20} ${t.y-45}"/>`;
    }
  }
  for(const d of plant.devices) syms+=symbolSVG(d);
  svg.innerHTML=pipes+inst+syms;
}

function plantPaint(){
  const svg=document.getElementById('pcanvas');
  if(!svg||!svg.childNodes.length) return;
  for(const d of plant.devices){
    const g=svg.querySelector(`[data-pid="${d.id}"]`);
    if(!g) continue;
    if(d.type==='tank'){
      const h=86*clamp01(d.level||0)/100;
      const lv=g.querySelector('[data-lvl]');
      if(lv){ lv.setAttribute('height',h.toFixed(1)); lv.setAttribute('y',(43-h).toFixed(1));
              lv.classList.toggle('hi',!!d._over); }
      const lt=g.querySelector('[data-lvltxt]'); if(lt) lt.textContent=(d.level||0).toFixed(1)+'%';
      const ov=g.querySelector('[data-over]'); if(ov) ov.textContent=d._over?'OVERFLOW':'';
    } else if(d.type==='valve'){
      const pos=d.posTag?pnum(env()[d.posTag]):(d.posConst||0);
      const tx=g.querySelector('[data-postxt]');
      if(tx) tx.textContent=(d.posTag?d.posTag+' = ':'')+clamp01(pos).toFixed(0)+'%';
    } else if(d.type==='pump'){
      const run=d.runTag?truthy(env()[d.runTag]):true;
      const rot=g.querySelector('[data-rotor]'); if(rot) rot.setAttribute('fill',run?'#5fd38d':'#6c7a85');
      const tx=g.querySelector('[data-runtxt]');
      if(tx) tx.textContent=(d.runTag?d.runTag+' = ':'')+(run?'RUN':'STOP');
    } else if(d.type==='lt'&&d.pvTag){
      const tx=g.querySelector('[data-pvtxt]');
      if(tx) tx.textContent=d.pvTag+' = '+pnum(env()[d.pvTag]).toFixed(1);
    }
    if(d._flow!==undefined)
      svg.querySelectorAll(`[data-pipe="${d.id}"]`).forEach(p=>p.classList.toggle('flowing',d._flow>0));
  }
  const rows=[];
  plantSensorTagSet().forEach(t=>rows.push([t+' (PV)',pnum(env()[t]).toFixed(1)]));
  for(const [t,k] of plantActuatorTags())
    rows.push([t, k==='bool'?(truthy(env()[t])?'TRUE':'FALSE'):pnum(env()[t]).toFixed(1)]);
  const pt=document.getElementById('ptags');
  if(pt){
    const html=rows.map(([a,b])=>`<label>${esc(a)}</label><span class="out">${esc(b)}</span>`).join('')
      ||'<span class="out" style="color:var(--dim)">no bound tags</span>';
    if(pt.dataset.sig!==html){ pt.innerHTML=html; pt.dataset.sig=html; }
  }
}

/* ---- interaction ---- */
const svgEl=document.getElementById('pcanvas');
function svgPoint(e){
  const r=svgEl.getBoundingClientRect();
  const vb=svgEl.viewBox.baseVal;
  const sx=vb&&vb.width?vb.width/r.width:1, sy=vb&&vb.height?vb.height/r.height:1;
  return {x:(e.clientX-r.left)*sx, y:(e.clientY-r.top)*sy};
}
svgEl.addEventListener('pointerdown',e=>{
  const g=e.target.closest('.sym');
  if(!g){ pSel=null; plantRebuild(); plantPaint(); renderInspector(); return; }
  pSel=g.dataset.pid;
  const d=pById(pSel); if(!d) return;
  const pt=svgPoint(e);
  pDrag={id:pSel,dx:pt.x-d.x,dy:pt.y-d.y,moved:false};
  svgEl.setPointerCapture(e.pointerId);
  plantRebuild(); plantPaint(); renderInspector();
});
svgEl.addEventListener('pointermove',e=>{
  if(!pDrag) return;
  const d=pById(pDrag.id); if(!d) return;
  const pt=svgPoint(e);
  const nx=Math.round((pt.x-pDrag.dx)/10)*10, ny=Math.round((pt.y-pDrag.dy)/10)*10;
  if(nx!==d.x||ny!==d.y){ d.x=nx; d.y=ny; pDrag.moved=true; plantRebuild(); plantPaint(); }
});
svgEl.addEventListener('pointerup',()=>{ if(pDrag&&pDrag.moved) plantSave(); pDrag=null; });

function renderInspector(){
  const el=document.getElementById('pinspect');
  if(!el) return;
  const d=pSel?pById(pSel):null;
  if(!d){ el.innerHTML='click a device to configure it — drag to move'; return; }
  const opts=(types,cur)=>['<option value="">—</option>',
    ...plant.devices.filter(x=>types.includes(x.type)).map(x=>
      `<option value="${esc(x.id)}"${x.id===cur?' selected':''}>${esc(x.name)}</option>`)].join('');
  let rows=`<div class="irow"><label>name</label><input data-pf="name" value="${esc(d.name)}"></div>`;
  if(d.type==='tank') rows+=`
    <div class="irow"><label>level %</label><input data-pf="level" type="number" value="${(d.level||0).toFixed(0)}"></div>
    <div class="irow"><label>start %</label><input data-pf="level0" type="number" value="${d.level0!==undefined?d.level0:0}"></div>`;
  if(d.type==='valve') rows+=`
    <div class="irow"><label>from</label><select data-pf="from">${opts(['supply','tank'],d.from)}</select></div>
    <div class="irow"><label>to</label><select data-pf="to">${opts(['tank','drain'],d.to)}</select></div>
    <div class="irow"><label>max %/s</label><input data-pf="maxFlow" type="number" value="${d.maxFlow!==undefined?d.maxFlow:5}"></div>
    <div class="irow"><label>pos tag</label><input data-pf="posTag" value="${esc(d.posTag||'')}" placeholder="0–100 tag, empty = const"></div>
    <div class="irow"><label>const %</label><input data-pf="posConst" type="number" value="${d.posConst!==undefined?d.posConst:0}"></div>`;
  if(d.type==='pump') rows+=`
    <div class="irow"><label>from</label><select data-pf="from">${opts(['supply','tank'],d.from)}</select></div>
    <div class="irow"><label>to</label><select data-pf="to">${opts(['tank','drain'],d.to)}</select></div>
    <div class="irow"><label>max %/s</label><input data-pf="maxFlow" type="number" value="${d.maxFlow!==undefined?d.maxFlow:5}"></div>
    <div class="irow"><label>run tag</label><input data-pf="runTag" value="${esc(d.runTag||'')}" placeholder="BOOL, empty = always run"></div>
    <div class="irow"><label>speed tag</label><input data-pf="speedTag" value="${esc(d.speedTag||'')}" placeholder="0–100, empty = 100"></div>`;
  if(d.type==='lt') rows+=`
    <div class="irow"><label>tank</label><select data-pf="tank">${opts(['tank'],d.tank)}</select></div>
    <div class="irow"><label>PV tag</label><input data-pf="pvTag" value="${esc(d.pvTag||'')}" placeholder="e.g. rLevel_PV"></div>`;
  rows+=`<div class="irow"><button class="fbtn" data-pdel="${esc(d.id)}">delete device</button></div>`;
  el.innerHTML=rows;
}
document.getElementById('pinspect').addEventListener('change',e=>{
  const f=e.target.dataset.pf;
  if(!f||!pSel) return;
  const d=pById(pSel); if(!d) return;
  let v=e.target.value.trim();
  if(['level','level0','maxFlow','posConst'].includes(f)){
    v=parseFloat(v); if(isNaN(v)) v=0;
    v = f==='maxFlow' ? Math.max(0,v) : clamp01(v);
  }
  if(['posTag','runTag','speedTag','pvTag'].includes(f)&&v&&!/^[A-Za-z_]\w*$/.test(v)){ renderInspector(); return; }
  d[f]= (v===''&&['posTag','runTag','speedTag','pvTag','from','to','tank'].includes(f)) ? undefined : v;
  if(f==='level') d._over=false;   // editing the level clears a stale overflow flag
  plantSave(); plantRebuild(); plantPaint(); renderInspector();
  hooks.onChange();
});
document.getElementById('pinspect').addEventListener('click',e=>{
  const del=e.target.dataset.pdel; if(!del) return;
  plant.devices=plant.devices.filter(x=>x.id!==del);
  for(const d of plant.devices){
    if(d.from===del) d.from=undefined;
    if(d.to===del) d.to=undefined;
    if(d.tank===del) d.tank=undefined;
  }
  pSel=null;
  plantSave(); plantRebuild(); plantPaint(); renderInspector(); hooks.onChange();
});
document.querySelectorAll('[data-padd]').forEach(b=>b.addEventListener('click',()=>{
  const t=b.dataset.padd;
  const base={tank:'TK',valve:'LV',pump:'P',lt:'LT',supply:'SUP',drain:'DR'}[t];
  let n=1; while(plant.devices.some(d=>d.id===base+'-'+n)) n++;
  const d={id:base+'-'+n,type:t,name:base+'-'+n,
    x:90+((plant.devices.length*40)%300),y:90+((plant.devices.length%5)*70)};
  if(t==='tank'){ d.level=0; d.level0=0; }
  if(t==='valve'){ d.maxFlow=5; d.posConst=0; }
  if(t==='pump'){ d.maxFlow=5; }
  plant.devices.push(d); pSel=d.id;
  plantSave(); plantRebuild(); plantPaint(); renderInspector(); hooks.onChange();
}));
document.getElementById('pclear').addEventListener('click',()=>{
  plant={devices:[]}; pSel=null;
  plantSave(); plantRebuild(); plantPaint(); renderInspector(); hooks.onChange();
});

function plantExample(){
  plant={devices:[
    {id:'SUP-1',type:'supply',name:'SUPPLY',x:70,y:120},
    {id:'LV-101',type:'valve',name:'LV-101',x:190,y:120,from:'SUP-1',to:'TK-101',maxFlow:6,posTag:'rValve_OP'},
    {id:'TK-101',type:'tank',name:'TK-101',x:350,y:230,level:40,level0:40},
    {id:'LT-101',type:'lt',name:'LT-101',x:470,y:150,tank:'TK-101',pvTag:'rLevel_PV'},
    {id:'LV-102',type:'valve',name:'LV-102',x:350,y:360,from:'TK-101',to:'DR-1',maxFlow:6,posConst:45},
    {id:'DR-1',type:'drain',name:'DRAIN',x:500,y:360},
  ]};
}
document.getElementById('pex1').addEventListener('click',()=>{
  plantExample(); pSel=null;
  plantSave(); plantRebuild(); renderInspector();
  hooks.onLoadPair();   // the shell cold-starts the paired logic example, then paints
});

return {load:plantLoad, save:plantSave, example:plantExample, reset:plantReset,
  publishSensors:plantSensors, tick:plantTick, paint:plantPaint, rebuild:plantRebuild,
  inspector:renderInspector, sensorTagSet:plantSensorTagSet, actuatorTags:plantActuatorTags};
}
