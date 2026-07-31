/* Required Notice: Copyright (c) 2026 Joshua Ott — LadderLens (https://ladderlens.com)
   PolyForm Noncommercial 1.0.0 — commercial use requires a separate license. */

import {esc} from './engine.js';
import {LEVELS,defaultLevel,isNetType} from './project.js';

/* ---------- the protocol layer ----------
   Conduits carry traffic the way pipes carry flow. A client (HMI, historian,
   engineering workstation, server) polls a controller at its conduit's rate;
   the request travels, the controller answers with a live tag value, and the
   reply travels back. A firewall on the path drops what its policy denies.

   This is a teaching model, not a protocol stack: no framing, no timing
   fidelity, no retries. What it shows honestly is who talks to whom, how
   often, over what protocol, carrying which value — and where a packet
   crosses a boundary it should not. */

/* which end of a conduit initiates: clients poll, controllers answer */
const CLIENT_TYPES=['hmi','ews','historian','server'];
const isClient=t=>CLIENT_TYPES.includes(t);

/* protocols an industrial firewall would normally let into the DMZ. The rest
   are control-plane protocols that have no business crossing it. */
export const DMZ_SAFE=['OPC UA','Ethernet'];
const DEFAULT_RATE=1;      // polls per second
const SPEED=1.6;           // conduit lengths per second
const MAX_PACKETS=240;     // a hard ceiling: a silly rate must not melt the tab

