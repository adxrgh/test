const PHRASE_MAX_ENTRIES=4;
const PHRASE_BEAM_WIDTH=48;
const LAYOUT_BEAM_WIDTH=72;
const MAX_PARTITIONS=10;

function rowsFor(e,span){return Math.max(4,Math.round(e.target/span))}
function overlap(a,b){return!(a.x+a.span<=b.x||b.x+b.span<=a.x||a.row+a.rows<=b.row||b.row+b.rows<=a.row)}
function layoutBottom(ps){return ps.reduce((m,p)=>Math.max(m,p.row+p.rows),0)}
function intersect(p,a,b){return Math.max(0,Math.min(p.row+p.rows,b)-Math.max(p.row,a))}

function intrinsic(e,p){
  let width=Math.max(360,$('layout').clientWidth||720),
      cw=(width-G*5)/6,
      px=cw*p.span+G*(p.span-1),
      hp=p.rows*U,
      cpl=Math.max(8,px/7.15),
      lineCount=Math.max(2,Math.floor((hp-20-(e.cue?34:0))/20)),
      cap=Math.max(1,cpl*lineCount),
      fill=Math.min(1,e.chars/cap),
      lineCost=cpl<30?(30-cpl)*2.1:cpl>76?(cpl-76)*1.45:0,
      fillCost=fill<.5?(.5-fill)*175:fill<.68?(.68-fill)*25:0,
      aspect=px/hp,
      aspectCost=aspect<.58?(.58-aspect)*38:aspect>5.6?(aspect-5.6)*9:0;
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
  let m=editorialValue(e),fn=m?.function||'neutral',prefs={
    referenceMaterial:phraseSize>1?[3,4,5]:[4,5],
    background:[2,3,4],
    fragment:[2,3],
    continuation:[2,3,4],
    response:[2,3,4],
    newThought:[4,5,6],
    neutral:[3,4]
  }[fn]||[3,4];
  return Math.min(...prefs.map(value=>Math.abs(value-span)))*9
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
  let bottom=layoutBottom(ps),area=ps.reduce((sum,p)=>sum+p.span*p.rows,0),density=area/Math.max(1,C*bottom),cost=0;
  if(density<.43)cost+=(.43-density)*75;
  if(density>.9)cost+=(density-.9)*85;
  if(bottom>84)cost+=(bottom-84)*.35;
  for(let i=0;i<ps.length;i++)for(let j=i+1;j<ps.length;j++){
    let areaRatio=groupEntries[i].target/Math.max(1,groupEntries[j].target),spanRatio=ps[i].span/ps[j].span;
    if(areaRatio>1.45&&spanRatio<.82)cost+=(areaRatio-1.45)*12;
    if(areaRatio<.69&&spanRatio>1.22)cost+=(1/Math.max(areaRatio,.1)-1.45)*8
  }
  return cost+readOrderCost(ps)
}

function finishTemplate(name,phraseId,groupEntries,specs,baseCost=0){
  let ps=specs.map((spec,index)=>makeLocalPlacement(groupEntries[index],index,spec.x,spec.row,spec.span,phraseId,name,groupEntries.length));
  if(ps.some((p,i)=>ps.some((q,j)=>i!==j&&overlap(p,q))))return null;
  let geometry=templateGeometryCost(ps,groupEntries),intrinsicCost=mean(ps.map(p=>p.shape.intrinsic)),roleCost=mean(ps.map(p=>p.shape.editorial));
  return{name,ps,height:layoutBottom(ps),cost:baseCost+geometry+.55*intrinsicCost+.55*roleCost}
}
