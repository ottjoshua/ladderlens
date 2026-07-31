/* Required Notice: Copyright (c) 2026 Joshua Ott — LadderLens (https://ladderlens.com)
   PolyForm Noncommercial 1.0.0 — commercial use requires a separate license. */

import {esc,pnum,lex,KW,FUNCS,FB,parse,flatten,exprToST,parseExprText,toSeries,seriesToExpr,pruneNet,netAt,buildModel,blocks,modelToST,staleWarnings,scan,truthy,evalExpr,evaluate} from './engine.js';
import {EX,EX_DEFAULTS} from './examples.js';

export const SCAN_MS=100;

/* One logic panel = one PLC: its program, scan state, editor and diagram.
   All lookups are scoped to `root`; the plant and the header talk to the
   panel only through the hooks, so many panels can coexist. */
export function createLogicPanel(root, hooksIn={}){
const hooks=Object.assign({sensorTags:()=>new Set(),actuatorTags:()=>new Map(),
  publishSensors(){},plantScan(){},plantPaint(){},plantReset(){},onStatus(){},
  onSourceChange(){}},hooksIn);
const q=n=>root.querySelector('[data-el="'+n+'"]');
const srcEl=q('src'), errEl=q('err'), inEl=q('inputs'), outEl=q('outputs'),
      canvasEl=q('canvas'), cwarnEl=q('cwarn'), stfile=q('stfile');
let lastMsg='every rung re-evaluates each scan';

/* ---------- editable view model state ----------
   Built fresh from the flattened rungs on every run. AST nodes are deep-cloned,
   so diagram edits mutate the model, regenerate the text, and reparse — the
   textarea stays the single source of truth. */
let viewModel=[];
let programDecls=[];   // VAR-block declarations, preserved through diagram regen
/* true whenever the textarea holds text the model does NOT reflect (parse
   error) — diagram edits are ignored until the text parses again, so a stale
   model can never overwrite newer source text */
let modelStale=false;

/* ---------- rendering ---------- */
const NO=`<svg class="cglyph" viewBox="0 0 30 26"><line x1="0" y1="13" x2="10" y2="13" stroke="currentColor" stroke-width="2"/><line x1="10" y1="4" x2="10" y2="22" stroke="currentColor" stroke-width="2.2"/><line x1="20" y1="4" x2="20" y2="22" stroke="currentColor" stroke-width="2.2"/><line x1="20" y1="13" x2="30" y2="13" stroke="currentColor" stroke-width="2"/></svg>`;
const NC=`<svg class="cglyph" viewBox="0 0 30 26"><line x1="0" y1="13" x2="10" y2="13" stroke="currentColor" stroke-width="2"/><line x1="10" y1="4" x2="10" y2="22" stroke="currentColor" stroke-width="2.2"/><line x1="20" y1="4" x2="20" y2="22" stroke="currentColor" stroke-width="2.2"/><line x1="10" y1="22" x2="20" y2="4" stroke="currentColor" stroke-width="2.2"/><line x1="20" y1="13" x2="30" y2="13" stroke="currentColor" stroke-width="2"/></svg>`;
const fmt=v=>typeof v==='boolean'?(v?'TRUE':'FALSE'):(Number.isInteger(v)?v.toFixed(1):v.toFixed(2));
const fmtTime=ms=> ms>=1000 ? (Math.round(ms/100)/10)+'s' : Math.round(ms)+'ms';

function cRung(letter, contact, block, note){
  return `<div class="crung">
    <span class="cl">${letter}</span>
    <span class="crail"></span>
    <span class="ccontact">${contact}</span>
    <span class="cwire"></span>
    <span class="cblk">${block}</span>
    <span class="cwire"></span>
    <span class="ccoil">( )</span>
    <span class="cnote">${note}</span>
  </div>`;
}

/* builds the ladder DOM — called only when the program changes, never per
   scan, so inline editors and drags are never destroyed by the scan loop */
function renderStructure(model){
  const c=canvasEl;
  if(!model.length){
    c.innerHTML='<div class="lad"><div class="rnote">no assignments found — type on the left or press + rung</div></div>';
    return;
  }
  const contactHTML=(ct,gk,path,noDel)=>
    `<div class="contact" draggable="true" data-drag="contact" data-net="${gk}" data-path="${path}">
      ${noDel?'':`<button class="cx" data-act="delc" data-net="${gk}" data-path="${path}" title="delete contact">×</button>`}
      <div class="ctag" data-act="ctag" data-net="${gk}" data-path="${path}" title="click to edit">${esc(exprToST(ct.cond))}</div>
      <span data-act="toggle" data-net="${gk}" data-path="${path}" title="toggle [ ] / [/]">${ct.neg?NC:NO}</span>
    </div>`;
  /* series = AND (left to right), parallel = OR (stacked branches) */
  const seriesHTML=(series,gk,base)=>series.map((el,i)=>{
    const path=base===''?String(i):base+'.'+i;
    const wire=`<div class="w" data-wp="${gk}:${path}"></div>`;
    if(el.t==='par'){
      const brs=el.branches.map((br,bi)=>
        `<div class="pbranch">
           <div class="w pw" data-wbin="${gk}:${path}.${bi}"></div>
           ${seriesHTML(br,gk,path+'.'+bi)}
           <div class="w f" data-wbout="${gk}:${path}.${bi}"></div>
         </div>`).join('');
      return `<div class="par" data-net="${gk}" data-path="${path}">
          <div class="pwrap"><div class="pbranches">${brs}</div></div>
          <div class="parbtns">
            <button class="addbr" data-act="addbranch" data-net="${gk}" data-path="${path}" title="add parallel (OR) branch">+∥</button>
            <button class="addbr" data-act="toggle" data-net="${gk}" data-path="${path}" title="collapse the group into one normally-closed contact">[/]</button>
          </div>
        </div>`+wire;
    }
    // the lone FALSE placeholder contact (an emptied coil rung) can't be
    // deleted again — hide its × so the no-op isn't offered
    const noDel = gk==='e' && base==='' && series.length===1
      && el.cond && el.cond.k==='bool' && el.cond.v===false && !el.neg;
    return contactHTML(el,gk,path,noDel)+wire;
  }).join('');
  const inner = model.map((r,n)=>{
    const head_=`<div class="rhead">
      <span class="drag" draggable="true" data-drag="rung" title="drag to reorder">⋮⋮</span>
      <div class="rnote"><b>Rung ${n+1}</b> — %DESC%</div>
      <span class="sp"></span>
      <button class="cx" data-act="delrung" title="delete rung">×</button>
    </div>`;
    if(r.kind==='fb'){
      const def=FB[r.type];
      r._pins=def.args.filter(a=>a!==def.power).map(an=>({
        pin:an, get:()=>r.args[an], set:v=>{r.args[an]=v;}
      }));
      const pins=r._pins.map((p,pi)=>{
        const v=p.get();
        return `<div class="bio"><i>${esc(p.pin)}</i><span class="pinv" data-act="pin" data-pi="${pi}" title="click to edit">${v?esc(exprToST(v)):'—'}</span></div>`;
      }).join('');
      const statPin=r.type==='CTU'||r.type==='CTD'?'CV':(r.type==='R_TRIG'||r.type==='F_TRIG'?'':'ET');
      const desc=`${esc(r.type)} <b>${esc(r.name)}</b>`+
        (r.contacts.length?` — gated by ${esc(exprToST(seriesToExpr(r.contacts)))}`:'');
      return `<div class="rung" data-r="${n}">
        ${head_.replace('%DESC%', desc)}
        <div class="row">
          <div class="w" data-wk="w0"></div>
          ${seriesHTML(r.contacts,'g','')}
          <button class="addc" data-act="addc" data-net="g" title="add IF guard contact (gates the whole call — a gated timer freezes)">+[ ]</button>
          ${seriesHTML(r.power,'p','')}
          <button class="addc" data-act="addc" data-net="p" title="add contact on the ${esc(def.power)} input">+[ ]</button>
          <div class="w" data-wk="pw"></div>
          <div class="blk" data-blk>
            <div class="bname">${esc(r.type)}</div>
            <div class="bio"><i>this</i>${esc(r.name)}</div>
            ${pins}
            ${statPin?`<div class="bio"><i>${statPin}</i><span data-fbstat>—</span></div>`:''}
            <div class="bio"><i>Q</i>→</div>
          </div>
          <div class="w f" data-wk="q"></div>
          <div class="coil" data-qcoil>
            <div class="ctag2">${esc(r.name)}.Q</div>
            <div class="val" data-fbq>—</div>
          </div>
          <div class="w" data-wk="q"></div>
        </div></div>`;
    }
    if(r.kind==='loop'){
      const s=r.loop, isFor=s.k==='for';
      const head = isFor
        ? `FOR ${esc(s.v)} := ${esc(exprToST(s.from))} TO ${esc(exprToST(s.to))}${s.by?' BY '+esc(exprToST(s.by)):''}`
        : `WHILE ${esc(exprToST(s.cond))}`;

      // count iterations + estimate timing when the bounds are literals
      let iters=null;
      if(isFor){
        const num=x=>x&&x.k==='num'?x.v:NaN;
        const a=num(s.from), b=num(s.to), st=s.by?num(s.by):1;
        if(!isNaN(a)&&!isNaN(b)&&!isNaN(st)&&st!==0) iters=Math.floor((b-a)/st)+1;
      }
      const ms = iters!==null ? iters*100 : null;

      const banner = isFor
        ? `Structured text runs this ${iters!==null?iters+'&times;':'loop'} inside <b>one</b> scan.`+
          ` The ladder equivalent below runs <b>once per scan</b>${iters!==null?` across ${iters} scans`:''},`+
          ` so the result lands${ms!==null?` about ${ms} ms`:''} later. Same answer, different timing.`
        : `A WHILE loop has no fixed trip count, so it cannot be unrolled.`+
          ` The nearest ladder form is a self-gating counter that advances one step per scan &mdash;`+
          ` and an <b>unbounded</b> ladder loop is a watchdog fault waiting to happen, which is why`+
          ` raw WHILE is rare in real ladder.`;

      // the three-rung counter pattern (FOR only)
      const idx=esc(s.v), body=r.targets.map(esc).join(', ')||'…';
      const st = s.by?exprToST(s.by):'1';
      const patt = isFor ? `
        <div class="cpat">
          ${cRung('A', `[ ${idx} &lt; ${esc(exprToST(s.to))} ]`,
                  `ADD ${idx} , ${esc(st)} &rarr; ${idx}`, 'advance the counter')}
          ${cRung('B', `[ ${idx} &lt; ${esc(exprToST(s.to))} ]`,
                  `one iteration &rarr; ${body}`, 'do one pass of the loop body')}
          ${cRung('C', `[ ${idx} &ge; ${esc(exprToST(s.to))} ]`,
                  `finish &nbsp;·&nbsp; MOVE ${esc(exprToST(s.from))} &rarr; ${idx}`, 'done — reset for next time')}
        </div>` : '';

      return `<div class="rung" data-r="${n}">
        ${head_.replace('%DESC%', (isFor?'rebuilt as a counter across scans':'no bounded ladder form')
          +(r.contacts.length?` — gated by ${esc(exprToST(seriesToExpr(r.contacts)))}`:''))}
        <div class="noladder">
          <div class="nlhead">${head}</div>
          <div class="nlbody">${banner}</div>
          ${patt}
        </div></div>`;
    }
    const desc = r.contacts.length
      ? `gated by ${esc(exprToST(seriesToExpr(r.contacts)))}`
      : 'unconditional — runs every scan';
    if(r.enet){
      // boolean logic drawn as contacts -> coil, the way ladder means it
      return `<div class="rung" data-r="${n}">
        ${head_.replace('%DESC%', desc)}
        <div class="row">
          <div class="w" data-wk="w0"></div>
          ${seriesHTML(r.contacts,'g','')}
          <button class="addc" data-act="addc" data-net="g" title="add IF guard contact (when open, the coil is not written at all)">+[ ]</button>
          ${r.contacts.length?'<div class="w" data-wk="live"></div>':''}
          ${seriesHTML(r.enet,'e','')}
          <button class="addc" data-act="addc" data-net="e" title="add series contact to the coil logic">+[ ]</button>
          <div class="w f" data-wk="eout"></div>
          <div class="coil" data-coil>
            <div class="ctag2" data-act="coil" title="click to edit">${esc(r.target)}</div>
            <div class="val" data-val>—</div>
          </div>
          <div class="w" data-wk="eout"></div>
        </div></div>`;
    }
    r._blocks=blocks(r);
    const bs = r._blocks.map((b,bi)=>
      `<div class="blk" data-b="${bi}"><div class="bname"${b.kind==='bin'?` data-act="opname" data-b="${bi}" title="click to change"`:''}>${esc(b.name)}</div>`+
      b.ins.map((pinDef,ii)=>`<div class="bio"><i>${esc(pinDef.pin)}</i><span class="pinv" data-act="pin" data-b="${bi}" data-i="${ii}" title="${esc(exprToST(pinDef.get()))} — click to edit">${esc(exprToST(pinDef.get()))}</span></div>`).join('')+
      `<div class="bio"><i>OUT</i>→</div></div><div class="w" data-wk="live"></div>`
    ).join('');
    return `<div class="rung" data-r="${n}">
      ${head_.replace('%DESC%', desc)}
      <div class="row">
        <div class="w" data-wk="w0"></div>
        ${seriesHTML(r.contacts,'g','')}
        <button class="addc" data-act="addc" data-net="g" title="add contact">+[ ]</button>
        <div class="w" data-wk="live"></div>
        ${bs}
        <div class="w f" data-wk="live"></div>
        <div class="coil" data-coil>
          <div class="ctag2" data-act="coil" title="click to edit">${esc(r.target)}</div>
          <div class="val" data-val>—</div>
        </div>
        <div class="w" data-wk="live"></div>
      </div></div>`;
  }).join('');
  c.innerHTML = `<div class="lad" data-lad>${inner}</div>`;
  drawReturn(canvasEl.querySelector('[data-lad]'));
  // vertical connection bars for each parallel group (heights need layout)
  canvasEl.querySelector('[data-lad]').querySelectorAll('.par>.pwrap').forEach(pw=>{
    const brs=[...pw.querySelectorAll(':scope>.pbranches>.pbranch')];
    if(brs.length<2) return;
    const top=brs[0].offsetTop+28, bot=brs[brs.length-1].offsetTop+30;
    for(const side of ['pbarL','pbarR']){
      const b=document.createElement('div');
      b.className='pbar '+side;
      b.style.top=top+'px'; b.style.height=(bot-top)+'px';
      pw.appendChild(b);
    }
  });
}

/* power-flow trace: wires light where power actually reaches — a branch
   conducts only if its contacts close AND power arrives at its left bar */
function flowSeries(q,gk,series,base,entry,env,fb){
  const setOn=(x,on)=>{ if(x) x.classList.toggle('on',!!on); };
  let power=entry;
  series.forEach((el,i)=>{
    const path=base===''?String(i):base+'.'+i;
    if(el.t==='contact'){
      const b=truthy(evalExpr(el.cond,env,false,fb));
      const on=el.neg?!b:b;
      setOn(q.querySelector(`.contact[data-net="${gk}"][data-path="${path}"]`),on);
      power=power&&on;
    } else {
      let any=false;
      el.branches.forEach((br,bi)=>{
        const bp=path+'.'+bi;
        const out=flowSeries(q,gk,br,bp,power,env,fb);
        setOn(q.querySelector(`[data-wbin="${gk}:${bp}"]`),power);
        setOn(q.querySelector(`[data-wbout="${gk}:${bp}"]`),out);
        any=any||out;
      });
      const parEl=q.querySelector(`.par[data-net="${gk}"][data-path="${path}"]`);
      if(parEl){
        setOn(parEl.querySelector(':scope>.pwrap>.pbar.pbarL'),power);
        setOn(parEl.querySelector(':scope>.pwrap>.pbar.pbarR'),power&&any);
      }
      power=power&&any;
    }
    setOn(q.querySelector(`[data-wp="${gk}:${path}"]`),power);
  });
  return power;
}

/* paints live state onto the existing structure — runs every scan, touches
   only classes and text, and skips any rung that hosts an open inline editor */
function updateState(model,env,fb){
  const act=document.activeElement;
  const editingRung = act&&act.classList&&act.classList.contains('inline') ? act.closest('[data-r]') : null;
  const lad=canvasEl.querySelector('[data-lad]');
  if(!lad) return;
  const rungEls=lad.querySelectorAll(':scope>.rung');
  const setOn=(el,on)=>{ if(el) el.classList.toggle('on',!!on); };
  model.forEach((r,n)=>{
    const el=rungEls[n];
    if(!el||r.kind==='loop'||el===editingRung) return;
    const executed=flowSeries(el,'g',r.contacts,'',true,env,fb);
    setOn(el.querySelector('.w[data-wk="w0"]'), true);   // the rail is always hot
    if(r.kind==='assign'){
      el.querySelectorAll('.w[data-wk="live"]').forEach(w=>setOn(w,executed));
      const v=env[r.target];
      const valEl=el.querySelector('[data-val]');
      if(r.enet){
        const inOn=flowSeries(el,'e',r.enet,'',executed,env,fb);
        el.querySelectorAll('.w[data-wk="eout"]').forEach(w=>setOn(w,inOn));
        setOn(el.querySelector('[data-coil]'),executed&&inOn);
        if(valEl) valEl.textContent = executed&&v!==undefined ? fmt(v) : 'not written';
      } else {
        el.querySelectorAll('.blk').forEach(b=>setOn(b,executed));
        setOn(el.querySelector('[data-coil]'),executed);
        if(valEl) valEl.textContent = executed&&v!==undefined ? fmt(v) : 'not written';
      }
    } else if(r.kind==='fb'){
      const inOn=flowSeries(el,'p',r.power,'',executed,env,fb);
      setOn(el.querySelector('.w[data-wk="pw"]'), r.power.length>0&&inOn);
      setOn(el.querySelector('[data-blk]'), executed);
      const st=fb[r.name];
      const statEl=el.querySelector('[data-fbstat]');
      if(statEl&&st) statEl.textContent = (r.type==='CTU'||r.type==='CTD') ? String(st.cv) : fmtTime(st.et);
      const q=!!(st&&st.q);
      el.querySelectorAll('.w[data-wk="q"]').forEach(w=>setOn(w,q));
      setOn(el.querySelector('[data-qcoil]'),q);
      const qEl=el.querySelector('[data-fbq]');
      if(qEl) qEl.textContent = q?'TRUE':'FALSE';
    }
  });
  outEl.querySelectorAll('[data-o]').forEach(sp=>{
    const v=env[sp.dataset.o];
    sp.textContent = v!==undefined ? fmt(v) : '—';
  });
  outEl.querySelectorAll('[data-fb]').forEach(sp=>{
    const st=fb[sp.dataset.fb];
    if(!st){ sp.textContent='—'; return; }
    let t='Q='+(st.q?'TRUE':'FALSE');
    if(st.type==='CTU'||st.type==='CTD') t+=' · CV '+st.cv;
    else if(st.type!=='R_TRIG'&&st.type!=='F_TRIG') t+=' · ET '+fmtTime(st.et);
    sp.textContent=t;
  });
}

/* full return path: exits below the last rung, runs up the left gutter,
   and re-enters pointing down the left power rail */
function drawReturn(c){
  const H = c.scrollHeight;
  const top = 10, bot = H - 20, x = 16, rail = 44;
  const d = `M ${rail} ${bot} L ${x+10} ${bot} Q ${x} ${bot} ${x} ${bot-12}`
          + ` L ${x} ${top+12} Q ${x} ${top} ${x+10} ${top} L ${rail} ${top}`;
  const svg = `<svg class="retpath" height="${H}" viewBox="0 0 44 ${H}" aria-hidden="true">
      <path d="${d}" fill="none" stroke="var(--rail)" stroke-width="1.5"
            stroke-dasharray="5 4" stroke-linecap="round"/>
      <path d="M ${rail-5} ${top+9} L ${rail} ${top+17} L ${rail+5} ${top+9}"
            fill="none" stroke="var(--rail)" stroke-width="1.8"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <div class="retlbl">back to rung 1 · <b>T#100ms</b> · 10 scans per second, forever</div>`;
  c.insertAdjacentHTML('beforeend', svg);
}

let values={};
let inputsKey=null;

/* one delegated listener — the panel is NOT rebuilt while you type,
   so number fields keep focus between keystrokes. Input changes take
   effect on the next scan; no re-parse needed. */
inEl.addEventListener('input',e=>{
  const el=e.target, n=el.dataset.v;
  if(!n) return;
  if(el.type==='checkbox'){
    values[n]=el.checked;
    const sp=inEl.querySelector(`[data-o="${n}"]`);
    if(sp) sp.textContent = el.checked?'TRUE':'FALSE';
  }
  else{ const x=parseFloat(el.value); values[n]= isNaN(x)?0:x; }
});

function refreshInputs(inputs,bools,force){
  const key=inputs.map(v=>v+(bools.has(v)?':b':':n')).join('|');
  if(force || key!==inputsKey){
    inputsKey=key;
    inEl.innerHTML = inputs.length? inputs.map(v=>bools.has(v)
        ? `<label class="tog"><input type="checkbox" data-v="${esc(v)}" ${values[v]?'checked':''}>${esc(v)}</label><span class="out" data-o="${esc(v)}">${values[v]?'TRUE':'FALSE'}</span>`
        : `<label for="i_${esc(v)}">${esc(v)}</label><input type="number" step="any" id="i_${esc(v)}" data-v="${esc(v)}" value="${esc(values[v])}">`
      ).join('') : '<span class="out" style="color:var(--dim)">none</span>';
  } else {
    inputs.forEach(v=>{
      if(!bools.has(v)) return;
      const sp=inEl.querySelector(`[data-o="${v}"]`);
      if(sp) sp.textContent = values[v]?'TRUE':'FALSE';
    });
  }
}

/* ---------- the scan cycle ----------
   The PLC state lives here: scanEnv persists between scans (seal-in circuits
   latch), fbStates holds timer/counter memory. RESET is a cold restart. */
let lastProg=null, scanEnv={}, fbStates={};
let plcRunning=true, faulted=false;

function fault(e){
  faulted=true;
  errEl.innerHTML=`<div class="err">Runtime fault: ${esc(e.message)}\nThe scan is halted — fix the program, or press RESET.</div>`;
  hooks.onStatus(status());
}
function updateRunUI(){ hooks.onStatus(status()); }
/* repaint the display from current state WITHOUT executing a scan — editing
   and RESET must never run hidden logic (counters would count, TPs would fire) */
function repaint(){ updateState(viewModel,scanEnv,fbStates); }

/* dt handling: the browser throttles timers in background tabs, so free-running
   scans use real elapsed time (clamped) to keep TON/TOF wall-clock accurate;
   STEP passes a fixed 100 ms so single-stepping stays deterministic */
let lastTickAt=null;
function scanTick(fixedDt){
  if(!lastProg||modelStale||faulted) return;
  const now=performance.now();
  const dt = fixedDt!==undefined ? fixedDt
           : (lastTickAt===null ? SCAN_MS : Math.min(now-lastTickAt,1000));
  lastTickAt=now;
  for(const k of Object.keys(values)) scanEnv[k]=values[k];
  hooks.publishSensors();         // transmitters publish PVs before the logic runs
  try{ evaluate(lastProg,scanEnv,dt,fbStates); }
  catch(e){ fault(e); return; }
  hooks.plantScan(dt);            // actuators move flow, tanks integrate
  updateState(viewModel,scanEnv,fbStates);
  hooks.plantPaint();
}

function run(forceInputs){
  hooks.onSourceChange(srcEl.value);   // even mid-edit text persists — WIP must not vanish
  errEl.innerHTML='';
  let prog;
  try{ prog=parse(lex(srcEl.value)); }
  catch(e){ errEl.innerHTML=`<div class="err">Parse error: ${esc(e.message)}</div>`; modelStale=true; updateRunUI(); return; }
  modelStale=false;
  faulted=false;
  lastProg=prog;
  programDecls=Object.entries(prog.decls).map(([name,type])=>({name,type}));
  // drop retained FB state whose declaration vanished or changed type
  for(const k of Object.keys(fbStates))
    if(fbStates[k].type!==prog.decls[k]) delete fbStates[k];

  const disc=scan(prog);
  const outputs=disc.outputs, bools=disc.bools, insts=disc.insts;
  // the plant owns transmitter-bound tags (they are measurements, not inputs);
  // actuator tags the logic neither writes nor reads become manual plant inputs
  const sensorTags=hooks.sensorTags();
  const assignedSet=new Set(outputs);
  const inputs=disc.inputs.filter(v=>!sensorTags.has(v));
  for(const [tag,kind] of hooks.actuatorTags())
    if(!assignedSet.has(tag)&&!sensorTags.has(tag)&&!inputs.includes(tag)){
      inputs.push(tag);
      if(kind==='bool') bools.add(tag);
    }
  // prune `values` to the CURRENT inputs — a tag that stops being an input
  // (e.g. its assignment was temporarily commented out mid-edit) must not
  // leave a stale overlay that stomps retained scanEnv state every scan
  const inputSet=new Set(inputs);
  for(const k of Object.keys(values)){
    if(!inputSet.has(k)){ delete values[k]; continue; }
    if(bools.has(k)&&typeof values[k]!=='boolean') values[k]=truthy(values[k]);
    else if(!bools.has(k)&&typeof values[k]==='boolean') values[k]=values[k]?1:0;
  }
  // likewise drop retained state for tags that no longer exist in the program
  // (transmitter tags are plant-owned measurements — keep them)
  const known=new Set([...inputs,...outputs,...sensorTags]);
  for(const k of Object.keys(scanEnv)) if(!known.has(k)) delete scanEnv[k];
  hooks.publishSensors();   // stopped-PLC displays should still show real tank levels
  // hasOwnProperty guard: a variable named e.g. "constructor" must not resolve
  // to an inherited Object.prototype member. A tag that just became a manual
  // input keeps its last commanded value instead of snapping to 0.
  inputs.forEach(v=>{
    if(!Object.prototype.hasOwnProperty.call(values,v))
      values[v]= Object.prototype.hasOwnProperty.call(scanEnv,v)
        ? (bools.has(v)?truthy(scanEnv[v]):pnum(scanEnv[v]))
        : (bools.has(v)?false:0);
  });

  refreshInputs(inputs,bools,forceInputs===true);

  outEl.innerHTML = outputs.map(v=>
    `<label>${esc(v)}</label><span class="out" data-o="${esc(v)}">—</span>`).join('')
    + insts.map(n=>
    `<label>${esc(n)}</label><span class="out" data-fb="${esc(n)}">—</span>`).join('');

  viewModel=buildModel(flatten(prog));
  renderStructure(viewModel);
  const w=staleWarnings(viewModel);
  for(const t of sensorTags)
    if(assignedSet.has(t))
      w.push('The logic assigns <b>'+esc(t)+'</b>, but a plant transmitter publishes that tag every scan. '
        +'The assignment overwrites the measurement after the sensor writes it — the plant runs on the '
        +'logic’s value, not the tank’s. Rename one of them.');
  cwarnEl.innerHTML = w.length
    ? '<div class="warnbox">'+w.map(x=>'&middot; '+x).join('<br>')+'</div>' : '';
  lastMsg = `${viewModel.length} rungs · scanning every ${SCAN_MS} ms — state persists between scans`;
  updateRunUI();
  repaint();    // show current state immediately; the next scan does the rest
}

/* diagram edited -> regenerate the text and run the full cycle */
function regen(){
  if(modelStale) return;
  srcEl.value=modelToST(viewModel, programDecls);
  run();
}

/* ---------- panel controls (the shell owns the header buttons) ---------- */
function toggleRun(){
  plcRunning=!plcRunning;
  if(plcRunning) lastTickAt=null;   // don't lump the stopped time into one dt
  updateRunUI();
}
function step(){ if(!plcRunning) scanTick(SCAN_MS); }
function reset(){
  scanEnv={}; fbStates={}; lastTickAt=null;
  hooks.plantReset();              // tanks back to start levels; PVs republished
  // a parse error is still a parse error after a cold restart — keep it shown
  if(!modelStale){ faulted=false; errEl.innerHTML=''; }
  updateRunUI();
  repaint();
  hooks.plantPaint();
}
/* load a program with fresh values and a cold PLC — examples, file opens,
   and target switches */
function coldStart(source,vals){
  srcEl.value=source;
  values=Object.assign({},vals||{});
  scanEnv={}; fbStates={};
  run(true);
  if(modelStale){
    // the incoming program doesn't parse — the panels must never keep showing
    // a DIFFERENT program's rungs and inputs under this target's banner
    viewModel=[]; inputsKey=null;
    inEl.innerHTML='<span class="out" style="color:var(--dim)">none</span>';
    outEl.innerHTML='';
    canvasEl.innerHTML='<div class="lad"><div class="rnote">this program has a parse error — fix the text to see its rungs</div></div>';
    cwarnEl.innerHTML='';
  }
}
/* re-render the diagram from the current model — needed after the panel's
   container becomes visible, because a display:none subtree measures as 0
   (return path height, parallel-bar offsets) */
function rerender(){
  if(modelStale||!viewModel) return;
  renderStructure(viewModel);
  repaint();
}
function status(){ return {running:plcRunning,faulted,stale:modelStale,msg:lastMsg}; }

srcEl.addEventListener('input',()=>run());

root.querySelectorAll('[data-ex]').forEach(b=>b.addEventListener('click',()=>{
  coldStart(EX[b.dataset.ex], EX_DEFAULTS[b.dataset.ex]);
}));

function inlineEdit(el,initial,apply){
  const host=el.closest('[draggable]'); if(host) host.draggable=false;
  // un-clip the host (.pinv has max-width + overflow:hidden) while editing
  el.style.maxWidth='none'; el.style.overflow='visible';
  const inp=document.createElement('input');
  inp.className='inline'; inp.value=initial; inp.spellcheck=false;
  inp.style.width=Math.max(60,Math.min(260,initial.length*7+30))+'px';
  el.replaceChildren(inp);
  inp.focus(); inp.select();
  let done=false;
  // cancel path restores the label in place — no canvas rebuild, so the click
  // that blurred the editor still lands on its target
  const restore=()=>{
    done=true;
    el.style.maxWidth=''; el.style.overflow='';
    el.textContent = initial==='' ? '—' : initial;   // empty pins keep their placeholder
    if(host) host.draggable=true;
  };
  const commit=()=>{
    if(done) return;
    const v=inp.value.trim();
    if(v===''||v===initial){ restore(); return; }
    try{ apply(v); done=true; }
    catch(err){ inp.classList.add('bad'); inp.title=err.message; inp.focus(); }
  };
  inp.addEventListener('keydown',e=>{
    if(e.key==='Enter'){ e.preventDefault(); commit(); }
    else if(e.key==='Escape'){ restore(); }
    else inp.classList.remove('bad');
  });
  inp.addEventListener('blur',()=>commit());
}

canvasEl.addEventListener('click',e=>{
  if(modelStale) return;   // text has a parse error — the diagram is read-only
  if(e.target.closest('input,select')) return;
  const t=e.target.closest('[data-act]');
  if(!t) return;
  const rungEl=t.closest('[data-r]');
  const r=rungEl?viewModel[+rungEl.dataset.r]:null;
  if(!r) return;
  const act=t.dataset.act;
  // contact networks: "g" = IF guards, "p" = FB power input, "e" = coil logic
  const net = t.dataset.net==='p' ? r.power : (t.dataset.net==='e' ? r.enet : r.contacts);
  if(act==='delrung'){ viewModel.splice(+rungEl.dataset.r,1); regen(); }
  else if(act==='toggle'){
    const {arr,idx}=netAt(net,t.dataset.path);
    if(arr[idx].t==='par'){
      // negate the whole group: collapse to one NC contact over the OR expr
      arr.splice(idx,1,{t:'contact',cond:seriesToExpr([arr[idx]]),neg:true});
    } else arr[idx].neg=!arr[idx].neg;
    regen();
  }
  else if(act==='delc'){
    const {arr,idx}=netAt(net,t.dataset.path);
    arr.splice(idx,1); pruneNet(net); regen();
  }
  else if(act==='addc'){ net.push({t:'contact',cond:{k:'var',name:'bNew'},neg:false}); regen(); }
  else if(act==='addbranch'){
    const {arr,idx}=netAt(net,t.dataset.path);
    arr[idx].branches.push([{t:'contact',cond:{k:'var',name:'bNew'},neg:false}]);
    regen();
  }
  else if(act==='ctag'){
    const {arr,idx}=netAt(net,t.dataset.path); const ct=arr[idx];
    inlineEdit(t, exprToST(ct.cond), v=>{
      // typed AND/OR expands into series/parallel structure in place
      arr.splice(idx,1,...toSeries(parseExprText(v, programDecls), ct.neg));
      pruneNet(net); regen();
    });
  }
  else if(act==='pin'){
    const pinDef = r.kind==='fb' ? r._pins[+t.dataset.pi] : r._blocks[+t.dataset.b].ins[+t.dataset.i];
    const cur=pinDef.get();
    inlineEdit(t, cur?exprToST(cur):'', v=>{ pinDef.set(parseExprText(v, programDecls)); regen(); });
  }
  else if(act==='coil'){
    inlineEdit(t, r.target, v=>{
      if(!/^[A-Za-z_]\w*$/.test(v) || KW.has(v.toUpperCase()) || FUNCS.has(v.toUpperCase()))
        throw new Error('output tag must be a plain identifier (not a reserved word)');
      r.target=v; regen();
    });
  }
  else if(act==='opname'){
    const b=r._blocks[+t.dataset.b];
    if(b.kind!=='bin') return;
    const sel=document.createElement('select'); sel.className='opsel';
    ['ADD','SUB','MUL','DIV'].forEach(o=>{
      const op=document.createElement('option'); op.textContent=o; op.selected=o===b.name; sel.appendChild(op);
    });
    t.replaceChildren(sel); sel.focus();
    const INV={ADD:'+',SUB:'-',MUL:'*',DIV:'/'};
    let applied=false;
    sel.addEventListener('change',()=>{ applied=true; b.node.op=INV[sel.value]; delete b.node.synth; regen(); });
    sel.addEventListener('blur',()=>{ if(!applied) t.textContent=b.name; });
  }
});

/* drag & drop — rungs reorder across the ladder, contacts reorder within their rung */
let dragInfo=null;
const clearDragHighlights=()=>canvasEl.querySelectorAll('.dragover').forEach(x=>x.classList.remove('dragover'));
canvasEl.addEventListener('dragstart',e=>{
  if(modelStale){ e.preventDefault(); return; }
  const h=e.target.closest('[data-drag]');
  if(!h){ e.preventDefault(); return; }
  const rungEl=h.closest('[data-r]');
  dragInfo = h.dataset.drag==='rung'
    ? {t:'rung', r:+rungEl.dataset.r}
    : {t:'contact', r:+rungEl.dataset.r, net:h.dataset.net||'g', path:h.dataset.path};
  e.dataTransfer.effectAllowed='move';
  e.dataTransfer.setData('text/plain','');
  if(h.dataset.drag==='rung') e.dataTransfer.setDragImage(rungEl,20,20);
});
canvasEl.addEventListener('dragover',e=>{
  if(!dragInfo) return;
  const over = dragInfo.t==='rung'
    ? e.target.closest('.rung')
    : e.target.closest('.contact,.addc');
  if(!over) return;
  if(dragInfo.t==='contact'){
    const rungEl=over.closest('[data-r]');
    if(!rungEl || +rungEl.dataset.r!==dragInfo.r) return;
    if((over.dataset.net||'g')!==dragInfo.net) return;
    // reorder only within the same series (same parallel branch)
    const parentOf=p=>p&&p.includes('.')?p.slice(0,p.lastIndexOf('.')):'';
    const overParent = over.classList.contains('addc') ? '' : parentOf(over.dataset.path);
    if(overParent!==parentOf(dragInfo.path)) return;
  }
  e.preventDefault();
  clearDragHighlights();
  over.classList.add('dragover');
});
canvasEl.addEventListener('drop',e=>{
  if(!dragInfo) return;
  e.preventDefault();
  if(dragInfo.t==='rung'){
    const over=e.target.closest('.rung');
    if(over){
      const from=dragInfo.r, to=+over.dataset.r;
      if(from!==to){ viewModel.splice(to,0,viewModel.splice(from,1)[0]); regen(); }
    }
  } else {
    const over=e.target.closest('.contact,.addc');
    const rungEl=over&&over.closest('[data-r]');
    if(rungEl && +rungEl.dataset.r===dragInfo.r && (over.dataset.net||'g')===dragInfo.net){
      const r=viewModel[dragInfo.r];
      const net=dragInfo.net==='p'?r.power:(dragInfo.net==='e'?r.enet:r.contacts);
      const from=netAt(net,dragInfo.path);
      const parentOf=p=>p&&p.includes('.')?p.slice(0,p.lastIndexOf('.')):'';
      let toArr, toIdx;
      if(over.classList.contains('addc')){
        if(parentOf(dragInfo.path)!=='') { dragInfo=null; clearDragHighlights(); return; }
        toArr=net; toIdx=net.length-1;
      } else {
        if(parentOf(over.dataset.path)!==parentOf(dragInfo.path)){ dragInfo=null; clearDragHighlights(); return; }
        const tgt=netAt(net,over.dataset.path);
        toArr=tgt.arr; toIdx=tgt.idx;
      }
      if(toArr===from.arr && toIdx!==from.idx){
        from.arr.splice(toIdx,0,from.arr.splice(from.idx,1)[0]); regen();
      }
    }
  }
  dragInfo=null;
  clearDragHighlights();
});
canvasEl.addEventListener('dragend',()=>{ dragInfo=null; clearDragHighlights(); });

q('addrung').addEventListener('click',()=>{
  if(modelStale) return;
  viewModel.push({kind:'assign',target:'rNew',expr:{k:'num',v:0,raw:'0.0'},contacts:[]});
  regen();
});

function loadFile(f){ f.text().then(t=>{ srcEl.value=t; scanEnv={}; fbStates={}; run(true); }); }
q('openst').addEventListener('click',()=>stfile.click());
stfile.addEventListener('change',()=>{ if(stfile.files[0]) loadFile(stfile.files[0]); stfile.value=''; });
q('exportst').addEventListener('click',()=>{
  const blob=new Blob([srcEl.value],{type:'text/plain;charset=utf-8'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download='program.st'; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
});
srcEl.addEventListener('dragover',e=>{
  if([...e.dataTransfer.types].includes('Files')) e.preventDefault();
});
srcEl.addEventListener('drop',e=>{
  const f=e.dataTransfer.files&&e.dataTransfer.files[0];
  if(f){ e.preventDefault(); loadFile(f); }
});

return {run, repaint, scanTick, step, toggleRun, reset, coldStart, rerender, status,
  isRunning:()=>plcRunning,
  env:()=>scanEnv,
  source:()=>srcEl.value,
  values:()=>Object.assign({},values),
  clockReset:()=>{ lastTickAt=null; }};
}
