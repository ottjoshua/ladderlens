/* Required Notice: Copyright (c) 2026 Joshua Ott — LadderLens (https://ladderlens.com)
   PolyForm Noncommercial 1.0.0 — commercial use requires a separate license. */

import {esc} from './engine.js';
import {LEVELS,isNetType,defaultLevel,PROTOCOLS} from './project.js';
import {DMZ_SAFE} from './net.js';

/* ---------- the Purdue view ----------
   The same project devices, projected into ISA-95 levels instead of onto a
   P&ID. A tank drawn at Level 0 here IS the tank on the P&ID — one model,
   two pictures. Network devices (HMI, EWS, historian, switch, firewall) only
   appear here; conduits between devices are the links, and a firewall is a
   device the conduit passes through, the way a valve sits in a pipe. */
export function createPurdue(hooksIn={}){
const hooks=Object.assign({project:null, onChange(){}, onOpenLogic(){}, net:null},hooksIn);
const proj=hooks.project.data;
const net=hooks.net;

const LANE_H=112, PAD=14, LABEL_W=168, CARD_W=104, CARD_H=52, GAP=18;
let sel=null, drag=null, selConn=null;   // selConn = "from|to" of an inspected conduit

const byId=id=>proj.devices.find(d=>d.id===id);
/* a device created on the P&ID has never declared a level — it sits at its
   type's default until someone drags it somewhere else. This is purdueLevel:
   `level` belongs to the process model (how full a tank is). */
const levelOf=d=>LEVELS.some(L=>L.id===d.purdueLevel)?d.purdueLevel:defaultLevel(d.type);
const setLevel=(d,lv)=>{ if(LEVELS.some(L=>L.id===lv)) d.purdueLevel=lv; };
const laneY=lv=>{ const i=LEVELS.findIndex(l=>l.id===lv); return PAD+(i<0?LEVELS.length-1:i)*LANE_H; };
const lvAtY=y=>{ const i=Math.max(0,Math.min(LEVELS.length-1,Math.floor((y-PAD)/LANE_H))); return LEVELS[i].id; };

/* devices in a lane, ordered by their px coordinate, laid out left to right */
function lanePositions(){
  const pos=new Map();
  for(const L of LEVELS){
    const inLane=proj.devices.filter(d=>levelOf(d)===L.id).sort((a,b)=>(a.px||0)-(b.px||0)||a.id.localeCompare(b.id));
    inLane.forEach((d,i)=>pos.set(d.id,{
      x: LABEL_W+GAP+i*(CARD_W+GAP)+CARD_W/2,
      y: laneY(L.id)+LANE_H/2
    }));
  }
  return pos;
}

const ICON={
  plc:'<rect x="-15" y="-9" width="30" height="18" rx="2" fill="#131a22" stroke="#4a7dab" stroke-width="1.3"/><circle cx="-10" cy="-5" r="1.6" fill="#5fd38d"/>',
  hmi:'<rect x="-14" y="-10" width="28" height="17" rx="2" fill="#131a22" stroke="#7fa89a" stroke-width="1.3"/><rect x="-5" y="7" width="10" height="3" fill="#7fa89a"/>',
  ews:'<rect x="-15" y="-10" width="30" height="18" rx="2" fill="#131a22" stroke="#9a8fc0" stroke-width="1.3"/><path d="M -6 -2 L -9 1 L -6 4 M 6 -2 L 9 1 L 6 4" stroke="#9a8fc0" stroke-width="1.2" fill="none"/>',
  historian:'<ellipse cx="0" cy="-7" rx="12" ry="4" fill="#131a22" stroke="#5fd38d" stroke-width="1.3"/><path d="M -12 -7 L -12 7 A 12 4 0 0 0 12 7 L 12 -7" fill="#131a22" stroke="#5fd38d" stroke-width="1.3"/>',
  server:'<rect x="-12" y="-11" width="24" height="22" rx="2" fill="#131a22" stroke="#5fd38d" stroke-width="1.3"/><line x1="-8" y1="-5" x2="8" y2="-5" stroke="#5fd38d"/><line x1="-8" y1="1" x2="8" y2="1" stroke="#5fd38d"/>',
  switch:'<rect x="-16" y="-8" width="32" height="16" rx="2" fill="#131a22" stroke="#6c7a85" stroke-width="1.3"/><path d="M -8 -3 L 8 -3 M 4 -6 L 8 -3 L 4 0 M 8 4 L -8 4 M -4 1 L -8 4 L -4 7" stroke="#6c7a85" stroke-width="1.1" fill="none"/>',
  firewall:'<rect x="-15" y="-10" width="30" height="20" rx="1.5" fill="#2a1a16" stroke="#e0864a" stroke-width="1.4"/><line x1="-15" y1="-3" x2="15" y2="-3" stroke="#e0864a" stroke-width=".9"/><line x1="-15" y1="4" x2="15" y2="4" stroke="#e0864a" stroke-width=".9"/><line x1="-5" y1="-10" x2="-5" y2="-3" stroke="#e0864a" stroke-width=".9"/><line x1="5" y1="-3" x2="5" y2="4" stroke="#e0864a" stroke-width=".9"/><line x1="-5" y1="4" x2="-5" y2="10" stroke="#e0864a" stroke-width=".9"/>',
};
const PROC_ICON='<rect x="-13" y="-9" width="26" height="18" rx="2" fill="#151a1e" stroke="#3d7a6b" stroke-width="1.2"/>';

function card(d,p){
  const cls='pcard'+(sel===d.id?' sel':'')+(isNetType(d.type)?' net':' proc');
  const sub=d.type==='plc' ? [d.vendor,d.model].filter(Boolean).join(' ') : d.type;
  return `<g class="${cls}" data-nid="${esc(d.id)}" transform="translate(${p.x},${p.y})">
    <rect class="hull" x="${-CARD_W/2}" y="${-CARD_H/2}" width="${CARD_W}" height="${CARD_H}" rx="5"/>
    <g transform="translate(0,-9)">${ICON[d.type]||PROC_ICON}</g>
    <text y="13" text-anchor="middle" font-size="10">${esc(d.name)}</text>
    <text y="23" text-anchor="middle" font-size="8" fill="#6c7a85">${esc(sub||'')}</text>
  </g>`;
}

function rebuild(){
  const svg=document.getElementById('qcanvas');
  if(!svg) return;
  const pos=lanePositions();
  let maxX=LABEL_W+GAP;
  pos.forEach(p=>{ if(p.x+CARD_W/2>maxX) maxX=p.x+CARD_W/2; });
  // the canvas is drawn at exactly its own coordinate size and the workbench
  // scrolls when the diagram is wider — 1:1 means pointer coordinates need no
  // aspect correction, which letterboxed scaling would otherwise silently add
  const host=svg.parentElement;
  const avail=Math.max((host?host.clientWidth:0)-2, 360);
  const W=Math.max(avail, maxX+GAP), H=PAD*2+LEVELS.length*LANE_H;
  svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio','none');
  svg.style.width=W+'px';
  svg.style.height=H+'px';

  let lanes='';
  for(const L of LEVELS){
    const y=laneY(L.id);
    lanes+=`<g class="lane${L.id===3.5?' dmz':''}">
      <rect x="${PAD}" y="${y}" width="${W-PAD*2}" height="${LANE_H-8}" rx="6"/>
      <text x="${PAD+14}" y="${y+24}" font-size="11.5">${esc(L.label)}</text>
      <text x="${PAD+14}" y="${y+40}" font-size="9.5" fill="#6c7a85">${esc(L.note)}</text>
    </g>`;
  }
  // conduits first so cards sit on top
  let links='';
  for(const c of proj.connections||[]){
    const a=pos.get(c.from), b=pos.get(c.to);
    if(!a||!b) continue;
    let d, ly;
    if(Math.abs(a.y-b.y)<1){
      // same lane: bow the conduit below the card row so it stays visible
      const dip=a.y+CARD_H/2+16;
      d=`M ${a.x} ${a.y+CARD_H/2} C ${a.x} ${dip}, ${b.x} ${dip}, ${b.x} ${b.y+CARD_H/2}`;
      ly=dip+8;
    } else {
      const mid=(a.y+b.y)/2;
      d=`M ${a.x} ${a.y} C ${a.x} ${mid}, ${b.x} ${mid}, ${b.x} ${b.y}`;
      ly=mid-3;
    }
    const cid=c.from+'|'+c.to;
    const blocked=net&&net.blockedBy(c);
    const cls='conduit'+(selConn===cid?' sel':'')+(blocked?' blocked':'');
    links+=`<path class="chit" data-cid="${esc(cid)}" d="${d}"/>`
      +`<path class="${cls}" data-cpath="${esc(cid)}" d="${d}"/>`
      +`<text class="clbl" x="${(a.x+b.x)/2}" y="${ly}" text-anchor="middle" font-size="8.5">${esc(c.proto)}</text>`;
  }
  let cards='';
  for(const d of proj.devices){ const p=pos.get(d.id); if(p) cards+=card(d,p); }
  svg.innerHTML=lanes+links+cards+'<g class="pkts"></g>';
  pathCache=new Map();      // the old path elements are gone with the old markup
  paintPackets();
  renderFindings();         // the review follows the diagram, not the frame rate
}

/* packets ride the conduit path itself, so they follow whatever curve the
   layout produced — recomputed per frame from the traffic model */
let pathCache=new Map();   // conduit key -> {el, len}, rebuilt with the diagram
function paintPackets(){
  const svg=document.getElementById('qcanvas');
  const layer=svg&&svg.querySelector('.pkts');
  if(!layer||!net) return;
  const list=net.packets();
  const dots=layer.childNodes;
  let n=0;
  for(const pk of list){
    let entry=pathCache.get(pk.key);
    if(entry===undefined){
      const el=svg.querySelector(`[data-cpath="${CSS.escape(pk.key)}"]`);
      entry=el?{el,len:el.getTotalLength()}:null;   // length is fixed until the next rebuild
      pathCache.set(pk.key,entry);
    }
    if(!entry) continue;
    let pt;
    try{ pt=entry.el.getPointAtLength(entry.len*Math.max(0,Math.min(1,pk.t))); }
    catch(e){ continue; }
    // reuse the circles: rebuilding the layer every frame thrashes the DOM
    let c=dots[n];
    if(!c){
      c=document.createElementNS('http://www.w3.org/2000/svg','circle');
      layer.appendChild(c);
    }
    const cls='pkt '+(pk.dropped?'drop':pk.kind);
    if(c.getAttribute('class')!==cls) c.setAttribute('class',cls);
    c.setAttribute('cx',pt.x.toFixed(1));
    c.setAttribute('cy',pt.y.toFixed(1));
    const r=pk.kind==='rep'?'3.4':'3';
    if(c.getAttribute('r')!==r) c.setAttribute('r',r);
    n++;
  }
  while(dots.length>n) layer.removeChild(layer.lastChild);
}

const connByKey=k=>(proj.connections||[]).find(c=>c.from+'|'+c.to===k);

function renderInspector(){
  const el=document.getElementById('qinspect');
  if(!el) return;
  if(selConn){ renderConduitInspector(el); return; }
  const d=sel?byId(sel):null;
  if(!d){ el.innerHTML='click a device to place it in a level, or a conduit to configure its traffic'; return; }
  const lvOpts=LEVELS.map(L=>`<option value="${L.id}"${levelOf(d)===L.id?' selected':''}>${esc(L.label)}</option>`).join('');
  const others=proj.devices.filter(x=>x.id!==d.id);
  const linked=new Set((proj.connections||[]).filter(c=>c.from===d.id||c.to===d.id)
    .map(c=>c.from===d.id?c.to:c.from));
  const linkRows=[...linked].map(id=>{
    const o=byId(id); if(!o) return '';
    const c=(proj.connections||[]).find(x=>(x.from===d.id&&x.to===id)||(x.to===d.id&&x.from===id));
    const protoOpts=PROTOCOLS.map(p=>`<option${c.proto===p?' selected':''}>${esc(p)}</option>`).join('');
    return `<div class="irow"><label>↔ ${esc(o.name)}</label>
      <select data-qproto="${esc(id)}">${protoOpts}</select>
      <button class="fbtn" data-qunlink="${esc(id)}" title="remove this link">×</button></div>`;
  }).join('');
  const addOpts=['<option value="">— link to…</option>',
    ...others.filter(o=>!linked.has(o.id)).map(o=>`<option value="${esc(o.id)}">${esc(o.name)}</option>`)].join('');
  el.innerHTML=`
    <div class="irow"><label>device</label><b>${esc(d.name)}</b></div>
    <div class="irow"><label>level</label><select data-qlevel>${lvOpts}</select></div>
    ${linkRows}
    <div class="irow"><label>link</label><select data-qlink>${addOpts}</select></div>
    ${d.type==='firewall'?fwPolicyRows(d):''}
    ${d.type==='plc'?`<div class="irow"><button class="fbtn" data-qopen="${esc(d.id)}">open logic</button></div>`:''}`;
}

/* a firewall's rule set: which protocols it lets across */
function fwPolicyRows(d){
  const allow=Array.isArray(d.allow)?d.allow:DMZ_SAFE;
  return `<div class="irow"><label>permits</label></div>`
    +PROTOCOLS.map(p=>`<div class="irow fwrule"><label></label>
      <label class="tog"><input type="checkbox" data-qallow="${esc(p)}"${allow.includes(p)?' checked':''}>${esc(p)}</label>
      </div>`).join('');
}

function renderConduitInspector(el){
  const c=connByKey(selConn);
  if(!c){ selConn=null; renderInspector(); return; }
  const a=byId(c.from), b=byId(c.to);
  const protoOpts=PROTOCOLS.map(p=>`<option${c.proto===p?' selected':''}>${esc(p)}</option>`).join('');
  const st=net?net.stats().get(selConn):null;
  const polls=net?net.pollDirection(c):null;
  const fw=net?net.blockedBy(c):null;
  el.innerHTML=`
    <div class="irow"><label>conduit</label><b>${esc(a?a.name:c.from)} ↔ ${esc(b?b.name:c.to)}</b></div>
    <div class="irow"><label>protocol</label><select data-qcproto>${protoOpts}</select></div>
    <div class="irow"><label>polls/s</label><input data-qcrate type="number" min="0" max="20" step="0.5"
      value="${Number.isFinite(c.rate)?c.rate:1}"></div>
    <div class="irow"><label>reads tag</label><input data-qctag value="${esc(c.tag||'')}" placeholder="a controller tag"></div>
    <div class="irow"><label>traffic</label><span class="out" data-qcsent>${
      polls ? (st?`${st.sent} sent${st.dropped?', '+st.dropped+' dropped':''}`:'starting…')
            : 'idle — no client on this conduit'}</span></div>
    ${polls?`<div class="irow"><label>last</label><span class="out" data-qclast>${esc(st&&st.last?st.last:'—')}</span></div>`:''}
    ${fw?`<div class="irow"><span class="warnnote">${esc(fw.name)} denies ${esc(c.proto)} — packets stop there</span></div>`:''}
    <div class="irow"><button class="fbtn" data-qcdel>remove this conduit</button></div>`;
}

function paint(){
  const svg=document.getElementById('qcanvas');
  if(!svg||!svg.childNodes.length) return;
  for(const d of proj.devices){
    const g=svg.querySelector(`[data-nid="${d.id}"]`);
    if(g) g.classList.toggle('sel',sel===d.id);
  }
}

/* ---- interaction ---- */
const svgEl=document.getElementById('qcanvas');
function svgPoint(e){
  const r=svgEl.getBoundingClientRect(), vb=svgEl.viewBox.baseVal;
  const sx=vb&&vb.width?vb.width/r.width:1, sy=vb&&vb.height?vb.height/r.height:1;
  return {x:(e.clientX-r.left)*sx, y:(e.clientY-r.top)*sy};
}
if(svgEl){
  svgEl.addEventListener('pointerdown',e=>{
    const g=e.target.closest('.pcard');
    if(!g){
      // a click on a conduit inspects it; a click on empty canvas clears
      const hit=e.target.closest('[data-cid]');
      selConn=hit?hit.dataset.cid:null;
      if(selConn) sel=null;
      rebuild(); renderInspector();
      return;
    }
    selConn=null;
    sel=g.dataset.nid;
    drag={id:sel,moved:false,pid:e.pointerId};
    // capture on the canvas, not the card: rebuild() replaces the card element
    // mid-drag, and a capture held by a removed node stops delivering events
    try{ svgEl.setPointerCapture(e.pointerId); }catch(err){}
    rebuild(); renderInspector();
  });
  svgEl.addEventListener('pointermove',e=>{
    if(!drag) return;
    const d=byId(drag.id); if(!d) return;
    const pt=svgPoint(e);
    const lv=lvAtY(pt.y);
    const px=pt.x;
    if(levelOf(d)!==lv||Math.abs((d.px||0)-px)>8){
      setLevel(d,lv); d.px=px; drag.moved=true;
      rebuild(); renderInspector();
    }
  });
  const endDrag=()=>{
    if(!drag) return;
    if(drag.moved){ hooks.project.save(); hooks.onChange(); }
    try{ svgEl.releasePointerCapture(drag.pid); }catch(err){}
    drag=null;
  };
  svgEl.addEventListener('pointerup',endDrag);
  svgEl.addEventListener('pointercancel',endDrag);
  window.addEventListener('pointerup',endDrag);   // release outside the canvas still ends it
  svgEl.addEventListener('dblclick',e=>{
    const g=e.target.closest('.pcard'); if(!g) return;
    const d=byId(g.dataset.nid);
    if(d&&d.type==='plc') hooks.onOpenLogic(d.id);
  });
}

const inspEl=document.getElementById('qinspect');
if(inspEl){
  inspEl.addEventListener('change',e=>{
    if(selConn){
      const c=connByKey(selConn); if(!c) return;
      if(e.target.hasAttribute('data-qcproto')) c.proto=e.target.value;
      else if(e.target.hasAttribute('data-qcrate')){
        const v=parseFloat(e.target.value);
        c.rate = Number.isFinite(v)&&v>0 ? Math.min(v,20) : 1;
      }
      else if(e.target.hasAttribute('data-qctag')){
        const v=e.target.value.trim();
        if(v&&!/^[A-Za-z_]\w*$/.test(v)){ renderInspector(); return; }
        c.tag = v||undefined;
      }
      else return;
      hooks.project.save(); rebuild(); renderInspector(); hooks.onChange();
      return;
    }
    const d=sel?byId(sel):null; if(!d) return;
    if(e.target.dataset.qallow!==undefined){
      const p=e.target.dataset.qallow;
      const allow=new Set(Array.isArray(d.allow)?d.allow:DMZ_SAFE);
      if(e.target.checked) allow.add(p); else allow.delete(p);
      d.allow=[...allow];
      hooks.project.save(); rebuild(); renderInspector(); hooks.onChange();
      return;
    }
    if(e.target.hasAttribute('data-qlevel')){
      setLevel(d,Number(e.target.value));
    } else if(e.target.hasAttribute('data-qlink')){
      const other=e.target.value;
      if(other&&byId(other)){
        proj.connections=proj.connections||[];
        proj.connections.push({from:d.id,to:other,proto:'Ethernet'});
      }
    } else if(e.target.dataset.qproto){
      const id=e.target.dataset.qproto;
      const c=(proj.connections||[]).find(x=>(x.from===d.id&&x.to===id)||(x.to===d.id&&x.from===id));
      if(c) c.proto=e.target.value;
    } else return;
    hooks.project.save(); rebuild(); renderInspector(); hooks.onChange();
  });
  inspEl.addEventListener('click',e=>{
    const open=e.target.dataset.qopen;
    if(open){ hooks.onOpenLogic(open); return; }
    if(e.target.hasAttribute('data-qcdel')&&selConn){
      proj.connections=(proj.connections||[]).filter(c=>c.from+'|'+c.to!==selConn);
      selConn=null;
      hooks.project.save(); rebuild(); renderInspector(); hooks.onChange();
      return;
    }
    const un=e.target.dataset.qunlink;
    if(un&&sel){
      proj.connections=(proj.connections||[]).filter(c=>
        !((c.from===sel&&c.to===un)||(c.to===sel&&c.from===un)));
      hooks.project.save(); rebuild(); renderInspector(); hooks.onChange();
    }
  });
}

/* palette: network devices only — process equipment is drawn on the P&ID */
document.querySelectorAll('[data-qadd]').forEach(b=>b.addEventListener('click',()=>{
  const t=b.dataset.qadd;
  const base={hmi:'HMI',ews:'EWS',historian:'HIST',switch:'SW',firewall:'FW',server:'SRV'}[t];
  let n=1; while(proj.devices.some(d=>d.id===base+'-'+n)) n++;
  const d={id:base+'-'+n,type:t,name:base+'-'+n,x:120,y:120,
    purdueLevel:defaultLevel(t), px:9999};   // lands at the right end of its lane
  proj.devices.push(d); sel=d.id;
  hooks.project.save(); rebuild(); renderInspector(); hooks.onChange();
}));
const delBtn=document.getElementById('qdel');
if(delBtn) delBtn.addEventListener('click',()=>{
  if(!sel) return;
  const d=byId(sel);
  if(!d||!isNetType(d.type)) return;   // process devices are deleted on the P&ID
  proj.devices=proj.devices.filter(x=>x.id!==sel);
  proj.connections=(proj.connections||[]).filter(c=>c.from!==sel&&c.to!==sel);
  sel=null;
  hooks.project.save(); rebuild(); renderInspector(); hooks.onChange();
});

let rszTimer=null;
window.addEventListener('resize',()=>{
  clearTimeout(rszTimer);
  rszTimer=setTimeout(()=>{
    const wrap=document.getElementById('purduewrap');
    if(wrap&&!wrap.hidden) rebuild();
  },150);
});

/* the segmentation review, refreshed with the diagram */
function renderFindings(){
  const el=document.getElementById('qwarn');
  if(!el||!net) return;
  const w=net.findings();
  const html=w.length?'<div class="warnbox">'+w.map(x=>'&middot; '+x).join('<br>')+'</div>':'';
  if(el.dataset.sig!==html){ el.innerHTML=html; el.dataset.sig=html; }
}

/* one animation loop for the whole view: packets move continuously while the
   scan runs, independent of the 100 ms tick that generates them */
let raf=null;
function frame(){
  raf=null;
  const wrap=document.getElementById('purduewrap');
  if(wrap&&!wrap.hidden){ paintPackets(); refreshConduitStats(); }
  start();
}
/* the conduit inspector's counters are live numbers — update the two spans in
   place rather than re-rendering the panel under the user's cursor */
function refreshConduitStats(){
  if(!selConn||!net) return;
  const st=net.stats().get(selConn);
  const sent=document.querySelector('[data-qcsent]');
  const last=document.querySelector('[data-qclast]');
  if(sent&&st){
    const t=`${st.sent} sent${st.dropped?', '+st.dropped+' dropped':''}`;
    if(sent.textContent!==t) sent.textContent=t;
  }
  if(last&&st&&last.textContent!==st.last) last.textContent=st.last;
}
function start(){
  if(raf!==null) return;
  const wrap=document.getElementById('purduewrap');
  if(!wrap||wrap.hidden) return;      // hidden views cost nothing
  raf=requestAnimationFrame(frame);
}
function stop(){ if(raf!==null){ cancelAnimationFrame(raf); raf=null; } }

return {rebuild, paint, inspector:renderInspector, findings:renderFindings,
  animate:start, stopAnimating:stop,
  select(id){ sel=id; selConn=null; rebuild(); renderInspector(); }};
}
