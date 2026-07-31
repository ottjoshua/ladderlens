/* Required Notice: Copyright (c) 2026 Joshua Ott — LadderLens (https://ladderlens.com)
   PolyForm Noncommercial 1.0.0 — commercial use requires a separate license. */

import {esc,truthy,pnum} from './engine.js';
import {vendorsFor,modelsFor} from './catalog.js';
import {validTag,isProcessType,defaultLevel} from './project.js';

/* The plant simulation + P&ID canvas. It reads and writes PLC tags only
   through hooks.env() — the environment of the controller it is wired to —
   and reports topology changes through hooks.onChange(). */
export function createPlant(hooksIn={}){
const hooks=Object.assign({env:()=>({}), onChange(){}, onLoadPair(){}, onOpenLogic(){}},hooksIn);
const env=hooks.env;
const plant=hooks.project.data;   // devices live in the project model

/* ================= PLANT — P&ID canvas + process simulation =================
   Devices live on an SVG canvas and share the logic's tag environment:
   transmitters WRITE their tank's level to a tag before each scan; valves and
   pumps READ their tags after the scan and move flow; tanks integrate it.
   Flow units: %/s of a tank at 100% open/speed. The plant is saved in
   localStorage; the .st file carries only the logic. */
let pSel=null, pDrag=null;

const pById=id=>plant.devices.find(d=>d.id===id);
const clamp01=v=>Math.max(0,Math.min(100,v));

function plantSensorTagSet(){
  const s=new Set();
  for(const d of plant.devices){
    if(d.type==='lt'&&d.pvTag) s.add(d.pvTag);
    if(d.type==='ft'&&d.flowTag) s.add(d.flowTag);
    if(d.type==='ls'&&d.outTag) s.add(d.outTag);
  }
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
const LS_SP_DEFAULT=90;
/* an instrument may only ever publish a number or a boolean into the tag
   environment: values reaching here have passed through file validation, but
   a transient like _flow is not a validated field — coerce at the boundary */
function publish(tag,v){ if(tag) env()[tag]=v; }
function plantSensors(){
  for(const d of plant.devices){
    if(d.type==='lt'){ const t=pById(d.tank); publish(d.pvTag, t&&t.type==='tank' ? pnum(t.level) : 0); }
    // FT publishes the flow its attached valve/pump moved last tick (%/s) —
    // one tick behind the actuator, like a real field instrument
    if(d.type==='ft'){
      const t=pById(d.dev);
      publish(d.flowTag, t&&(t.type==='valve'||t.type==='pump') ? pnum(t._flow) : 0);
    }
    // LS trips when its tank crosses the setpoint: high => TRUE at/above, low
    // => TRUE at/below. No tank means no measurement, which is never a trip —
    // a dangling reference must not silently latch an interlock.
    if(d.type==='ls'){
      const t=pById(d.tank);
      if(!t||t.type!=='tank'){ publish(d.outTag,false); continue; }
      const lv=pnum(t.level), sp=d.sp!==undefined?d.sp:LS_SP_DEFAULT;
      publish(d.outTag, d.mode==='low' ? lv<=sp : lv>=sp);
    }
  }
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
/* persistence + validation live in the project model */
function plantSave(){ hooks.project.save(); }
function plantLoad(){ return hooks.project.load(); }

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
    case 'valve':{
      // ISA: an actuator bonnet means an automated valve; a bare bowtie is a
      // hand valve. The bonnet appears only when a position tag drives it.
      const act=d.posTag
        ? `<line x1="0" y1="0" x2="0" y2="-12" stroke="#c8963e" stroke-width="1.5"/>
           <circle cx="0" cy="-15" r="4" fill="none" stroke="#c8963e" stroke-width="1.5"/>`
        : '';
      return g+`
      <path class="hull" d="M -14 -9 L 0 0 L -14 9 Z M 14 -9 L 0 0 L 14 9 Z" fill="#1e2a31" stroke="#c8963e" stroke-width="1.5"/>
      ${act}
      <text y="-26" text-anchor="middle" font-size="10">${esc(d.name)}</text>
      <text data-postxt y="24" text-anchor="middle" font-size="9" fill="#7fa89a">—</text></g>`;
    }
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
    case 'ft': return g+`
      <circle class="hull" r="11" fill="#1d1712" stroke="#e0864a" stroke-width="1.2"/>
      <text y="3" text-anchor="middle" font-size="8" fill="#e0864a">FT</text>
      <text y="-16" text-anchor="middle" font-size="10">${esc(d.name)}</text>
      <text data-fttxt y="24" text-anchor="middle" font-size="9" fill="#7fa89a">${esc(d.flowTag||'—')}</text></g>`;
    case 'ls': return g+`
      <circle class="hull" r="11" fill="#1d1712" stroke="#e0864a" stroke-width="1.2"/>
      <text y="3" text-anchor="middle" font-size="7.5" fill="#e0864a">${d.mode==='low'?'LSL':'LSH'}</text>
      <text y="-16" text-anchor="middle" font-size="10">${esc(d.name)}</text>
      <text data-lstxt y="24" text-anchor="middle" font-size="9" fill="#7fa89a">${esc(d.outTag||'—')}</text></g>`;
    case 'plc': return g+`
      <rect class="hull" x="-26" y="-18" width="52" height="36" rx="4" fill="#131a22" stroke="#4a7dab" stroke-width="1.5"/>
      <line x1="-26" y1="-8" x2="26" y2="-8" stroke="#2c4a66" stroke-width="1"/>
      <circle cx="-20" cy="-13" r="2" fill="#5fd38d"/>
      <text y="8" text-anchor="middle" font-size="9" fill="#7fb2e0">PLC</text>
      <text y="-24" text-anchor="middle" font-size="10">${esc(d.name)}</text>
      <text y="30" text-anchor="middle" font-size="8" fill="#6c7a85">${esc([d.vendor,d.model].filter(Boolean).join(' '))}</text></g>`;
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
  // the canvas fills the workbench — the viewBox tracks its on-screen size so
  // device coordinates stay 1:1 with pixels at any window size
  const W=Math.max(svg.clientWidth,400), H=Math.max(svg.clientHeight,340);
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
    if(d.type==='ls'&&d.tank){
      const t=pById(d.tank);
      if(t) inst+=`<path class="instline" d="M ${d.x} ${d.y+11} L ${t.x-20} ${t.y-45}"/>`;
    }
    if(d.type==='ft'&&d.dev){
      const t=pById(d.dev);
      if(t&&(t.type==='valve'||t.type==='pump')) inst+=`<path class="instline" d="M ${d.x} ${d.y+11} L ${t.x} ${t.y-4}"/>`;
    }
  }
  // network devices belong to the Purdue view; the P&ID draws process only
  for(const d of plant.devices) if(isProcessType(d.type)) syms+=symbolSVG(d);
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
    } else if(d.type==='ft'&&d.flowTag){
      const tx=g.querySelector('[data-fttxt]');
      if(tx) tx.textContent=d.flowTag+' = '+pnum(env()[d.flowTag]).toFixed(2);
    } else if(d.type==='ls'&&d.outTag){
      const tx=g.querySelector('[data-lstxt]');
      if(tx) tx.textContent=d.outTag+' = '+(truthy(env()[d.outTag])?'TRIP':'ok');
    }
    if(d._flow!==undefined)
      svg.querySelectorAll(`[data-pipe="${d.id}"]`).forEach(p=>p.classList.toggle('flowing',d._flow>0));
  }
  const rows=[];
  plantSensorTagSet().forEach(t=>{
    const v=env()[t];
    rows.push([t+' (PV)', typeof v==='boolean' ? (v?'TRUE':'FALSE') : pnum(v).toFixed(1)]);
  });
  for(const [t,k] of plantActuatorTags())
    rows.push([t, k==='bool'?(truthy(env()[t])?'TRUE':'FALSE'):pnum(env()[t]).toFixed(1)]);
  const pt=document.getElementById('ptags');
  if(pt){
    const html=rows.map(([a,b])=>`<label>${esc(a)}</label><span class="out">${esc(b)}</span>`).join('')
      ||'<span class="out" style="color:var(--dim)">no bound tags</span>';
    if(pt.dataset.sig!==html){ pt.innerHTML=html; pt.dataset.sig=html; }
  }
  const pw=document.getElementById('pwarn');
  if(pw){
    const w=tagConflicts();
    const html=w.length?'<div class="warnbox">'+w.map(x=>'&middot; '+x).join('<br>')+'</div>':'';
    if(pw.dataset.sig!==html){ pw.innerHTML=html; pw.dataset.sig=html; }
  }
}

