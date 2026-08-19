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
  L.querySelectorAll('.block,.worstband,.layout-message,.viewport-cut').forEach(n=>n.remove());
  $('cands').innerHTML='';
  $('stats').textContent=''
}
function profileLabel(){return window.TypeBlockLayoutProfile?.active?.().label||'Desktop'}
function renderViewportCuts(L,totalRows){
  if(!isMobileLayout())return;
  let V=viewportRows(),totalPx=totalRows*U,index=2;
  for(let top=V*U;top<totalPx;top+=V*U){
    let line=document.createElement('div');
    line.className='viewport-cut';
    line.style.top=top+'px';
    line.innerHTML=`<span>VIEWPORT ${index}</span>`;
    L.appendChild(line);
    index++
  }
}
function renderLayout(){
  window.TypeBlockLayoutProfile?.applyDom?.();
  let L=$('layout');
  clearLayoutSurface(L);
  L.classList.toggle('showgrid',$('grid').checked);
  L.classList.toggle('bounds',$('bounds').checked);
  $('app').classList.toggle('clean',$('clean').checked);
  let gutter=layoutGutter();
  $('gridlines').style.gap=gutter+'px';

  if(!candidates.length){
    L.style.height=(isMobileLayout()?844:480)+'px';
    $('stageMeta').textContent=`${entries.length} Entries · ${profileLabel()} · ${mode.toUpperCase()} · no candidate`;
    let d=document.createElement('div');
    d.className='layout-message';
    d.textContent=entries.length
      ?'No legal layout candidate was produced. The previous dataset has been cleared from view.'
      :'No active dataset.';
    L.appendChild(d);
    $('stats').textContent=entries.length
      ?`profile: ${profileLabel()}\nlayout: no candidate\nstale canvas: cleared`
      :`profile: ${profileLabel()}\nlayout: empty`;
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

  let D=dominant(c.ps),totalRows=Math.max(...c.ps.map(p=>p.row+p.rows))+5,
      layoutWidth=Math.max(1,L.clientWidth),columnWidth=(layoutWidth-gutter*(C-1))/C;
  L.style.height=Math.max(totalRows*U,isMobileLayout()?844:820)+'px';
  c.ps.forEach((p,i)=>{
    let e=entries[i];
    if(!e)return;
    let d=document.createElement('article'),is=D.has(e.id),left=p.x*(columnWidth+gutter),width=p.span*columnWidth+(p.span-1)*gutter;
    d.className='block'+(is?' dom':'')+(focus===e.id?' focus':'')+(isMobileLayout()?' mobile-block':'');
    d.style.left=left+'px';
    d.style.width=width+'px';
    d.style.top=p.row*U+'px';
    d.style.height=p.rows*U+'px';
    let lp=is?(isMobileLayout()?24:24):(isMobileLayout()?22:20);
    let lines=Math.max(2,Math.floor((p.rows*U-($('clean').checked?8:26)-(e.cue?34:0))/lp));
    let m=e.editorial?.status==='ready'?e.editorial:null,
        phraseLabel=Number.isInteger(p.phraseId)?` · P${p.phraseId+1} · ${uiEscape(p.template||'phrase')}`:'';
    d.innerHTML=
      `<div class="meta">${e.chars.toLocaleString()} chars · ${p.span}×${p.rows} · intrinsic ${p.shape.intrinsic.toFixed(1)} · editorial ${p.shape.editorial.toFixed(1)}${m?` · ${uiEscape(m.function)}`:''}${phraseLabel}</div>`+
      `<div class="body" style="-webkit-line-clamp:${lines}">${uiEscape(e.body)}</div>`+
      `${e.cue?`<div class="cue">${uiEscape(e.cue)}</div>`:''}`+
      `<div class="seq">${String(e.id).padStart(2,'0')}</div>`+
      `<div class="source-mark ${uiEscape(e.provenance)}">${uiEscape(e.provenance)}</div>`;
    d.onclick=()=>{focus=e.id;renderLayout();renderEditorial()};
    L.appendChild(d)
  });
  renderViewportCuts(L,totalRows);
  if($('worst').checked&&c.diag?.worst){
    let q=c.diag.worst,d=document.createElement('div');
    d.className='worstband';
    d.style.top=q.start*U+'px';
    d.style.height=q.V*U+'px';
    d.innerHTML=`<span>WORST · ${q.cost.toFixed(1)}</span>`;
    L.appendChild(d)
  }
  let phraseCount=c.phraseCount||c.phrases?.length||new Set(c.ps.map(p=>p.phraseId)).size;
  $('stageMeta').textContent=`${entries.length} Entries · ${phraseCount} phrases · ${profileLabel()} · ${mode.toUpperCase()} · candidate ${selected+1}`;
  candidates.forEach((x,i)=>{
    let b=document.createElement('button'),count=x.phraseCount||x.phrases?.length||new Set(x.ps.map(p=>p.phraseId)).size;
    b.className='cand'+(i===selected?' on':'');
    b.textContent=`#${i+1} · ${x.s.toFixed(1)} · ${count}P`;
    b.onclick=()=>{selected=i;renderAll()};
    $('cands').appendChild(b)
  });
  let phraseSummary=(c.phrases||[]).map(phrase=>`${phrase.start+1}–${phrase.end} ${phrase.template}`).join(' | ');
  $('stats').textContent=
    `profile: ${profileLabel()} · gutter ${gutter}px · viewport ${viewportRows()} rows\n`+
    Object.entries(c.m).map(([k,v])=>`${k}: ${v.toFixed(1)} × ${W[k]}`).join('\n')+
    `\nscore: ${c.s.toFixed(2)}`+
    `\nphrases: ${phraseSummary||'—'}`
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
  let m=e.editorial,state=m?.status||'missing',usage=e.usage,cost=usage?(usage.actualUSD??usage.estimatedUSD??0):0,
      entryIndex=entries.indexOf(e),placement=candidates[selected]?.ps?.[entryIndex];
  $('editorialInspector').innerHTML=
    `<span class="tag ${uiEscape(state)}">${uiEscape(state.toUpperCase())}</span>`+
    `<span class="tag">${uiEscape(e.provenance.toUpperCase())}</span>`+
    `<div class="editorial-grid">`+
    `<span>Entry</span><b>${String(e.id).padStart(2,'0')}</b>`+
    `<span>Source ID</span><b>${uiEscape(e.externalId||'—')}</b>`+
    `<span>Profile</span><b>${uiEscape(profileLabel())}</b>`+
    `<span>Territory</span><b>${layoutTargetFor(e).toFixed(1)} cells</b>`+
    `<span>Minimum span</span><b>${layoutMinSpan(e)} / 6</b>`+
    `<span>Phrase</span><b>${Number.isInteger(placement?.phraseId)?'P'+(placement.phraseId+1):'—'}</b>`+
    `<span>Template</span><b>${uiEscape(placement?.template||'—')}</b>`+
    `<span>Frame</span><b>${placement?`${placement.x}:${placement.row} · ${placement.span}×${placement.rows}`:'—'}</b>`+
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
    $('rolling').innerHTML=`<span>Profile</span><b>${uiEscape(profileLabel())}</b><span>Status</span><b>No layout candidate</b>`;
    return
  }
  let d=candidates[selected].diag,q=d.worst;
  $('rolling').innerHTML=
    `<span>Profile</span><b>${uiEscape(profileLabel())}</b>`+
    `<span>Viewport</span><b>${layoutViewportHeight()} px / ${viewportRows()} rows</b>`+
    `<span>Viewports</span><b>${d.wins.length}</b>`+
    `<span>P90</span><b>${d.p90.toFixed(1)}</b>`+
    `<span>Mean</span><b>${d.mean.toFixed(1)}</b>`+
    `<span>Max</span><b>${d.max.toFixed(1)}</b>`+
    `<span>Worst row</span><b>${q?.start??'—'}</b>`+
    `<span>Primary white</span><b>${q?(q.wf.largestRatio*100).toFixed(0)+'%':'—'}</b>`+
    `<span>White fields</span><b>${q?.wf.components??'—'}</b>`+
    `<span>Corridor</span><b>${Number.isFinite(d.corridor)?d.corridor.toFixed(1):'—'}</b>`+
    `<span>Balance</span><b>${Number.isFinite(d.balance)?d.balance.toFixed(1):'—'}</b>`
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
function setLayoutProfile(id){
  if(!window.TypeBlockLayoutProfile?.profiles?.[id])return;
  window.TypeBlockLayoutProfile.set(id);
  previous=new Map();
  candidates=[];
  selected=0;
  requestAnimationFrame(()=>{
    void $('layout').offsetWidth;
    generate()
  })
}
document.querySelectorAll('.mode button').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
document.querySelectorAll('[data-layout-profile]').forEach(b=>b.onclick=()=>setLayoutProfile(b.dataset.layoutProfile));
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
addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{window.TypeBlockLayoutProfile?.applyDom?.();generate()},180)});
window.TypeBlockLayoutProfile?.applyDom?.();
if(!window.TYPEBLOCK_DEFERRED_BOOT){applyText(false);setMode('mock')}
