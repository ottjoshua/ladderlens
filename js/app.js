/* Required Notice: Copyright (c) 2026 Joshua Ott — LadderLens (https://ladderlens.com)
   PolyForm Noncommercial 1.0.0 — commercial use requires a separate license. */

import {esc,lex,parseTimeLiteral,KW,FUNCS,FB,PLAINTYPES,parse,collectTargets,flatten,exprToST,parseExprText,fbCallToST,unparseStmt,orTerms,toSeries,guardsToNet,seriesToExpr,pruneNet,netAt,buildModel,isBoolExpr,blocks,contactText,wrapGuards,modelToST,staleWarnings,scan,truthy,evalExpr,runFB,evaluate} from './engine.js';
import {EX} from './examples.js';

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
  const c=document.getElementById('canvas');
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
  c.innerHTML = `<div class="lad" id="lad">${inner}</div>`;
  drawReturn(document.getElementById('lad'));
  // vertical connection bars for each parallel group (heights need layout)
  document.getElementById('lad').querySelectorAll('.par>.pwrap').forEach(pw=>{
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
  const lad=document.getElementById('lad');
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

/* ---------- app ---------- */
const srcEl=document.getElementById('src'), errEl=document.getElementById('err');
const inEl=document.getElementById('inputs'), outEl=document.getElementById('outputs');
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
const SCAN_MS=100;
let lastProg=null, scanEnv={}, fbStates={};
let plcRunning=true, faulted=false;

function fault(e){
  faulted=true;
  errEl.innerHTML=`<div class="err">Runtime fault: ${esc(e.message)}\nThe scan is halted — fix the program, or press RESET.</div>`;
  document.getElementById('dot').classList.add('stop');
}
function updateRunUI(){
  document.getElementById('runbtn').textContent = plcRunning?'stop':'run';
  document.getElementById('dot').classList.toggle('stop', !plcRunning||faulted||modelStale);
}
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
  plantSensors();                 // transmitters publish PVs before the logic runs
  try{ evaluate(lastProg,scanEnv,dt,fbStates); }
  catch(e){ fault(e); return; }
  plantTick(dt);                  // actuators move flow, tanks integrate
  updateState(viewModel,scanEnv,fbStates);
  plantPaint();
}

function run(forceInputs){
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
  const sensorTags=plantSensorTagSet();
  const assignedSet=new Set(outputs);
  const inputs=disc.inputs.filter(v=>!sensorTags.has(v));
  for(const [tag,kind] of plantActuatorTags())
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
  plantSensors();   // stopped-PLC displays should still show real tank levels
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
  document.getElementById('cwarn').innerHTML = w.length
    ? '<div class="warnbox">'+w.map(x=>'&middot; '+x).join('<br>')+'</div>' : '';
  document.getElementById('scanmsg').textContent =
    `${viewModel.length} rungs · scanning every ${SCAN_MS} ms — state persists between scans`;
  updateRunUI();
  repaint();    // show current state immediately; the next scan does the rest
}

/* diagram edited -> regenerate the text and run the full cycle */
function regen(){
  if(modelStale) return;
  srcEl.value=modelToST(viewModel, programDecls);
  run();
}

/* the scan genuinely pauses while the tab is hidden (browsers throttle hidden
   timers anyway); on return, the gap is not counted into dt */
setInterval(()=>{ if(plcRunning&&!document.hidden) scanTick(); }, SCAN_MS);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) lastTickAt=null; });

document.getElementById('runbtn').addEventListener('click',()=>{
  plcRunning=!plcRunning;
  if(plcRunning) lastTickAt=null;   // don't lump the stopped time into one dt
  updateRunUI();
});
document.getElementById('stepbtn').addEventListener('click',()=>{
  if(!plcRunning) scanTick(SCAN_MS);
});
document.getElementById('resetbtn').addEventListener('click',()=>{
  scanEnv={}; fbStates={}; lastTickAt=null;
  plantReset();                  // tanks back to their start levels
  plantSensors();                // transmitters republish so displays agree
  // a parse error is still a parse error after a cold restart — keep it shown
  if(!modelStale){ faulted=false; errEl.innerHTML=''; }
  updateRunUI();
  repaint();
  plantPaint();
});

srcEl.addEventListener('input',()=>run());
const EX_DEFAULTS={
  ex1:{rLC_SP:60,rLevel_PV:50,rLC_Kp:1.5,rLC_Bias:50,rLC_ManOP:0,bLC_ManMode:false},
  ex2:{rLC_SP:60,rLevel_PV:40,rLC_Kp:1.5,rLC_Bias:50,rLC_ManOP:0,bLC_ManMode:false},
  ex3:{rLevel:20,rTripPoint:15,rSpeedRef:80,rEnableScale:1,bLowLevelTrip:false},
  ex4:{iMode:1,rManualCmd:40,rAutoCmd:55,rTrim:1,rSafeCmd:0},
  ex5:{rSample:25},
  ex6:{bStart:false,bStop:false}
};
['ex1','ex2','ex3','ex4','ex5','ex6'].forEach(id=>document.getElementById(id)
  .addEventListener('click',()=>{
    srcEl.value=EX[id];
    values=Object.assign({},EX_DEFAULTS[id]||{});
    scanEnv={}; fbStates={};   // examples start from a cold PLC
    run(true);
  }));

/* boot happens at the end of the script, after the plant is initialized */

