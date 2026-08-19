const PHRASE_MAX_ENTRIES=4;
const PHRASE_BEAM_WIDTH=48;
const LAYOUT_BEAM_WIDTH=72;
const MAX_PARTITIONS=10;

function rowsFor(e,span){return Math.max(4,Math.round(layoutTargetFor(e)/span))}
function overlap(a,b){return!(a.x+a.span<=b.x||b.x+b.span<=a.x||a.row+a.rows<=b.row||b.row+b.rows<=a.row)}
function layoutBottom(ps){return ps.reduce((m,p)=>Math.max(m,p.row+p.rows),0)}
function intersect(p,a,b){return Math.max(0,Math.min(p.row+p.rows,b)-Math.max(p.row,a))}

function intrinsic(e,p){
  let gutter=layoutGutter(),
      width=Math.max(isMobileLayout()?318:360,$('layout').clientWidth||(isMobileLayout()?358:720)),
      cw=(width-gutter*5)/6,
      px=cw*p.span+gutter*(p.span-1),
      hp=p.rows*U,
      cjkCount=(String(e.body||'').match(/[\u3400-\u9fff\uf900-\ufaff]/g)||[]).length,
      cjkRatio=e.chars?cjkCount/e.chars:0,
      glyphWidth=cjkRatio>.25?(isMobileLayout()?14.2:13.6):7.15,
      cpl=Math.max(4,px/glyphWidth),
      range=layoutLineMeasureRange(e),
      linePx=isMobileLayout()?22:20,
      overhead=isMobileLayout()?24:20,
      lineCount=Math.max(2,Math.floor((hp-overhead-(e.cue?34:0))/linePx)),
      cap=Math.max(1,cpl*lineCount),
      fill=Math.min(1,e.chars/cap),
      lineCost=cpl<range[0]?(range[0]-cpl)*2.15:cpl>range[1]?(cpl-range[1])*1.45:0,
      fillCost=fill<.42?(.42-fill)*175:fill<.62?(.62-fill)*24:0,
      aspect=px/hp,
      minAspect=isMobileLayout()?.34:.58,
      maxAspect=isMobileLayout()?4.8:5.6,
      aspectCost=aspect<minAspect?(minAspect-aspect)*42:aspect>maxAspect?(aspect-maxAspect)*9:0;
  return{cost:clamp(lineCost+fillCost+aspectCost,0,100),fill,cpl,aspect}
}

function stability(e,p){
  let q=previous.get(e.id);
  if(!q)return 0;
  return clamp(Math.abs(q.x-p.x)*11+Math.abs(q.row-p.row)*.65+Math.abs(q.span-p.span)*8,0,100)
}

function normalizeForRelation(text){
  return String(text||'')
    .toLowerCase()
    .replace(/v\s*\d+(?:\.\d+){0,2}/gi,' ')
    .replace(/[\d\s\p{P}\p{S}]+/gu,'')
    .slice(0,1400)
}

function relationTokens(text){
  let normalized=normalizeForRelation(text),tokens=new Set(),latin=String(text||'').toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g)||[];
  latin.slice(0,120).forEach(token=>tokens.add(`w:${token}`));
  let cjk=normalized.match(/[\u3400-\u9fff\uf900-\ufaff]+/g)||[];
  cjk.forEach(run=>{
    for(let i=0;i<run.length-1&&tokens.size<420;i++)tokens.add(`c:${run.slice(i,i+2)}`)
  });
  return tokens
}

function setOverlapRatio(a,b){
  if(!a.size||!b.size)return 0;
  let hit=0;
  a.forEach(value=>{if(b.has(value))hit++});
  return hit/Math.max(1,Math.min(a.size,b.size))
}

function lexicalContinuity(a,b){
  if(!a||!b)return 0;
  let score=setOverlapRatio(relationTokens(a.body),relationTokens(b.body));
  let ah=normalizeForRelation(a.body.slice(0,120)),bh=normalizeForRelation(b.body.slice(0,120));
  if(ah&&bh){
    let prefix=0,limit=Math.min(ah.length,bh.length,28);
    while(prefix<limit&&ah[prefix]===bh[prefix])prefix++;
    score+=clamp(prefix/24,0,.28)
  }
  return clamp(score,0,1)
}

function boundarySignal(index){
  if(index<=0||index>=entries.length)return{breakStrength:1,continuity:0,topicShift:1,lexical:0,hardBreak:true,hardJoin:false};
  let prev=entries[index-1],entry=entries[index],m=editorialValue(entry),lexical=lexicalContinuity(prev,entry),
      continuity=m?clamp(.68*m.continuity+.32*lexical,0,1):lexical,
      topicShift=m?clamp(.72*m.topicShift+.28*(1-lexical),0,1):1-lexical,
      dep=m?.dependency||'standalone',fn=m?.function||'neutral',
      strength=.5*topicShift+.36*(1-continuity)+.14*(1-lexical);

  if(dep==='dependsOnPrevious')strength-=.42;
  if(dep==='refersToNearby')strength-=.2;
  if(fn==='continuation'||fn==='response')strength-=.12;
  if(fn==='newThought')strength+=.28;
  if(prev.provenance==='collected'&&entry.provenance==='collected'&&lexical>.34)strength-=.2;
  if(prev.provenance!==entry.provenance&&dep==='standalone'&&continuity<.45)strength+=.08;
  strength=clamp(strength,0,1);
  return{
    breakStrength:strength,
    continuity,
    topicShift,
    lexical,
    hardBreak:strength>.77&&dep!=='dependsOnPrevious',
    hardJoin:strength<.2||dep==='dependsOnPrevious'
  }
}

function boundarySignals(){
  return entries.map((_,index)=>boundarySignal(index))
}