/* two devices writing one tag is silent last-writer-wins — name the collision
   rather than let a plausible-looking wrong value ride */
function tagConflicts(){
  const writers=new Map();   // tag -> [device label, ...]
  const note=(tag,label)=>{ if(!tag) return; if(!writers.has(tag)) writers.set(tag,[]); writers.get(tag).push(label); };
  for(const d of plant.devices){
    if(d.type==='lt') note(d.pvTag,d.name+' (level)');
    if(d.type==='ft') note(d.flowTag,d.name+' (flow)');
    if(d.type==='ls') note(d.outTag,d.name+' (switch)');
  }
  const out=[];
  for(const [tag,who] of writers)
    if(who.length>1)
      out.push('<b>'+esc(tag)+'</b> is published by '+who.map(esc).join(' and ')
        +' — the last one each scan wins, so the reading is not what it looks like. Give them separate tags.');
  const acts=plantActuatorTags();
  for(const [tag] of writers)
    if(acts.has(tag))
      out.push('<b>'+esc(tag)+'</b> is both an instrument reading and an actuator command — '
        +'the instrument overwrites the command before every scan.');
  return out;
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
let rszTimer=null;
window.addEventListener('resize',()=>{
  clearTimeout(rszTimer);
  rszTimer=setTimeout(()=>{
    const wrap=document.getElementById('plantwrap');
    if(wrap&&!wrap.hidden){ plantRebuild(); plantPaint(); }
  },150);
});
svgEl.addEventListener('dblclick',e=>{
  const g=e.target.closest('.sym'); if(!g) return;
  const d=pById(g.dataset.pid);
  if(d&&d.type==='plc') hooks.onOpenLogic(d.id);
});

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
  if(d.type==='plc'){
    // a project may name a make/model this build's catalog doesn't carry (an
    // older file, a hand edit). Show it as its own option rather than letting
    // the select fall back to "—" and misreport what the device declares.
    const optList=(list,cur)=>{
      const out=['<option value="">—</option>'];
      for(const x of list) out.push(`<option${x===cur?' selected':''}>${esc(x)}</option>`);
      if(cur&&!list.includes(cur)) out.push(`<option selected>${esc(cur)}</option>`);
      return out.join('');
    };
    const vsel=optList(vendorsFor('plc'),d.vendor);
    const msel=optList(modelsFor('plc',d.vendor),d.model);
    rows+=`
    <div class="irow"><label>make</label><select data-pf="vendor">${vsel}</select></div>
    <div class="irow"><label>model</label><select data-pf="model">${msel}</select></div>
    <div class="irow"><button class="fbtn" data-popen="${esc(d.id)}">open logic — edit this controller's program</button></div>`;
  }
  if(d.type==='lt') rows+=`
    <div class="irow"><label>tank</label><select data-pf="tank">${opts(['tank'],d.tank)}</select></div>
    <div class="irow"><label>PV tag</label><input data-pf="pvTag" value="${esc(d.pvTag||'')}" placeholder="e.g. rLevel_PV"></div>`;
  if(d.type==='ft') rows+=`
    <div class="irow"><label>measures</label><select data-pf="dev">${opts(['valve','pump'],d.dev)}</select></div>
    <div class="irow"><label>flow tag</label><input data-pf="flowTag" value="${esc(d.flowTag||'')}" placeholder="e.g. rFlow_PV (%/s)"></div>`;
  if(d.type==='ls') rows+=`
    <div class="irow"><label>tank</label><select data-pf="tank">${opts(['tank'],d.tank)}</select></div>
    <div class="irow"><label>trip at %</label><input data-pf="sp" type="number" value="${d.sp!==undefined?d.sp:LS_SP_DEFAULT}"></div>
    <div class="irow"><label>direction</label><select data-pf="mode">
      <option value="high"${d.mode!=='low'?' selected':''}>high — TRUE at/above</option>
      <option value="low"${d.mode==='low'?' selected':''}>low — TRUE at/below</option></select></div>
    <div class="irow"><label>out tag</label><input data-pf="outTag" value="${esc(d.outTag||'')}" placeholder="BOOL, e.g. bLevelHiHi"></div>`;
  rows+=`<div class="irow"><button class="fbtn" data-pdel="${esc(d.id)}">delete device</button></div>`;
  el.innerHTML=rows;
}
document.getElementById('pinspect').addEventListener('change',e=>{
  const f=e.target.dataset.pf;
  if(!f||!pSel) return;
  const d=pById(pSel); if(!d) return;
  let v=e.target.value.trim();
  if(['level','level0','maxFlow','posConst','sp'].includes(f)){
    v=parseFloat(v); if(isNaN(v)) v=0;
    v = f==='maxFlow' ? Math.max(0,v) : clamp01(v);
  }
  if(['posTag','runTag','speedTag','pvTag','flowTag','outTag'].includes(f)&&v&&!validTag(v)){ renderInspector(); return; }
  d[f]= (v===''&&['posTag','runTag','speedTag','pvTag','flowTag','outTag','from','to','tank','dev','vendor','model'].includes(f)) ? undefined : v;
  if(f==='vendor') d.model=undefined;   // model list follows the make
  if(f==='level') d._over=false;   // editing the level clears a stale overflow flag
  plantSave(); plantRebuild(); plantPaint(); renderInspector();
  hooks.onChange();
});
document.getElementById('pinspect').addEventListener('click',e=>{
  const open=e.target.dataset.popen;
  if(open){ hooks.onOpenLogic(open); return; }
  const del=e.target.dataset.pdel; if(!del) return;
  plant.devices=plant.devices.filter(x=>x.id!==del);
  plant.connections=(plant.connections||[]).filter(c=>c.from!==del&&c.to!==del);
  for(const d of plant.devices){
    if(d.from===del) d.from=undefined;
    if(d.to===del) d.to=undefined;
    if(d.tank===del) d.tank=undefined;
    if(d.dev===del) d.dev=undefined;
  }
  pSel=null;
  plantSave(); plantRebuild(); plantPaint(); renderInspector(); hooks.onChange();
});
document.querySelectorAll('[data-padd]').forEach(b=>b.addEventListener('click',()=>{
  const t=b.dataset.padd;
  const base={tank:'TK',valve:'LV',pump:'P',lt:'LT',ft:'FT',ls:'LSH',supply:'SUP',drain:'DR',plc:'PLC'}[t];
  let n=1; while(plant.devices.some(d=>d.id===base+'-'+n)) n++;
  const d={id:base+'-'+n,type:t,name:base+'-'+n,
    x:90+((plant.devices.length*40)%300),y:90+((plant.devices.length%5)*70),
    purdueLevel:defaultLevel(t),px:9999};   // also lands in its Purdue lane
  if(t==='tank'){ d.level=0; d.level0=0; }
  if(t==='valve'){ d.maxFlow=5; d.posConst=0; }
  if(t==='pump'){ d.maxFlow=5; }
  if(t==='ls'){ d.sp=LS_SP_DEFAULT; d.mode='high'; }
  if(t==='plc'){ d.program='(* '+d.name+' — write this controller\'s logic here *)\n'; d.inputs={}; }
  plant.devices.push(d); pSel=d.id;
  plantSave(); plantRebuild(); plantPaint(); renderInspector(); hooks.onChange();
}));
document.getElementById('pclear').addEventListener('click',()=>{
  plant.devices=[]; plant.connections=[]; pSel=null;
  plantSave(); plantRebuild(); plantPaint(); renderInspector(); hooks.onChange();
});

