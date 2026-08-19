function uiEscape(value){
  return String(value??'')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'",'&#039;')
}
function renderAll(){renderLayout();renderLadder();renderCost();renderEditorial();renderRolling();renderWeights()}
function clearLayoutSurface(L){
  L.querySelectorAll('.block,.worstband,.layout-message').forEach(n=>n.remove());
  $('cands').innerHTML='';
  $('stats').textContent=''
}
function renderLayout(){
  let L=$('layout');
  clearLayoutSurface(L);
  L.classList.toggle('showgrid',$('grid').checked);
  L.classList.toggle('bounds',$('bounds').checked);
  $('app').classList.toggle('clean',$('clean').checked);

  if(!candidates.length){
    L.style.height='480px';
    $('stageMeta').textContent=`${entries.length} Entries · ${mode.toUpperCase()} · no candidate`;
    let d=document.createElement('div');
    d.className='layout-message';
    d.textContent=entries.length
      ?'No legal layout candidate was produced. The previous dataset has been cleared from view.'
      :'No active dataset.';
    L.appendChild(d);
    $('stats').textContent=entries.length
      ?'layout: no candidate\nstale canvas: cleared'
      :'layout: empty';
    return
  }

  let c=candidates[selected];
  let signature=typeof activeDatasetSignature==='function'?activeDatasetSignature():'';
  if(c.datasetSignature&&c.datasetSignature!==signature){
    candidates=[];
    selected=0;
    renderLayout();
    return
  }
  if(c.ps.length!==entries.length){
    candidates=[];
    selected=0;
    renderLayout();
    return
  }

  let D=dominant(c.ps);
  L.style.height=(Math.max(...c.ps.map(p=>p.row+p.rows))+5)*U+'px';
  c.ps.forEach((p,i)=>{
    let e=entries[i];
    if(!e)return;
    let d=document.createElement('article'),is=D.has(e.id);
    d.className='block'+(is?' dom':'')+(focus===e.id?' focus':'');
    d.style.left=`calc(${p.x/6*100}% + ${p.x?G/2:0}px)`;
    d.style.width=`calc(${p.span/6*100}% - ${p.x?G/2:0}px)`;
    d.style.top=p.row*U+'px';
    d.style.height=p.rows*U+'px';
    let lp=is?24:20;
    let lines=Math.max(2,Math.floor((p.rows*U-($('clean').checked?8:26)-(e.cue?34:0))/lp));
    let m=e.editorial?.status==='ready'?e.editorial:null;
    d.innerHTML=
      `<div class="meta">${e.chars.toLocaleString()} chars · ${p.span}×${p.rows} · intrinsic ${p.shape.intrinsic.toFixed(1)} · editorial ${p.shape.editorial.toFixed(1)}${m?` · ${uiEscape(m.function)}`:''}</div>`+
      `<div class="body" style="-webkit-line-clamp:${lines}">${uiEscape(e.body)}</div>`+
      `${e.cue?`<div class="cue">${uiEscape(e.cue)}</div>`:''}`+
      `<div class="seq">${String(e.id).padStart(2,'0')}</div>`+
      `<div class="source-mark ${uiEscape(e.provenance)}">${uiEscape(e.provenance)}</div>`;
    d.onclick=()=>{focus=e.id;renderLayout();renderEditorial()};
    L.appendChild(d)
  });
  if($('worst').checked&&c.diag?.worst){
    let q=c.diag.worst,d=document.createElement('div');
    d.className='worstband';
    d.style.top=q.start*U+'px';
    d.style.height=q.V*U+'px';
    d.innerHTML=`<span>WORST · ${q.cost.toFixed(1)}</span>`;
    L.appendChild(d)
  }
  $('stageMeta').textContent=`${entries.length} Entries · ${mode.toUpperCase()} · candidate ${selected+1}`;
  candidates.forEach((x,i)=>{
    let b=document.createElement('button');
    b.className='cand'+(i===selected?' on':'');
    b.textContent=`#${i+1} · ${x.s.toFixed(1)}`;
    b.onclick=()=>{selected=i;renderAll()};
    $('cands').appendChild(b)
  });
  $('stats').textContent=
    Object.entries(c.m).map(([k,v])=>`${k}: ${v.toFixed(1)} × ${W[k]}`).join('\n')+
    `\nscore: ${c.s.toFixed(2)}`
}
function renderLadder(){
  let h=$('ladder');
  h.innerHTML='';
  entries.forEach(e=>{
    let d=document.createElement('div'),state=e.editorial?.status||'missing';
    d.innerHTML=`<b>${String(e.id).padStart(2,'0')} · ${e.chars.toLocaleString()}</b>${uiEscape(e.provenance)} · ${uiEscape(state)}`;
    h.appendChild(d)
  })
}
function renderCost(){
  let pre=preflight(),
      spent=entries.reduce((s,e)=>s+(e.usage?.actualUSD??e.usage?.estimatedUSD??0),0),
      usedIn=entries.reduce((s,e)=>s+(e.usage?.inputTokens||0),0),
      usedOut=entries.reduce((s,e)=>s+(e.usage?.outputTokens||0),0),
      avg=entries.length?spent/entries.length:0,
      library100=avg?avg*100:(pre.count?pre.cost/pre.count*100:0),
      cached=entries.reduce((s,e)=>s+(e.usage?.cachedInputTokens||0),0);
  $('costLedger').innerHTML=
    `<span>Next scan</span><b>${pre.count} Entries</b>`+
    `<span>Preflight input</span><b>${pre.input.toLocaleString()} tok</b>`+
    `<span>Output cap</span><b>${pre.output.toLocaleString()} tok</b>`+
    `<span>Estimated next cost</span><b>$${pre.cost.toFixed(6)}</b>`+
    `<span>Recorded input</span><b>${usedIn.toLocaleString()}</b>`+
    `<span>Cached input</span><b>${cached.toLocaleString()}</b>`+
    `<span>Recorded output</span><b>${usedOut.toLocaleString()}</b>`+
    `<span>Recorded cost</span><b>$${spent.toFixed(6)}</b>`+
    `<span>100-entry projection</span><b>$${library100.toFixed(4)}</b>`
}
function renderEditorial(){
  let e=entries.find(x=>x.id===focus);
  if(!e){$('editorialInspector').innerHTML='Click a block.';return}
  let m=e.editorial,state=m?.status||'missing',usage=e.usage,cost=usage?(usage.actualUSD??usage.estimatedUSD??0):0;
  $('editorialInspector').innerHTML=
    `<span class="tag ${uiEscape(state)}">${uiEscape(state.toUpperCase())}</span>`+
    `<span class="tag">${uiEscape(e.provenance.toUpperCase())}</span>`+
    `<div class="editorial-grid">`+
    `<span>Entry</span><b>${String(e.id).padStart(2,'0')}</b>`+
    `<span>Source ID</span><b>${uiEscape(e.externalId||'—')}</b>`+
    `<span>Function</span><b>${uiEscape(m?.function||'—')}</b>`+
    `<span>Continuity</span><b>${m?.continuity?.toFixed?.(2)??'—'}</b>`+
    `<span>Dependency</span><b>${uiEscape(m?.dependency||'—')}</b>`+
    `<span>Topic shift</span><b>${m?.topicShift?.toFixed?.(2)??'—'}</b>`+
    `<span>Digest</span><b>${uiEscape(e.digest)}</b>`+
    `<span>Input tokens</span><b>${usage?.inputTokens?.toLocaleString?.()||'—'}</b>`+
    `<span>Output tokens</span><b>${usage?.outputTokens?.toLocaleString?.()||'—'}</b>`+
    `<span>Entry cost</span><b>${usage?'$'+cost.toFixed(6):'—'}</b>`+
    `</div>`
}
function renderRolling(){
  if(!candidates.length){
    $('rolling').innerHTML='<span>Status</span><b>No layout candidate</b>';
    return
  }
  let d=candidates[selected].diag,q=d.worst;
  $('rolling').innerHTML=
    `<span>Viewports</span><b>${d.wins.length}</b>`+
    `<span>P90</span><b>${d.p90.toFixed(1)}</b>`+
    `<span>Mean</span><b>${d.mean.toFixed(1)}</b>`+
    `<span>Max</span><b>${d.max.toFixed(1)}</b>`+
    `<span>Worst row</span><b>${q?.start??'—'}</b>`+
    `<span>Primary white</span><b>${q?(q.wf.largestRatio*100).toFixed(0)+'%':'—'}</b>`+
    `<span>White fields</span><b>${q?.wf.components??'—'}</b>`
}
let weightBuilt=false;
function renderWeights(){
  if(weightBuilt)return;
  weightBuilt=true;
  Object.keys(W).forEach(k=>{
    let l=document.createElement('label');
    l.className='w';
    l.innerHTML=`<span>${k}</span><input type="range" min="0" max="140" value="${W[k]}"><output>${W[k]}</output>`;
    let r=l.querySelector('input'),o=l.querySelector('output');
    r.oninput=()=>{W[k]=+r.value;o.value=r.value;generate()};
    $('weights').appendChild(l)
  })
}
function applyText(preserve=true){
  let current=preserve?candidates[selected]:null;
  previous=current?new Map(current.ps.map(p=>[p.id,p])):new Map();
  candidates=[];
  selected=0;
  entries=parse($('src').value);
  focus=entries.some(e=>e.id===focus)?focus:null;
  generate()
}
function setMode(v){
  mode=v;
  document.querySelectorAll('.mode button').forEach(b=>b.classList.toggle('on',b.dataset.mode===v));
  $('endpoint').classList.toggle('hidden',v!=='live');
  if(v==='off')setStatus('<strong>OFF</strong> — no editorial metadata will affect layout.');
  if(v==='mock')setStatus('<strong>MOCK</strong> — local deterministic editorial scan. No API call.');
  if(v==='live')setStatus('<strong>LIVE</strong> — calls the same-origin backend only. No key is stored in this page.');
  generate()
}
document.querySelectorAll('.mode button').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
$('analyze').onclick=analyze;
$('clearAnalysis').onclick=()=>{entries.forEach(e=>{e.editorial=null;e.usage=null});lastUsage=null;generate()};
$('apply').onclick=()=>applyText(true);
$('reset').onclick=()=>{$('src').value=SAMPLE;entries=[];candidates=[];applyText(false)};
$('clean').onchange=renderLayout;
$('grid').onchange=renderLayout;
$('bounds').onchange=renderLayout;
$('worst').onchange=renderLayout;
$('semantic').onchange=generate;
let resizeTimer;
addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(generate,180)});
if(!window.TYPEBLOCK_DEFERRED_BOOT){applyText(false);setMode('mock')}