/* ================= DIAGRAM EDITING ================= */
const canvasEl=document.getElementById('canvas');

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

document.getElementById('addrung').addEventListener('click',()=>{
  if(modelStale) return;
  viewModel.push({kind:'assign',target:'rNew',expr:{k:'num',v:0,raw:'0.0'},contacts:[]});
  regen();
});

/* ================= .ST FILE OPEN / EXPORT ================= */
const stfile=document.getElementById('stfile');
function loadFile(f){ f.text().then(t=>{ srcEl.value=t; scanEnv={}; fbStates={}; run(true); }); }
document.getElementById('openst').addEventListener('click',()=>stfile.click());
stfile.addEventListener('change',()=>{ if(stfile.files[0]) loadFile(stfile.files[0]); stfile.value=''; });
document.getElementById('exportst').addEventListener('click',()=>{
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
/* a file released anywhere else must not navigate the page away */
document.addEventListener('dragover',e=>{ if([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
document.addEventListener('drop',e=>{ if([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });

/* ================= PLANT — P&ID canvas + process simulation =================
   Devices live on an SVG canvas and share the logic's tag environment:
   transmitters WRITE their tank's level to a tag before each scan; valves and
   pumps READ their tags after the scan and move flow; tanks integrate it.
   Flow units: %/s of a tank at 100% open/speed. The plant is saved in
   localStorage; the .st file carries only the logic. */
const PSTORE='ladderlens.plant.v1';
var plant={devices:[]};
let pSel=null, pDrag=null;

const pById=id=>plant.devices.find(d=>d.id===id);
const clamp01=v=>Math.max(0,Math.min(100,v));
const pnum=v=>{ const n=typeof v==='boolean'?(v?1:0):parseFloat(v); return isNaN(n)?0:n; };

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
    if(d.type==='lt'&&d.pvTag){ const t=pById(d.tank); scanEnv[d.pvTag]= t&&t.type==='tank' ? t.level||0 : 0; }
}
function plantTick(dt){
  const flows={};
  for(const d of plant.devices){
    if(d.type!=='valve'&&d.type!=='pump') continue;
    let f=0;
    if(d.type==='valve'){
      const pos=d.posTag ? pnum(scanEnv[d.posTag]) : (d.posConst||0);
      f=(d.maxFlow||0)*clamp01(pos)/100;
    } else {
      const run=d.runTag ? truthy(scanEnv[d.runTag]) : true;
      const spd=d.speedTag ? clamp01(pnum(scanEnv[d.speedTag])) : 100;
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
      const pos=d.posTag?pnum(scanEnv[d.posTag]):(d.posConst||0);
      const tx=g.querySelector('[data-postxt]');
      if(tx) tx.textContent=(d.posTag?d.posTag+' = ':'')+clamp01(pos).toFixed(0)+'%';
    } else if(d.type==='pump'){
      const run=d.runTag?truthy(scanEnv[d.runTag]):true;
      const rot=g.querySelector('[data-rotor]'); if(rot) rot.setAttribute('fill',run?'#5fd38d':'#6c7a85');
      const tx=g.querySelector('[data-runtxt]');
      if(tx) tx.textContent=(d.runTag?d.runTag+' = ':'')+(run?'RUN':'STOP');
    } else if(d.type==='lt'&&d.pvTag){
      const tx=g.querySelector('[data-pvtxt]');
      if(tx) tx.textContent=d.pvTag+' = '+pnum(scanEnv[d.pvTag]).toFixed(1);
    }
    if(d._flow!==undefined)
      svg.querySelectorAll(`[data-pipe="${d.id}"]`).forEach(p=>p.classList.toggle('flowing',d._flow>0));
  }
  const rows=[];
  plantSensorTagSet().forEach(t=>rows.push([t+' (PV)',pnum(scanEnv[t]).toFixed(1)]));
  for(const [t,k] of plantActuatorTags())
    rows.push([t, k==='bool'?(truthy(scanEnv[t])?'TRUE':'FALSE'):pnum(scanEnv[t]).toFixed(1)]);
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
  run(true);
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
  plantSave(); plantRebuild(); plantPaint(); renderInspector(); run(true);
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
  plantSave(); plantRebuild(); plantPaint(); renderInspector(); run(true);
}));
document.getElementById('pclear').addEventListener('click',()=>{
  plant={devices:[]}; pSel=null;
  plantSave(); plantRebuild(); plantPaint(); renderInspector(); run(true);
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
  srcEl.value=EX.ex1;
  values=Object.assign({},EX_DEFAULTS.ex1);
  delete values.rLevel_PV;      // the transmitter drives PV now
  scanEnv={}; fbStates={};
  plantSave(); plantRebuild(); renderInspector();
  run(true);
  plantPaint();
});

/* view switch */
document.querySelectorAll('.mode').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.mode').forEach(x=>x.classList.toggle('on',x===btn));
  const pv=btn.dataset.view==='plant';
  document.getElementById('readwrap').hidden=pv;
  document.getElementById('plantwrap').hidden=!pv;
  if(pv){ plantRebuild(); plantPaint(); renderInspector(); }
}));

/* ---- boot ---- */
if(!plantLoad()) plantExample();
plantRebuild(); renderInspector();
srcEl.value=EX.ex1;
values={rLC_SP:60,rLevel_PV:50,rLC_Kp:1.5,rLC_Bias:50,rLC_ManOP:0,bLC_ManMode:false};
run(true);