function phraseSegmentCost(start,end,signals){
  let len=end-start,cost=0;
  for(let i=start+1;i<end;i++){
    let b=signals[i];
    cost+=b.breakStrength*34;
    if(b.hardBreak)cost+=40;
  }
  if(start>0){
    let b=signals[start];
    cost+=(1-b.breakStrength)*28;
    if(b.hardJoin)cost+=30
  }
  let before=start>0?signals[start].breakStrength:1,
      after=end<entries.length?signals[end].breakStrength:1;
  if(len===1){
    let isolation=Math.max(before,after);
    cost+=(1-isolation)*15
  }
  if(len===3)cost+=1.5;
  if(len===4)cost+=6;
  let total=entries.slice(start,end).reduce((sum,e)=>sum+e.target,0);
  if(total>300)cost+=(total-300)*.16;
  if(total<42&&len>1)cost+=(42-total)*.2;
  return cost
}

function phrasePartitions(signals){
  let beam=[{index:0,groups:[],cost:0}];
  while(beam.some(state=>state.index<entries.length)){
    let next=[];
    for(let state of beam){
      if(state.index>=entries.length){next.push(state);continue}
      for(let len=1;len<=PHRASE_MAX_ENTRIES&&state.index+len<=entries.length;len++){
        let end=state.index+len;
        if(len>1&&signals.slice(state.index+1,end).some(signal=>signal.hardBreak))continue;
        next.push({
          index:end,
          groups:[...state.groups,{start:state.index,end}],
          cost:state.cost+phraseSegmentCost(state.index,end,signals)
        })
      }
    }
    beam=next.sort((a,b)=>a.cost-b.cost).slice(0,PHRASE_BEAM_WIDTH)
  }
  let unique=new Map();
  beam.filter(state=>state.index===entries.length).forEach(state=>{
    let key=state.groups.map(group=>group.end-group.start).join('-');
    if(!unique.has(key)||state.cost<unique.get(key).cost)unique.set(key,state)
  });
  return[...unique.values()].sort((a,b)=>a.cost-b.cost).slice(0,MAX_PARTITIONS)
}

function roleSpanCost(e,span,phraseSize){
  let m=editorialValue(e),fn=m?.function||'neutral',prefs;
  if(isMobileLayout()){
    prefs={
      referenceMaterial:[6,5],
      background:[5,4],
      fragment:[3,4],
      continuation:[4,3,5],
      response:[3,4,5],
      newThought:[5,4,6],
      neutral:[4,5]
    }[fn]||[4,5]
  }else{
    prefs={
      referenceMaterial:phraseSize>1?[3,4,5]:[4,5],
      background:[2,3,4],
      fragment:[2,3],
      continuation:[2,3,4],
      response:[2,3,4],
      newThought:[4,5,6],
      neutral:[3,4]
    }[fn]||[3,4]
  }
  let cost=Math.min(...prefs.map(value=>Math.abs(value-span)))*9;
  if(isMobileLayout()&&span<layoutMinSpan(e))cost+=100+(layoutMinSpan(e)-span)*30;
  return cost
}

function makeLocalPlacement(entry,index,x,row,span,phraseId,templateName,phraseSize){
  let p={id:entry.id,x,row,span,rows:rowsFor(entry,span),phraseId,template:templateName};
  let a=intrinsic(entry,p);
  p.shape={
    intrinsic:a.cost,
    editorial:roleSpanCost(entry,span,phraseSize),
    context:0,
    stability:stability(entry,p),
    fill:a.fill,
    cpl:a.cpl,
    aspect:a.aspect,
    total:0
  };
  return p
}

function readOrderCost(ps){
  let cost=0;
  for(let i=1;i<ps.length;i++){
    let prev=ps[i-1],cur=ps[i];
    if(cur.row<prev.row)cost+=30+(prev.row-cur.row)*3;
    else if(cur.row===prev.row&&cur.x<prev.x)cost+=24+(prev.x-cur.x)*4
  }
  return cost
}

function templateGeometryCost(ps,groupEntries){
  let bottom=layoutBottom(ps),area=ps.reduce((sum,p)=>sum+p.span*p.rows,0),density=area/Math.max(1,C*bottom),cost=0,
      bottomLimit=isMobileLayout()?170:84;
  if(density<.43)cost+=(.43-density)*75;
  if(density>.92)cost+=(density-.92)*70;
  if(bottom>bottomLimit)cost+=(bottom-bottomLimit)*(isMobileLayout()?.18:.35);
  for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){
    let areaRatio=layoutTargetFor(groupEntries[i])/Math.max(1,layoutTargetFor(groupEntries[j])),spanRatio=ps[i].span/ps[j].span;
    if(areaRatio>1.45&&spanRatio<.82)cost+=(areaRatio-1.45)*12;
    if(areaRatio<.69&&spanRatio>1.22)cost+=(1/Math.max(areaRatio,.1)-1.45)*8
  }
  return cost+readOrderCost(ps)
}

function finishTemplate(name,phraseId,groupEntries,specs,baseCost=0){
  if(isMobileLayout()&&specs.some((spec,index)=>spec.span<layoutMinSpan(groupEntries[index])))return null;
  let ps=specs.map((spec,index)=>makeLocalPlacement(groupEntries[index],index,spec.x,spec.row,spec.span,phraseId,name,groupEntries.length));
  if(ps.some((p,i)=>ps.some((q,j)=>i!==j&&overlap(p,q))))return null;
  let geometry=templateGeometryCost(ps,groupEntries),intrinsicCost=mean(ps.map(p=>p.shape.intrinsic)),roleCost=mean(ps.map(p=>p.shape.editorial));
  return{name,ps,height:layoutBottom(ps),cost:baseCost+geometry+.55*intrinsicCost+.55*roleCost}
}
