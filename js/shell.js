/* Required Notice: Copyright (c) 2026 Joshua Ott — LadderLens (https://ladderlens.com)
   PolyForm Noncommercial 1.0.0 — commercial use requires a separate license. */

import {createLogicPanel, SCAN_MS} from './ladder.js';
import {createPlant} from './plant.js';
import {createProject} from './project.js';
import {EX, EX_DEFAULTS} from './examples.js';

/* ---------- the workspace shell ----------
   One plant + one logic panel, wired through explicit hooks. The shell owns
   the master scan clock, the header controls and the view switch; the panel
   owns its program and scan state; the plant owns its devices. */

let panel=null;
const project=createProject();
const plant=createPlant({
  project,
  env:()=>panel?panel.env():{},
  onChange:()=>{ if(panel) panel.run(true); },
  onLoadPair:()=>{                 // "level control plant" pairs with the ex1 logic
    const v=Object.assign({},EX_DEFAULTS.ex1);
    delete v.rLevel_PV;            // the transmitter drives PV now
    panel.coldStart(EX.ex1,v);
    plant.paint();
  }
});
panel=createLogicPanel(document.getElementById('readwrap'),{
  sensorTags:()=>plant.sensorTagSet(),
  actuatorTags:()=>plant.actuatorTags(),
  publishSensors:()=>plant.publishSensors(),
  plantScan:dt=>plant.tick(dt),
  plantPaint:()=>plant.paint(),
  plantReset:()=>{ plant.reset(); plant.publishSensors(); },
  onStatus:renderHeader
});

/* ---- header: run state + controls ---- */
const dotEl=document.getElementById('dot'), msgEl=document.getElementById('scanmsg');
const runBtn=document.getElementById('runbtn');
function renderHeader(s){
  runBtn.textContent = s.running?'stop':'run';
  dotEl.classList.toggle('stop', !s.running||s.faulted||s.stale);
  msgEl.textContent = s.msg;
}
runBtn.addEventListener('click',()=>panel.toggleRun());
document.getElementById('stepbtn').addEventListener('click',()=>panel.step());
document.getElementById('resetbtn').addEventListener('click',()=>panel.reset());

/* the scan genuinely pauses while the tab is hidden (browsers throttle hidden
   timers anyway); on return, the gap is not counted into dt */
setInterval(()=>{ if(panel.isRunning()&&!document.hidden) panel.scanTick(); }, SCAN_MS);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) panel.clockReset(); });

/* a file released anywhere else must not navigate the page away */
document.addEventListener('dragover',e=>{ if([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
document.addEventListener('drop',e=>{ if([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });

/* ---- project files: the whole workspace travels as one .llp ---- */
const projfile=document.getElementById('projfile');
document.getElementById('openproj').addEventListener('click',()=>projfile.click());
projfile.addEventListener('change',()=>{
  const f=projfile.files[0]; projfile.value='';
  if(!f) return;
  f.text().then(t=>{
    let r;
    try{ r=project.fromLLP(t); }
    catch(e){ alert(e.message); return; }
    plant.rebuild(); plant.inspector();
    if(r.program!=null) panel.coldStart(r.program, r.inputs);
    else panel.run(true);
    plant.paint();
  });
});
document.getElementById('exportproj').addEventListener('click',()=>{
  const text=project.toLLP(panel.source(), panel.values());
  const name=(project.data.meta.name||'project').replace(/[^\w-]+/g,'-')+'.llp';
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));
  a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
});

/* ---- view switch ---- */
document.querySelectorAll('.mode').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.mode').forEach(x=>x.classList.toggle('on',x===btn));
  const pv=btn.dataset.view==='plant';
  document.getElementById('readwrap').hidden=pv;
  document.getElementById('plantwrap').hidden=!pv;
  if(pv){ plant.rebuild(); plant.paint(); plant.inspector(); }
}));

/* ---- boot ---- */
if(!project.load()) plant.example();
plant.rebuild(); plant.inspector();
panel.coldStart(EX.ex1, EX_DEFAULTS.ex1);
