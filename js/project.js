/* Required Notice: Copyright (c) 2026 Joshua Ott — LadderLens (https://ladderlens.com)
   PolyForm Noncommercial 1.0.0 — commercial use requires a separate license. */

/* ---------- the project ----------
   One model, many projections: every device in the workspace lives in
   project.data.devices — process equipment today, controllers, network gear
   and Purdue placement as the workspace grows. The .llp file is this object,
   pretty-printed: versioned, readable JSON that survives format growth
   through the version field (unknown fields are preserved on load). */

export const PROJECT_FORMAT='ladderlens-project';
export const PROJECT_VERSION=1;
const STORE='ladderlens.project.v1';
const OLD_PLANT_STORE='ladderlens.plant.v1';   // pre-project releases stored the plant alone

const TYPES=['tank','valve','pump','lt','ft','ls','supply','drain','plc'];

/* localStorage and .llp files both arrive from outside the program —
   malformed entries must never brick boot or import. Ids are restricted to
   the charset the UI itself generates: they are interpolated into CSS
   selectors and data- attributes, so anything else is rejected outright. */
function sanitizeInputs(obj){
  const out={};
  if(obj&&typeof obj==='object'&&!Array.isArray(obj))
    for(const k of Object.keys(obj)){
      const v=obj[k];
      if(typeof v==='boolean') out[k]=v;
      else{ const n=Number(v); if(Number.isFinite(n)) out[k]=n; }
    }
  return out;
}
function validDevices(list){
  if(!Array.isArray(list)) return [];
  const seen=new Set();
  return list.filter(d=>{
    if(!d||typeof d!=='object'||typeof d.id!=='string'||!TYPES.includes(d.type)||seen.has(d.id)) return false;
    if(!/^[A-Za-z0-9_-]+$/.test(d.id)) return false;
    if(d.type==='plc'&&d.id==='sandbox') d.id='PLC-sandbox';   // 'sandbox' names the free-standing slot
    if(seen.has(d.id)) return false;
    seen.add(d.id);
    d.name=typeof d.name==='string'?d.name:d.id;
    d.x=Number(d.x); if(!Number.isFinite(d.x)) d.x=100;
    d.y=Number(d.y); if(!Number.isFinite(d.y)) d.y=100;
    for(const f of ['level','level0','maxFlow','posConst','sp'])
      if(d[f]!==undefined){ d[f]=Number(d[f]); if(!Number.isFinite(d[f])) d[f]=0; }
    for(const f of ['from','to','tank','dev','posTag','runTag','speedTag','pvTag','flowTag','outTag'])
      if(d[f]!==undefined&&typeof d[f]!=='string') delete d[f];
    if(d.type==='plc'){
      d.program=typeof d.program==='string'?d.program:'';
      d.inputs=sanitizeInputs(d.inputs);
      if(d.vendor!==undefined&&typeof d.vendor!=='string') delete d.vendor;
      if(d.model!==undefined&&typeof d.model!=='string') delete d.model;
    }
    if(d.type==='ls') d.mode = d.mode==='low' ? 'low' : 'high';
    return true;
  });
}

function blank(){
  return {format:PROJECT_FORMAT, version:PROJECT_VERSION, meta:{name:'untitled plant'},
    devices:[], sandbox:{program:'',inputs:{}}};
}

/* accept any object shaped like a project, current or older version —
   unknown extra fields ride along untouched so newer files degrade gently */
function normalize(p){
  if(!p||typeof p!=='object') return null;
  if(p.format!==PROJECT_FORMAT) return null;
  if(!isFinite(p.version)||p.version<1) return null;
  p.version=PROJECT_VERSION;          // migrations for future versions land here
  p.meta=(p.meta&&typeof p.meta==='object')?p.meta:{};
  if(typeof p.meta.name!=='string') p.meta.name='untitled plant';
  p.devices=validDevices(p.devices);
  if(!p.sandbox||typeof p.sandbox!=='object') p.sandbox={program:'',inputs:{}};
  p.sandbox.program=typeof p.sandbox.program==='string'?p.sandbox.program:'';
  p.sandbox.inputs=sanitizeInputs(p.sandbox.inputs);
  return p;
}

export function createProject(){
  const data=blank();

  function adopt(p){ Object.keys(data).forEach(k=>delete data[k]); Object.assign(data,p); }

  function load(){
    try{
      const s=localStorage.getItem(STORE);
      if(s){ const p=normalize(JSON.parse(s)); if(p){ adopt(p); return true; } }
    }catch(e){}
    try{   // migrate a plant saved by a pre-project release
      const s=localStorage.getItem(OLD_PLANT_STORE);
      if(s){
        const old=JSON.parse(s);
        if(old&&Array.isArray(old.devices)){
          const p=blank(); p.devices=validDevices(old.devices);
          adopt(p); save();
          return true;
        }
      }
    }catch(e){}
    return false;
  }

  function save(){
    data.meta.modified=new Date().toISOString();
    try{ localStorage.setItem(STORE,JSON.stringify(data)); }catch(e){}
  }

  /* the exported file IS the project object — devices (controllers carry
     their programs) plus the free-standing sandbox program */
  function toLLP(){
    const out=JSON.parse(JSON.stringify(data));
    out.meta.modified=new Date().toISOString();
    return JSON.stringify(out,null,2);
  }

  function fromLLP(text){
    let p;
    try{ p=JSON.parse(text); }
    catch(e){ throw new Error('not a valid .llp file (bad JSON): '+e.message); }
    p=normalize(p);
    if(!p) throw new Error('not a LadderLens project file (missing "format": "'+PROJECT_FORMAT+'")');
    adopt(p);
    save();
  }

  return {data, load, save, toLLP, fromLLP};
}
