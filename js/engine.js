/* Required Notice: Copyright (c) 2026 Joshua Ott — LadderLens (https://ladderlens.com)
   PolyForm Noncommercial 1.0.0 — commercial use requires a separate license. */

const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const pnum=v=>{ const n=typeof v==='boolean'?(v?1:0):parseFloat(v); return isNaN(n)?0:n; };

/* ---------- tokenizer ---------- */
function lex(src){
  src = src.replace(/\(\*[\s\S]*?\*\)/g,' ').replace(/\/\/[^\n]*/g,' ');
  const t=[], re=/([Tt](?:[Ii][Mm][Ee])?#[\w.]+|[A-Za-z_]\w*|\d+\.\d+|\d+|:=|<=|>=|<>|[-+*/()<>=,;:.])|(\S)/g;
  let m;
  while((m=re.exec(src))!==null){
    if(m[2]!==undefined) throw new Error(`unexpected character "${m[2]}"`);
    t.push(m[1]);
  }
  return t;
}

/* T#5s / TIME#1m30s / T#250ms -> milliseconds */
function parseTimeLiteral(tok){
  const body=tok.slice(tok.indexOf('#')+1).toLowerCase().replace(/_/g,'');
  const re=/(\d+(?:\.\d+)?)(ms|s|m|h|d)/g;
  const UNIT={ms:1,s:1000,m:60000,h:3600000,d:86400000};
  let ms=0, consumed=0, m;
  while((m=re.exec(body))!==null){ ms+=parseFloat(m[1])*UNIT[m[2]]; consumed+=m[0].length; }
  if(consumed!==body.length || consumed===0)
    throw new Error(`bad time literal "${tok}" — use e.g. T#500ms, T#5s, T#1m30s`);
  return ms;
}

/* ---------- parser ---------- */
const KW = new Set(['IF','THEN','ELSIF','ELSE','END_IF','AND','OR','NOT','TRUE','FALSE',
                    'CASE','OF','END_CASE','FOR','TO','BY','DO','END_FOR','WHILE','END_WHILE',
                    'VAR','END_VAR']);
const FUNCS = new Set(['LIMIT','MIN','MAX','ABS','SQRT','SEL']);

/* stateful IEC function blocks: argument order, which argument carries rung
   power in ladder, and which output members exist */
const FB = {
  TON:   {args:['IN','PT'],  power:'IN',  members:['Q','ET']},
  TOF:   {args:['IN','PT'],  power:'IN',  members:['Q','ET']},
  TP:    {args:['IN','PT'],  power:'IN',  members:['Q','ET']},
  CTU:   {args:['CU','R','PV'],  power:'CU',  members:['Q','CV']},
  CTD:   {args:['CD','LD','PV'], power:'CD',  members:['Q','CV']},
  R_TRIG:{args:['CLK'], power:'CLK', members:['Q']},
  F_TRIG:{args:['CLK'], power:'CLK', members:['Q']},
};
const PLAINTYPES = new Set(['BOOL','INT','DINT','REAL','LREAL','TIME']);

function parse(tokens){
  let i=0;
  const decls={};   // instance/variable name -> declared type (uppercase)
  const peek=()=>tokens[i];
  const up=()=> (tokens[i]||'').toUpperCase();
  const eat=(v)=>{
    if(v && (tokens[i]||'').toUpperCase()!==v.toUpperCase())
      throw new Error(`expected ${v}, found "${tokens[i]||'end of input'}"`);
    return tokens[i++];
  };

  function stmts(stop){
    const out=[];
    while(i<tokens.length && !stop.has(up())) out.push(stmt());
    return out;
  }
  function varBlock(){
    eat('VAR');
    const list=[];
    while(i<tokens.length && up()!=='END_VAR'){
      const name=eat()||'';
      if(!/^[A-Za-z_]\w*$/.test(name) || KW.has(name.toUpperCase()))
        throw new Error(`"${name||'end of input'}" is not a valid variable name`);
      if(decls[name]!==undefined) throw new Error(`"${name}" is declared twice`);
      eat(':');
      const type=(eat()||'').toUpperCase();
      if(!FB[type] && !PLAINTYPES.has(type))
        throw new Error(`unknown type "${type||'end of input'}" — function blocks: ${Object.keys(FB).join(', ')}; simple types: ${[...PLAINTYPES].join(', ')}`);
      decls[name]=type;
      list.push({name,type});
      if(peek()===';') i++;
    }
    eat('END_VAR');
    if(peek()===';') i++;
    return {k:'vardecl',decls:list};
  }
  function fbCall(name){
    const type=decls[name];
    eat('(');
    const args={};
    if(up()!==')'){
      for(;;){
        const an=(eat()||'').toUpperCase();
        if(!FB[type].args.includes(an))
          throw new Error(`${type} has no input "${an||'end of input'}" — inputs: ${FB[type].args.join(', ')}`);
        if(args[an]!==undefined) throw new Error(`input "${an}" is given twice`);
        eat(':=');
        args[an]=orExpr();
        if(peek()===','){ eat(','); continue; }
        break;
      }
    }
    eat(')');
    if(peek()===';') i++;
    return {k:'fbcall',name,type,args};
  }
  function stmt(){
    if(up()==='IF') return ifStmt();
    if(up()==='CASE') return caseStmt();
    if(up()==='FOR') return forStmt();
    if(up()==='WHILE') return whileStmt();
    if(up()==='VAR') return varBlock();
    const target=eat();
    if(!/^[A-Za-z_]\w*$/.test(target) || KW.has(target.toUpperCase()))
      throw new Error(`"${target}" is not a valid assignment target`);
    if(peek()==='('){
      if(FB[decls[target]]) return fbCall(target);
      throw new Error(`"${target}" is called like a function block, but it is not declared — add e.g. "VAR ${target} : TON; END_VAR"`);
    }
    eat(':=');
    const expr=orExpr();
    if(peek()===';') i++;
    return {k:'assign',target,expr};
  }
  function ifStmt(){
    eat('IF');
    const cond=orExpr();
    eat('THEN');
    const then=stmts(new Set(['ELSIF','ELSE','END_IF']));
    let alt=[], elifs=[];
    while(up()==='ELSIF'){ eat('ELSIF'); const c=orExpr(); eat('THEN');
      elifs.push({cond:c,body:stmts(new Set(['ELSIF','ELSE','END_IF']))}); }
    if(up()==='ELSE'){ eat('ELSE'); alt=stmts(new Set(['END_IF'])); }
    eat('END_IF');
    if(peek()===';') i++;
    return {k:'if',cond,then,elifs,alt};
  }
  function caseStmt(){
    eat('CASE');
    const sel=orExpr();
    eat('OF');
    const branches=[]; let alt=[];
    const STOP=new Set(['ELSE','END_CASE']);
    // a branch ends at ELSE, END_CASE, or the start of the next label — detected
    // by speculatively parsing a comma-separated expression list up to a ':'
    // (safe: ':=' is a single token, so no statement starts expression-then-':')
    const atLabel=()=>{
      const save=i;
      try{
        orExpr();
        while(peek()===','){ eat(','); orExpr(); }
        const ok=peek()===':';
        i=save; return ok;
      }catch(e){ i=save; return false; }
    };
    const branchBody=()=>{
      const out=[];
      while(i<tokens.length && !STOP.has(up()) && !atLabel()) out.push(stmt());
      return out;
    };
    while(i<tokens.length && !STOP.has(up())){
      const labels=[orExpr()];
      while(peek()===','){ eat(','); labels.push(orExpr()); }
      eat(':');
      branches.push({labels,body:branchBody()});
    }
    if(up()==='ELSE'){ eat('ELSE'); alt=stmts(new Set(['END_CASE'])); }
    eat('END_CASE');
    if(peek()===';') i++;
    return {k:'case',sel,branches,alt};
  }
  function forStmt(){
    eat('FOR');
    const v=eat(); eat(':='); const from=orExpr(); eat('TO'); const to=orExpr();
    let by=null;
    if(up()==='BY'){ eat('BY'); by=orExpr(); }
    eat('DO');
    const body=stmts(new Set(['END_FOR']));
    eat('END_FOR');
    if(peek()===';') i++;
    return {k:'for',v,from,to,by,body};
  }
  function whileStmt(){
    eat('WHILE');
    const cond=orExpr(); eat('DO');
    const body=stmts(new Set(['END_WHILE']));
    eat('END_WHILE');
    if(peek()===';') i++;
    return {k:'while',cond,body};
  }
  function orExpr(){ let l=andExpr();
    while(up()==='OR'){ eat('OR'); l={k:'bin',op:'OR',l,r:andExpr()}; } return l; }
  function andExpr(){ let l=cmpExpr();
    while(up()==='AND'){ eat('AND'); l={k:'bin',op:'AND',l,r:cmpExpr()}; } return l; }
  function cmpExpr(){ let l=add();
    while(['<','>','<=','>=','=','<>'].includes(peek())){ const op=eat(); l={k:'bin',op,l,r:add()}; }
    return l; }
  function add(){ let l=mul();
    while(peek()==='+'||peek()==='-'){ const op=eat(); l={k:'bin',op,l,r:mul()}; } return l; }
  function mul(){ let l=unary();
    while(peek()==='*'||peek()==='/'){ const op=eat(); l={k:'bin',op,l,r:unary()}; } return l; }
  function unary(){
    if(up()==='NOT'){ eat('NOT'); return {k:'not',e:unary()}; }
    if(peek()==='-'){ eat('-'); return {k:'bin',op:'-',synth:true,l:{k:'num',v:0},r:unary()}; }
    return prim();
  }
  function prim(){
    if(peek()==='('){ eat('('); const e=orExpr(); eat(')'); return e; }
    const tk=eat();
    if(tk===undefined) throw new Error('unexpected end of input');
    if(tk.includes('#')) return {k:'time',v:parseTimeLiteral(tk),raw:tk};
    if(/^\d/.test(tk)) return {k:'num',v:parseFloat(tk),raw:tk};
    if(!/^[A-Za-z_]\w*$/.test(tk)) throw new Error(`unexpected "${tk}"`);
    const U=tk.toUpperCase();
    if(U==='TRUE') return {k:'bool',v:true};
    if(U==='FALSE') return {k:'bool',v:false};
    if(KW.has(U)) throw new Error(`"${tk}" is a reserved word`);
    if(peek()==='('){
      if(FB[decls[tk]])
        throw new Error(`"${tk}" is a function block instance — call it as its own statement, then read ${tk}.${FB[decls[tk]].members[0]}`);
      eat('('); const args=[];
      if(peek()!==')'){ args.push(orExpr()); while(peek()===','){ eat(','); args.push(orExpr()); } }
      eat(')');
      return {k:'call',name:U,args};
    }
    let node={k:'var',name:tk};
    if(peek()==='.'){
      eat('.');
      const mem=eat();
      if(!/^[A-Za-z_]\w*$/.test(mem||'')) throw new Error(`expected a member name after "${tk}."`);
      const type=decls[tk];
      if(!FB[type]) throw new Error(`"${tk}" is not a declared function block instance, so "${tk}.${mem}" has no meaning`);
      const M=mem.toUpperCase();
      if(!FB[type].members.includes(M))
        throw new Error(`${type} has no output "${M}" — outputs: ${FB[type].members.join(', ')}`);
      node={k:'member',inst:tk,name:M};
      if(peek()==='.') throw new Error(`"${tk}.${M}" has no members of its own`);
    }
    return node;
  }
  const prog=stmts(new Set());
  prog.decls=decls;
  return prog;
}

/* ---------- flatten to rungs ---------- */
const OPBLOCK={'+':'ADD','-':'SUB','*':'MUL','/':'DIV'};

function collectTargets(list){
  const out=[];
  for(const s of list||[]){
    if(s.k==='assign') out.push(s.target);
    else if(s.k==='if'){ out.push(...collectTargets(s.then)); s.elifs.forEach(e=>out.push(...collectTargets(e.body))); out.push(...collectTargets(s.alt)); }
    else if(s.k==='case'){ s.branches.forEach(b=>out.push(...collectTargets(b.body))); out.push(...collectTargets(s.alt)); }
    else if(s.k==='for'||s.k==='while') out.push(...collectTargets(s.body));
  }
  return out;
}

function flatten(prog){
  const rungs=[];
  let pairId=0;
  function walk(list,guards){
    for(const s of list){
      if(s.k==='vardecl'){ /* not a rung */ }
      else if(s.k==='fbcall') rungs.push({kind:'fb',fb:s,guards:guards.slice()});
      else if(s.k==='assign') rungs.push({target:s.target,expr:s.expr,guards:guards.slice()});
      else if(s.k==='if'){
        // a genuine single-assignment IF/ELSE pair is tagged so regen can
        // collapse it back even when the condition reads the written tag —
        // sequential IFs and IF/ELSE differ exactly in that case
        const pair = !s.elifs.length && s.then.length===1 && s.alt.length===1
          && s.then[0].k==='assign' && s.alt[0].k==='assign'
          && s.then[0].target===s.alt[0].target ? ++pairId : 0;
        walk(s.then, guards.concat([{cond:s.cond,neg:false}]));
        if(pair) rungs[rungs.length-1].ifPair=pair;
        let acc=[{cond:s.cond,neg:true}];
        for(const e of s.elifs){
          walk(e.body, guards.concat(acc,[{cond:e.cond,neg:false}]));
          acc=acc.concat([{cond:e.cond,neg:true}]);
        }
        if(s.alt.length) walk(s.alt, guards.concat(acc));
        if(pair) rungs[rungs.length-1].ifPair=pair;
      }
      else if(s.k==='case'){
        let acc=[];
        for(const b of s.branches){
          const c = b.labels.length===1
            ? {k:'bin',op:'=',l:s.sel,r:b.labels[0]}
            : b.labels.slice(1).reduce((a,L)=>({k:'bin',op:'OR',l:a,r:{k:'bin',op:'=',l:s.sel,r:L}}),
                                        {k:'bin',op:'=',l:s.sel,r:b.labels[0]});
          walk(b.body, guards.concat(acc,[{cond:c,neg:false}]));
          acc=acc.concat([{cond:c,neg:true}]);
        }
        if(s.alt.length) walk(s.alt, guards.concat(acc));
      }
      else if(s.k==='for' || s.k==='while'){
        rungs.push({kind:'loop', loop:s, guards:guards.slice(),
                    targets:[...new Set(collectTargets(s.body))]});
      }
    }
  }
  walk(prog,[]);
  return rungs;
}

/* ---------- AST -> Structured Text ---------- */
const PREC={'OR':1,'AND':2,'<':3,'>':3,'<=':3,'>=':3,'=':3,'<>':3,'+':4,'-':4,'*':5,'/':5};

function exprToST(e){
  switch(e.k){
    case 'num': return e.raw!==undefined?e.raw:String(e.v);
    case 'time': return e.raw!==undefined?e.raw:('T#'+e.v+'ms');
    case 'bool': return e.v?'TRUE':'FALSE';
    case 'var': return e.name;
    case 'member': return e.inst+'.'+e.name;
    case 'not': return 'NOT '+(e.e.k==='bin'?'('+exprToST(e.e)+')':exprToST(e.e));
    case 'call': return e.name+'('+e.args.map(exprToST).join(', ')+')';
    case 'bin':{
      if(e.synth && e.op==='-' && e.l.k==='num' && e.l.v===0)
        return '-'+(e.r.k==='bin'?'('+exprToST(e.r)+')':exprToST(e.r));
      const p=PREC[e.op];
      const wl=e.l.k==='bin' && PREC[e.l.op]<p;
      const wr=e.r.k==='bin' && PREC[e.r.op]<=p;
      return (wl?'(':'')+exprToST(e.l)+(wl?')':'')+' '+e.op+' '+(wr?'(':'')+exprToST(e.r)+(wr?')':'');
    }
  }
  return '?';
}

/* parse a string as a single expression (piggybacks on the full parser,
   seeded with the program's VAR declarations so tmr.Q etc. resolve) */
function parseExprText(src, programDecls){
  const decl=programDecls.length
    ? 'VAR\n'+programDecls.map(d=>d.name+' : '+d.type+';').join('\n')+'\nEND_VAR\n' : '';
  const prog=parse(lex(decl+'__t := ('+src+');'));
  const st=prog.find(s=>s.k==='assign');
  if(!st || prog.filter(s=>s.k!=='vardecl').length!==1) throw new Error('not a single expression');
  return st.expr;
}

function fbCallToST(s){
  const parts=FB[s.type].args.filter(a=>s.args[a]!==undefined).map(a=>a+' := '+exprToST(s.args[a]));
  return s.name+'('+parts.join(', ')+');';
}

/* AST statement -> ST text, preserving IF/CASE/FOR/WHILE structure
   (used to re-emit loop rungs and their bodies) */
function unparseStmt(s,ind){
  const I=ind, B=ind+'    ';
  const body=list=>list.map(x=>unparseStmt(x,B)).join('\n');
  switch(s.k){
    case 'assign': return I+s.target+' := '+exprToST(s.expr)+';';
    case 'fbcall': return I+fbCallToST(s);
    case 'vardecl': return I+'VAR\n'+s.decls.map(d=>B+d.name+' : '+d.type+';').join('\n')+'\n'+I+'END_VAR';
    case 'if':{
      let t=I+'IF '+exprToST(s.cond)+' THEN\n'+body(s.then);
      for(const e of s.elifs) t+='\n'+I+'ELSIF '+exprToST(e.cond)+' THEN\n'+body(e.body);
      if(s.alt.length) t+='\n'+I+'ELSE\n'+body(s.alt);
      return t+'\n'+I+'END_IF';
    }
    case 'case':{
      let t=I+'CASE '+exprToST(s.sel)+' OF';
      for(const b of s.branches)
        t+='\n'+B+b.labels.map(exprToST).join(', ')+': '+b.body.map(x=>unparseStmt(x,'').replace(/\n/g,' ')).join(' ');
      if(s.alt.length) t+='\n'+I+'ELSE\n'+body(s.alt);
      return t+'\n'+I+'END_CASE';
    }
    case 'for':
      return I+'FOR '+s.v+' := '+exprToST(s.from)+' TO '+exprToST(s.to)
             +(s.by?' BY '+exprToST(s.by):'')+' DO\n'+body(s.body)+'\n'+I+'END_FOR';
    case 'while':
      return I+'WHILE '+exprToST(s.cond)+' DO\n'+body(s.body)+'\n'+I+'END_WHILE';
  }
  return '';
}


/* conditions -> a ladder contact NETWORK. Series is AND, parallel is OR:
     elem   := {t:'contact', cond, neg} | {t:'par', branches:[series, ...]}
     series := elem[]
   A negated AND/OR stays one NC contact (no De Morgan rewriting). */
function orTerms(e){
  return (e.k==='bin'&&e.op==='OR') ? [...orTerms(e.l),...orTerms(e.r)] : [e];
}
function toSeries(cond,neg){   // cond must be a private copy — subtrees end up in elems
  while(cond.k==='not'){ neg=!neg; cond=cond.e; }
  if(!neg && cond.k==='bin' && cond.op==='AND')
    return [...toSeries(cond.l,false), ...toSeries(cond.r,false)];
  if(!neg && cond.k==='bin' && cond.op==='OR')
    return [{t:'par', branches:orTerms(cond).map(t=>toSeries(t,false))}];
  return [{t:'contact', cond, neg}];
}
function guardsToNet(guards){
  const out=[];
  for(const g of guards) out.push(...toSeries(structuredClone(g.cond), g.neg));
  return out;
}
/* network -> expression AST (for regen and rung descriptions) */
function seriesToExpr(series){
  let node=null;
  for(const el of series){
    let e;
    if(el.t==='par'){
      let o=null;
      for(const br of el.branches){ const be=seriesToExpr(br); if(be) o=o?{k:'bin',op:'OR',l:o,r:be}:be; }
      e=o||{k:'bool',v:false};
    } else {
      e=el.neg?{k:'not',e:structuredClone(el.cond)}:structuredClone(el.cond);
    }
    node=node?{k:'bin',op:'AND',l:node,r:e}:e;
  }
  return node;
}
/* drop empty branches, dissolve one-branch parallels (after deletions) */
function pruneNet(series){
  for(let i=series.length-1;i>=0;i--){
    const el=series[i];
    if(el.t!=='par') continue;
    el.branches.forEach(pruneNet);
    el.branches=el.branches.filter(b=>b.length);
    if(el.branches.length===1) series.splice(i,1,...el.branches[0]);
    else if(!el.branches.length) series.splice(i,1);
  }
}
/* resolve a "i.j.k" path (elem index, branch index, elem index, ...) to the
   containing series and index */
function netAt(series,path){
  const p=path.split('.').map(Number);
  let arr=series;
  for(let k=0;k+1<p.length;k+=2) arr=arr[p[k]].branches[p[k+1]];
  return {arr, idx:p[p.length-1]};
}
function buildModel(flatRungs){
  return flatRungs.map(r=>{
    if(r.kind==='loop')
      return {kind:'loop', loop:structuredClone(r.loop), contacts:guardsToNet(r.guards), targets:r.targets};
    if(r.kind==='fb'){
      const s=r.fb, powerArg=FB[s.type].power;
      const args={};
      for(const [k,v] of Object.entries(s.args)) if(k!==powerArg) args[k]=structuredClone(v);
      const power = s.args[powerArg]!==undefined
        ? toSeries(structuredClone(s.args[powerArg]),false) : [];
      return {kind:'fb', name:s.name, type:s.type, args, power, contacts:guardsToNet(r.guards)};
    }
    const m={kind:'assign', target:r.target, expr:structuredClone(r.expr), contacts:guardsToNet(r.guards)};
    if(r.ifPair) m.ifPair=r.ifPair;
    // boolean-shaped assignments draw as a contact network driving the coil
    // (bMotor := (bStart OR bMotor) AND NOT bStop is the textbook seal-in)
    if(isBoolExpr(r.expr)) m.enet=toSeries(structuredClone(r.expr),false);
    return m;
  });
}
function isBoolExpr(e){
  return e.k==='bool' || e.k==='not' ||
    (e.k==='bin' && ['AND','OR','<','>','<=','>=','=','<>'].includes(e.op));
}

/* ordered block list from a model rung's expression tree, with live node
   references so pin edits replace the right subtree */
function blocks(r){
  const out=[];
  function walk(node){
    if(node.k==='bin' && OPBLOCK[node.op]){
      walk(node.l); walk(node.r);
      out.push({kind:'bin', node, name:OPBLOCK[node.op], ins:[
        {pin:'IN1', get:()=>node.l, set:v=>{node.l=v; delete node.synth;}},
        {pin:'IN2', get:()=>node.r, set:v=>{node.r=v; delete node.synth;}}
      ]});
      return;
    }
    if(node.k==='call'){
      node.args.forEach(walk);
      const names=node.name==='LIMIT'?['MN','IN','MX']:null;
      out.push({kind:'call', node, name:node.name,
        ins:node.args.map((a,i)=>({pin:(names&&names[i])||('IN'+(i+1)),
          get:()=>node.args[i], set:v=>{node.args[i]=v;}}))});
      return;
    }
  }
  walk(r.expr);
  if(!out.length)
    out.push({kind:'move', node:null, name:'MOVE',
      ins:[{pin:'IN', get:()=>r.expr, set:v=>{r.expr=v;}}]});
  return out;
}

/* contact -> ST condition text; parenthesize when needed for NOT */
function contactText(c){
  const t=exprToST(c.cond);
  if(c.neg) return 'NOT '+(c.cond.k==='bin'?'('+t+')':t);
  return t;
}
function wrapGuards(net,inner){
  if(!net.length) return inner;
  const cond=exprToST(seriesToExpr(net));
  return 'IF '+cond+' THEN\n'+inner.split('\n').map(l=>l?'    '+l:l).join('\n')+'\nEND_IF';
}

/* model -> full ST program. Complementary single-contact rungs writing the
   same tag collapse back into one IF/ELSE. */
function modelToST(model, programDecls){
  const parts=[], used=new Set();
  if(programDecls.length)
    parts.push('VAR\n'+programDecls.map(d=>'    '+d.name+' : '+d.type+';').join('\n')+'\nEND_VAR');
  model.forEach((r,i)=>{
    if(used.has(i)) return;
    if(r.kind==='loop'){ parts.push(wrapGuards(r.contacts, unparseStmt(r.loop,''))); return; }
    if(r.kind==='fb'){
      const args={};
      for(const [k,v] of Object.entries(r.args)) args[k]=v;
      if(r.power.length) args[FB[r.type].power]=seriesToExpr(r.power);
      parts.push(wrapGuards(r.contacts, fbCallToST({name:r.name,type:r.type,args})));
      return;
    }
    const netTxt=m=>m.enet ? (m.enet.length?exprToST(seriesToExpr(m.enet)):'FALSE') : exprToST(m.expr);
    const eTxt=netTxt(r);
    if(!r.contacts.length){ parts.push(r.target+' := '+eTxt+';'); return; }
    // only the immediately following rung can be the ELSE partner — flatten
    // always emits an IF/ELSE adjacently, and collapsing across intervening
    // rungs would silently reorder the program. Also never collapse when the
    // condition reads the written tag (seal-in style): sequential IFs
    // re-evaluate the condition mid-scan, IF/ELSE evaluates it once — those
    // differ exactly when the first body changes the condition.
    const condReadsTarget=(c,tgt)=>{
      let found=false;
      (function w(e){ if(!e||found) return;
        if(e.k==='var'&&e.name===tgt){ found=true; return; }
        if(e.k==='not') w(e.e);
        else if(e.k==='bin'){ w(e.l); w(e.r); }
        else if(e.k==='call') e.args.forEach(w);
      })(c);
      return found;
    };
    const single=net=>net.length===1&&net[0].t==='contact'?net[0]:null;
    const rc=single(r.contacts);
    // a tagged genuine IF/ELSE pair may collapse even when the condition
    // reads the target (that's a scan blinker — sequential IFs would break it)
    if(rc && i+1<model.length
       && (!condReadsTarget(rc.cond, r.target) || (r.ifPair && model[i+1].ifPair===r.ifPair))){
      const j=i+1, s=model[j];
      const sc=s&&s.kind==='assign'?single(s.contacts):null;
      if(!used.has(j) && sc && s.target===r.target
         && exprToST(sc.cond)===exprToST(rc.cond)
         && sc.neg!==rc.neg){
        used.add(j);
        parts.push('IF '+contactText(rc)+' THEN\n    '
          +r.target+' := '+eTxt+';\nELSE\n    '
          +s.target+' := '+netTxt(s)+';\nEND_IF');
        return;
      }
    }
    parts.push(wrapGuards(r.contacts, r.target+' := '+eTxt+';'));
  });
  return parts.join('\n\n');
}

/* the classic ladder->text mistake, surfaced live: a tag written only by one
   gated rung holds its stale value when the contact opens */
function staleWarnings(model){
  const w=[];
  model.forEach((r,i)=>{
    if(r.kind==='fb'&&r.contacts.length){
      w.push('Rung '+(i+1)+' calls <b>'+esc(r.name)+'</b> only while its IF condition is true. '
        +'A function block that is not called does not execute — a gated timer <b>freezes</b> instead of resetting. '
        +'In ladder the block always sees the rail; gate the '+esc(FB[r.type].power)+' input instead.');
      return;
    }
    if(r.kind!=='assign'||!r.contacts.length) return;
    const others=model.some((s,j)=>j!==i&&s.kind==='assign'&&s.target===r.target);
    if(!others) w.push('Rung '+(i+1)+' writes <b>'+esc(r.target)+'</b> only while its contact passes power. '
      +'When the contact opens, nothing writes the tag, so it holds its last value. '
      +'If the output should drop out, add the complementary rung (or an ELSE in the text).');
  });
  return w;
}

/* ---------- variable discovery ---------- */
function scan(prog){
  const assigned=new Set(), read=new Set(), bools=new Set(), insts=new Set();
  const BOOLARGS=new Set(['IN','CU','CD','CLK','R','LD']);
  function ex(e,isBool){
    if(!e) return;
    switch(e.k){
      case 'var': read.add(e.name); if(isBool) bools.add(e.name); break;
      case 'member': insts.add(e.inst); break;
      case 'not': ex(e.e,true); break;
      case 'call': e.args.forEach(a=>ex(a,false)); break;
      case 'bin':
        if(e.op==='AND'||e.op==='OR'){ ex(e.l,true); ex(e.r,true); }
        else { ex(e.l,false); ex(e.r,false); }
        break;
    }
  }
  (function walk(list){
    for(const s of list){
      if(s.k==='assign'){ assigned.add(s.target); ex(s.expr,false); }
      else if(s.k==='vardecl'){ s.decls.forEach(d=>{ if(FB[d.type]) insts.add(d.name); else if(d.type==='BOOL') bools.add(d.name); }); }
      else if(s.k==='fbcall'){ insts.add(s.name);
        for(const[an,ax]of Object.entries(s.args)) ex(ax,BOOLARGS.has(an)); }
      else if(s.k==='if'){ ex(s.cond,true); walk(s.then); s.elifs.forEach(e=>{ex(e.cond,true);walk(e.body);}); walk(s.alt); }
      else if(s.k==='case'){ ex(s.sel,false); s.branches.forEach(b=>{b.labels.forEach(L=>ex(L,false)); walk(b.body);}); walk(s.alt); }
      else if(s.k==='for'){ assigned.add(s.v); ex(s.from,false); ex(s.to,false); ex(s.by,false); walk(s.body); }
      else if(s.k==='while'){ ex(s.cond,true); walk(s.body); }
    }
  })(prog);
  const inputs=[...read].filter(v=>!assigned.has(v)&&!insts.has(v));
  return {inputs,outputs:[...assigned],bools,insts:[...insts]};
}

/* ---------- evaluator ---------- */
const truthy=v=>v===true||(typeof v==='number'&&v!==0);

/* one expression evaluator for both the scan and the rung display.
   strict=true throws on unknown functions; strict=false (display) treats them as 0.
   fb = the function-block instance state map (for member access like tmr.Q) */
function evalExpr(e,env,strict,fb){
  if(!e) return 0;
  switch(e.k){
    case 'num': return e.v;
    case 'time': return e.v;
    case 'bool': return e.v;
    case 'var': return env[e.name]!==undefined?env[e.name]:0;
    case 'member':{
      // an instance that has never been called reads as cold defaults,
      // like zeroed instance memory on a real PLC
      const st=fb&&fb[e.inst];
      if(!st) return e.name==='Q'?false:0;
      const v=st[e.name.toLowerCase()];
      return v===undefined?0:v;
    }
    case 'not': return !truthy(evalExpr(e.e,env,strict,fb));
    case 'call':{
      const a=e.args.map(x=>evalExpr(x,env,strict,fb));
      switch(e.name){
        case 'LIMIT': return Math.min(Math.max(a[1],a[0]),a[2]);
        case 'MIN': return Math.min(...a);
        case 'MAX': return Math.max(...a);
        case 'ABS': return Math.abs(a[0]);
        case 'SQRT': return Math.sqrt(a[0]);
        case 'SEL': return truthy(a[0])?a[2]:a[1];
        default:
          if(strict) throw new Error(`unknown function "${e.name}" — known: LIMIT, MIN, MAX, ABS, SQRT, SEL`);
          return 0;
      }
    }
    case 'bin':{
      const L=evalExpr(e.l,env,strict,fb), R=evalExpr(e.r,env,strict,fb);
      switch(e.op){
        case '+':return L+R; case '-':return L-R; case '*':return L*R;
        case '/':return R===0?0:L/R;
        case '>':return L>R; case '<':return L<R; case '>=':return L>=R; case '<=':return L<=R;
        case '=':return L===R; case '<>':return L!==R;
        case 'AND':return truthy(L)&&truthy(R); case 'OR':return truthy(L)||truthy(R);
      }
      return 0;
    }
  }
  return 0;
}

/* one scan of a stateful function block. st is the instance's retained state
   (lowercase members q/et/cv plus internals); dt is the scan period in ms */
function runFB(type,st,inp,dt){
  const IN=truthy(inp.IN), PT=inp.PT||0;
  // IEC timing: ET is 0 on the scan that observes the edge; dt accumulates
  // starting the FOLLOWING scan (st.prev marks "was already in this phase")
  switch(type){
    case 'TON':
      if(IN){ if(st.prev) st.et=Math.min(st.et+dt,PT); st.q=st.et>=PT; }
      else { st.et=0; st.q=false; }
      st.prev=IN;
      break;
    case 'TOF':
      if(IN){ st.q=true; st.et=0; }
      else if(st.q){ if(!st.prev) st.et=Math.min(st.et+dt,PT); if(st.et>=PT) st.q=false; }
      st.prev=IN;
      break;
    case 'TP':{
      const rising=IN&&!st.prev;
      if(rising&&!st.busy){ st.busy=true; st.et=0; }
      else if(st.busy) st.et=Math.min(st.et+dt,PT);
      if(st.busy){
        st.q=st.et<PT;
        if(st.et>=PT&&!IN){ st.busy=false; st.et=0; }
      }
      st.prev=IN;
      break;
    }
    case 'CTU':{
      const cu=truthy(inp.CU);
      if(truthy(inp.R)) st.cv=0;
      else if(cu&&!st.prev) st.cv++;
      st.prev=cu; st.q=st.cv>=(inp.PV||0);
      break;
    }
    case 'CTD':{
      const cd=truthy(inp.CD);
      if(truthy(inp.LD)) st.cv=inp.PV||0;
      else if(cd&&!st.prev&&st.cv>0) st.cv--;
      st.prev=cd; st.q=st.cv<=0;
      break;
    }
    case 'R_TRIG':{ const c=truthy(inp.CLK); st.q=c&&!st.prev; st.prev=c; break; }
    case 'F_TRIG':{ const c=truthy(inp.CLK); st.q=!c&&st.prev; st.prev=c; break; }
  }
}

function evaluate(prog,env,dt,fbStates){
  dt=dt===undefined?100:dt;
  fbStates=fbStates||{};
  const val=e=>evalExpr(e,env,true,fbStates);
  let budget=20000;
  (function walk(list){
    for(const s of list){
      if(s.k==='vardecl'){ /* declarations execute nothing */ }
      else if(s.k==='assign'){ env[s.target]=val(s.expr); }
      else if(s.k==='fbcall'){
        const def=FB[s.type];
        let st=fbStates[s.name];
        if(!st||st.type!==s.type) st=fbStates[s.name]={type:s.type,q:false,et:0,cv:0,prev:false,busy:false,inp:{}};
        // IEC formal calls: an omitted input keeps its previous instance value
        const inp={};
        for(const a of def.args)
          inp[a]= s.args[a]!==undefined ? val(s.args[a])
                : (st.inp&&st.inp[a]!==undefined ? st.inp[a] : (a==='PT'||a==='PV'?0:false));
        st.inp=inp;
        runFB(s.type,st,inp,dt);
      }
      else if(s.k==='if'){
        if(truthy(val(s.cond))) walk(s.then);
        else {
          let done=false;
          for(const e of s.elifs){ if(!done && truthy(val(e.cond))){ walk(e.body); done=true; } }
          if(!done) walk(s.alt);
        }
      }
      else if(s.k==='case'){
        const sv=val(s.sel); let done=false;
        for(const b of s.branches){
          if(!done && b.labels.some(L=>val(L)===sv)){ walk(b.body); done=true; }
        }
        if(!done) walk(s.alt);
      }
      else if(s.k==='for'){
        const a=val(s.from), b=val(s.to), st=s.by?val(s.by):1;
        if(st!==0){
          for(let n=a; st>0? n<=b : n>=b; n+=st){
            if(--budget<0) throw new Error('scan budget exceeded — a real PLC watchdog would fault here');
            env[s.v]=n; walk(s.body);
          }
        }
      }
      else if(s.k==='while'){
        while(truthy(val(s.cond))){
          if(--budget<0) throw new Error('scan budget exceeded — a real PLC watchdog would fault here');
          walk(s.body);
        }
      }
    }
  })(prog);
  return env;
}


export {esc,pnum,lex,parseTimeLiteral,KW,FUNCS,FB,PLAINTYPES,parse,collectTargets,flatten,exprToST,parseExprText,fbCallToST,unparseStmt,orTerms,toSeries,guardsToNet,seriesToExpr,pruneNet,netAt,buildModel,isBoolExpr,blocks,contactText,wrapGuards,modelToST,staleWarnings,scan,truthy,evalExpr,runFB,evaluate};