export function createNet(hooksIn={}){
const hooks=Object.assign({project:null, env:()=>({}), activeId:()=>null},hooksIn);
const proj=hooks.project.data;

let packets=[];        // {key, t (0..1), dir, kind, proto, label, dropped}
const timers=new Map();// conduit key -> seconds until the next poll
let stats=new Map();   // conduit key -> {sent, dropped, last}

const key=c=>c.from+'|'+c.to;
const byId=id=>proj.devices.find(d=>d.id===id);
const levelOf=d=>d&&LEVELS.some(L=>L.id===d.purdueLevel)?d.purdueLevel:(d?defaultLevel(d.type):0);

/* a conduit polls when a client sits on one end and a controller on the other;
   client -> switch -> controller is two conduits, each carrying its own hop */
function pollDirection(c){
  const a=byId(c.from), b=byId(c.to);
  if(!a||!b) return null;
  if(isClient(a.type)&&!isClient(b.type)) return {src:a,dst:b,dir:1};
  if(isClient(b.type)&&!isClient(a.type)) return {src:b,dst:a,dir:-1};
  if(a.type==='switch'&&b.type==='plc') return {src:a,dst:b,dir:1};
  if(b.type==='switch'&&a.type==='plc') return {src:b,dst:a,dir:-1};
  if(a.type==='switch'&&b.type==='firewall') return {src:a,dst:b,dir:1};
  if(b.type==='switch'&&a.type==='firewall') return {src:b,dst:a,dir:-1};
  return null;
}

/* a firewall on either end of the conduit inspects what crosses it */
function blockedBy(c){
  for(const id of [c.from,c.to]){
    const d=byId(id);
    if(d&&d.type==='firewall'){
      const allow=Array.isArray(d.allow)?d.allow:DMZ_SAFE;
      if(!allow.includes(c.proto)) return d;
    }
  }
  return null;
}

const show=v=>typeof v==='boolean' ? (v?'TRUE':'FALSE')
  : (Number.isFinite(+v) ? (+v).toFixed(1) : String(v));

/* The value a reply carries. Only one controller's program is executing at a
   time — the one open in the Logic view — so a conduit that terminates at a
   different controller has no live values to report and must say so rather
   than quote another device's numbers. */
function readValue(c,dst){
  if(!dst||dst.type!=='plc') return c.tag||'traffic';   // a hop, not an endpoint read
  if(hooks.activeId()!==dst.id)
    return (c.tag||'read')+' · open '+dst.name+' to see live values';
  const env=hooks.env()||{};
  if(c.tag)
    return Object.prototype.hasOwnProperty.call(env,c.tag)
      ? c.tag+'='+show(env[c.tag])
      : c.tag+' — not a tag in this program';
  const first=Object.keys(env)[0];
  return first===undefined ? 'read' : first+'='+show(env[first]);
}

function tick(dt){
  const secs=Math.min(Math.max(dt,0),1000)/1000;
  const live=new Set();
  for(const c of proj.connections||[]){
    const k=key(c); live.add(k);
    const pd=pollDirection(c);
    if(!pd){ timers.delete(k); continue; }
    const rate=Number.isFinite(c.rate)&&c.rate>0?Math.min(c.rate,20):DEFAULT_RATE;
    let due=(timers.get(k)!==undefined?timers.get(k):0)-secs;
    let guard=0;
    while(due<=0&&guard++<4){
      due+=1/rate;
      if(packets.length<MAX_PACKETS){
        const fw=blockedBy(c);
        const st=stats.get(k)||{sent:0,dropped:0,last:''};
        st.sent++;
        if(fw){ st.dropped++; st.last='blocked by '+fw.name; }
        stats.set(k,st);
        packets.push({key:k, t:pd.dir>0?0:1, dir:pd.dir, kind:'req',
          proto:c.proto, label:c.proto, dropped:!!fw});
      }
    }
    timers.set(k,due);
  }
  for(const k of [...timers.keys()]) if(!live.has(k)) timers.delete(k);
  for(const k of [...stats.keys()]) if(!live.has(k)) stats.delete(k);

  const next=[];
  for(const p of packets){
    p.t+=p.dir*SPEED*secs;
    // a dropped packet dies at the firewall end instead of arriving
    if(p.dropped&&((p.dir>0&&p.t>=0.86)||(p.dir<0&&p.t<=0.14))) continue;
    if(p.t>=1||p.t<=0){
      if(p.kind==='req'){
        const c=(proj.connections||[]).find(x=>key(x)===p.key);
        // next[] IS the surviving population — counting packets[] too would
        // double-count and silently halve the real ceiling
        if(c&&next.length<MAX_PACKETS){
          const pd=pollDirection(c);
          const st=stats.get(p.key)||{sent:0,dropped:0,last:''};
          st.last=readValue(c,pd&&pd.dst); stats.set(p.key,st);
          next.push({key:p.key, t:p.dir>0?1:0, dir:-p.dir, kind:'rep',
            proto:p.proto, label:st.last, dropped:false});
        }
      }
      continue;      // replies simply arrive
    }
    next.push(p);
  }
  packets=next;
}

function reset(){ packets=[]; timers.clear(); stats=new Map(); }

/* ---- network segmentation review ----
   The Purdue model earns its keep as a boundary diagram: traffic that skips
   levels, or carries a control protocol across the DMZ, is the finding an
   assessor writes up. Name it here rather than draw it and stay silent. */
function findings(){
  const out=[];
  // a rule set is worth reviewing whether or not anything is using it today
  for(const d of proj.devices||[]){
    if(d.type!=='firewall') continue;
    const allow=Array.isArray(d.allow)?d.allow:DMZ_SAFE;
    const control=allow.filter(p=>!DMZ_SAFE.includes(p));
    if(control.length)
      out.push(`<b>${esc(d.name)}</b> permits ${control.map(p=>'<b>'+esc(p)+'</b>').join(', ')} across it. `
        +`Control protocols were never designed to be exposed — the DMZ exists so they stop here.`);
  }
  for(const c of proj.connections||[]){
    const a=byId(c.from), b=byId(c.to);
    if(!a||!b) continue;
    const la=levelOf(a), lb=levelOf(b);
    const gap=Math.abs(la-lb);
    const crossesDMZ=(la<3.5&&lb>3.5)||(lb<3.5&&la>3.5);
    const viaFirewall=a.type==='firewall'||b.type==='firewall';
    const pair=`<b>${esc(a.name)} ↔ ${esc(b.name)}</b>`;
    if(crossesDMZ&&!viaFirewall)
      out.push(`${pair} carries OT traffic straight past the DMZ. `
        +`Enterprise systems should reach plant data through a broker in the DMZ, not through the plant.`);
    else if(gap>1&&!viaFirewall)
      out.push(`${pair} skips ${gap>2?'levels':'a level'} `
        +`(${esc(levelName(la))} to ${esc(levelName(lb))}) with nothing in between to control it.`);
    if(viaFirewall){
      const fw=a.type==='firewall'?a:b;
      const allow=Array.isArray(fw.allow)?fw.allow:DMZ_SAFE;
      // only claim a link is USING the rule when it actually carries traffic
      // the firewall lets through — otherwise the policy finding above stands alone
      if(!DMZ_SAFE.includes(c.proto)&&allow.includes(c.proto)&&pollDirection(c)&&!blockedBy(c))
        out.push(`${pair} actually carries <b>${esc(c.proto)}</b> through `
          +`<b>${esc(fw.name)}</b> — the rule above is not theoretical, this link is using it.`);
    }
  }
  return out;
}
function levelName(lv){ const L=LEVELS.find(x=>x.id===lv); return L?L.label:('level '+lv); }

return {tick, reset, findings,
  packets:()=>packets,
  stats:()=>stats,
  isClient, pollDirection, blockedBy};
}
