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

const TYPES=['tank','valve','pump','lt','supply','drain','plc'];

/* localStorage and .llp files both arrive from outside the program —
   malformed entries must never brick boot or import */
function validDevices(list){
  if(!Array.isArray(list)) return [];
  const seen=new Set();
  return list.filter(d=>{
    if(!d||typeof d!=='object'||typeof d.id!=='string'||!TYPES.includes(d.type)||seen.has(d.id)) return false;
    seen.add(d.id);
    d.name=typeof d.name==='string'?d.name:d.id;
    d.x=isFinite(d.x)?d.x:100; d.y=isFinite(d.y)?d.y:100;
    for(const f of ['level','level0','maxFlow','posConst']) if(d[f]!==undefined&&!isFinite(d[f])) d[f]=0;
    if(d.type==='plc'){
      d.program=typeof d.program==='string'?d.program:'';
      d.inputs=(d.inputs&&typeof d.inputs==='object'&&!Array.isArray(d.inputs))?d.inputs:{};
    }
    return true;
  });
}

function blank(){
  return {format:PROJECT_FORMAT, version:PROJECT_VERSION, meta:{name:'untitled plant'}, devices:[]};
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

  /* the exported file IS the project object; the caller passes the sandbox
     program + input values, which travel as a controller device until the
     workspace grows real ones */
  function toLLP(program,inputs){
    const out=JSON.parse(JSON.stringify(data));
    if(!out.devices.some(d=>d.type==='plc'))
      out.devices.push({id:'PLC-1',type:'plc',name:'PLC-1',x:40,y:40});
    const plc=out.devices.find(d=>d.type==='plc');
    plc.program=String(program||'');
    plc.inputs=inputs||{};
    out.meta.modified=new Date().toISOString();
    return JSON.stringify(out,null,2);
  }

  function fromLLP(text){
    let p;
    try{ p=JSON.parse(text); }
    catch(e){ throw new Error('not a valid .llp file (bad JSON): '+e.message); }
    p=normalize(p);
    if(!p) throw new Error('not a LadderLens project file (missing "format": "'+PROJECT_FORMAT+'")');
    const plc=p.devices.find(d=>d.type==='plc');
    adopt(p);
    save();
    return {program:plc?plc.program:null, inputs:plc?plc.inputs:{}, name:data.meta.name};
  }

  return {data, load, save, toLLP, fromLLP};
}