function plantExample(){
  plant.devices=[
    {id:'PLC-1',type:'plc',name:'PLC-1',x:120,y:260,program:'',inputs:{},vendor:'Simulated',model:'SoftPLC'},
    {id:'SUP-1',type:'supply',name:'SUPPLY',x:70,y:120},
    {id:'LV-101',type:'valve',name:'LV-101',x:190,y:120,from:'SUP-1',to:'TK-101',maxFlow:6,posTag:'rValve_OP'},
    {id:'TK-101',type:'tank',name:'TK-101',x:350,y:230,level:40,level0:40},
    {id:'LT-101',type:'lt',name:'LT-101',x:470,y:150,tank:'TK-101',pvTag:'rLevel_PV'},
    {id:'LSH-101',type:'ls',name:'LSH-101',x:560,y:250,tank:'TK-101',sp:90,mode:'high',outTag:'bLevelHiHi'},
    {id:'LV-102',type:'valve',name:'LV-102',x:350,y:360,from:'TK-101',to:'DR-1',maxFlow:6,posConst:45},
    {id:'DR-1',type:'drain',name:'DRAIN',x:500,y:360},
    // network side: the same plant seen from the Purdue view
    {id:'SW-1',type:'switch',name:'SW-1',x:120,y:120,purdueLevel:2,px:100},
    {id:'HMI-1',type:'hmi',name:'HMI-1',x:120,y:120,purdueLevel:2,px:0},
    {id:'EWS-1',type:'ews',name:'EWS-1',x:120,y:120,purdueLevel:2,px:200},
    {id:'HIST-1',type:'historian',name:'HIST-1',x:120,y:120,purdueLevel:3,px:0},
    {id:'FW-1',type:'firewall',name:'FW-1',x:120,y:120,purdueLevel:3.5,px:0},
  ];
  plant.connections=[
    {from:'PLC-1',to:'SW-1',proto:'EtherNet/IP'},
    {from:'HMI-1',to:'SW-1',proto:'Ethernet'},
    {from:'EWS-1',to:'SW-1',proto:'Ethernet'},
    {from:'SW-1',to:'HIST-1',proto:'OPC UA'},
    {from:'HIST-1',to:'FW-1',proto:'OPC UA'},
  ];
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
