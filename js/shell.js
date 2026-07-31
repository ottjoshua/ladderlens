/* Required Notice: Copyright (c) 2026 Joshua Ott — LadderLens (https://ladderlens.com)
   PolyForm Noncommercial 1.0.0 — commercial use requires a separate license. */

import {esc} from './engine.js';
import {createLogicPanel, SCAN_MS} from './ladder.js';
import {createPlant} from './plant.js';
import {createProject} from './project.js';
import {EX, EX_DEFAULTS} from './examples.js';

/* ---------- the workspace shell ----------
   P&ID is home: every device lives in the project, controllers among them.
   The logic panel edits one program at a time — a controller's, or the
   free-standing sandbox — and the shell swaps the panel between targets.
   The shell also owns the master scan clock, the header and the views. */

let panel=null;
let activeTarget='sandbox';
let booted=false;               // guards value-stashing before the first program loads
const project=createProject();

/* a target = whatever owns a program: the sandbox slot or a controller device */
const store=id=> id==='sandbox'
  ? project.data.sandbox
  : project.data.devices.find(d=>d.id===id&&d.type==='plc');

const plant=createPlant({
  project,
  env:()=>panel?panel.env():{},
  onChange:()=>{
    if(!panel) return;
    if(!store(activeTarget)) activate('sandbox');   // the active controller was deleted
    else panel.run(true);
    renderTargets();
  },
  onLoadPair:()=>{               // "level control plant" pairs with the ex1 logic
    const v=Object.assign({},EX_DEFAULTS.ex1);
    delete v.rLevel_PV;          // the transmitter drives PV now
    const plc=store('PLC-1');
    if(plc){ plc.program=EX.ex1; plc.inputs=v; project.save(); activate('PLC-1'); }
    else{ project.data.sandbox={program:EX.ex1,inputs:v}; activate('sandbox'); }
    plant.paint();
  },
  onOpenLogic:id=>{ activate(id); setView('logic'); }
});
panel=createLogicPanel(document.getElementById('readwrap'),{
  sensorTags:()=>plant.sensorTagSet(),
  actuatorTags:()=>plant.actuatorTags(),
  publishSensors:()=>plant.publishSensors(),
  plantScan:dt=>plant.tick(dt),
  plantPaint:()=>plant.paint(),
  plantReset:()=>{ plant.reset(); plant.publishSensors(); },
  onStatus:renderHeader,
  onSourceChange:text=>{         // every edit lands in the project (debounced save)
    const t=store(activeTarget); if(!t) return;
    t.program=text;
    clearTimeout(saveTimer); saveTimer=setTimeout(()=>project.save(),400);
  }
});
let saveTimer=null;

/* switch the panel to another program owner; the outgoing target keeps its
   latest input values. Switching is a cold start — a controller you open
   boots like a controller powering up. */
function activate(id){
  if(!store(id)) id='sandbox';
  // stash the outgoing target's input values — but only when actually leaving
  // it; re-activating the current target is a plain reload from its store
  if(booted&&id!==activeTarget&&store(activeTarget)) store(activeTarget).inputs=panel.values();
  activeTarget=id;
  const t=store(id);
  panel.coldStart(t.program||'', t.inputs||{});
  booted=true;
  project.save();
  renderTargets();
}

const targetsEl=document.querySelector('[data-el="targets"]');
function renderTargets(){
  const plcs=project.data.devices.filter(d=>d.type==='plc');
  targetsEl.innerHTML=
    `<button class="tchip${activeTarget==='sandbox'?' on':''}" data-t="sandbox">sandbox</button>`
    +plcs.map(d=>`<button class="tchip${activeTarget===d.id?' on':''}" data-t="${esc(d.id)}">${esc(d.name)}</button>`).join('');
}
targetsEl.addEventListener('click',e=>{
  const t=e.target.dataset.t;
  if(t&&t!==activeTarget) activate(t);
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

/* leaving the page: the active target keeps its latest program and values */
window.addEventListener('beforeunload',()=>{
  const t=store(activeTarget);
  if(t&&booted){ t.program=panel.source(); t.inputs=panel.values(); }
  project.save();
});

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
    try{ project.fromLLP(t); }
    catch(e){ alert(e.message); return; }
    plant.rebuild(); plant.inspector();
    activeTarget='sandbox'; booted=false;   // never stash old values into the new project
    activate('sandbox');
    plant.paint();
    setView('pid');
  });
});
document.getElementById('exportproj').addEventListener('click',()=>{
  const t=store(activeTarget);              // the editor's latest belongs to its target
  if(t){ t.program=panel.source(); t.inputs=panel.values(); }
  project.save();
  const name=(project.data.meta.name||'project').replace(/[^\w-]+/g,'-')+'.llp';
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([project.toLLP()],{type:'application/json;charset=utf-8'}));
  a.download=name; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
});

/* ---- views: P&ID is home, Logic edits the active target ---- */
function setView(v){
  document.querySelectorAll('.mode').forEach(x=>x.classList.toggle('on',x.dataset.view===v));
  const pid=v==='pid';
  document.getElementById('readwrap').hidden=pid;
  document.getElementById('plantwrap').hidden=!pid;
  if(pid){ plant.rebuild(); plant.paint(); plant.inspector(); }
}
document.querySelectorAll('.mode').forEach(btn=>btn.addEventListener('click',()=>setView(btn.dataset.view)));

/* ---- boot ---- */
if(!project.load()) plant.example();
if(!project.data.sandbox.program)
  project.data.sandbox={program:EX.ex1,inputs:Object.assign({},EX_DEFAULTS.ex1)};
plant.rebuild(); plant.inspector();
activate('sandbox');
setView('pid');
