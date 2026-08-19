function viewportRows(){
  let rows=Math.round((layoutViewportHeight()-84)/U);
  return clamp(rows,isMobileLayout()?80:54,isMobileLayout()?104:96)
}
function windowStarts(ps,V){
  let max=Math.max(...ps.map(p=>p.row+p.rows)),last=Math.max(0,max-V),step=Math.max(12,Math.round(V/4)),set=new Set([0,last]);
  for(let s=0;s<=last;s+=step)set.add(clamp(Math.round(s),0,last));
  ps.forEach(p=>[p.row,p.row+p.rows,p.row-V,p.row+p.rows-V].forEach(s=>set.add(clamp(Math.round(s),0,last))));
  return[...set].sort((a,b)=>a-b)
}

function viewportGrid(ps,start,V){
  let grid=Array.from({length:V},()=>Array(C).fill(0));
  ps.forEach(p=>{
    let y0=Math.max(start,p.row),y1=Math.min(start+V,p.row+p.rows);
    for(let y=y0;y<y1;y++)for(let x=p.x;x<p.x+p.span;x++)grid[y-start][x]=1
  });
  return grid
}

function corridorBalance(grid){
  let V=grid.length,total=V*C,colOcc=Array(C).fill(0),left=0,right=0;
  for(let y=0;y<V;y++)for(let x=0;x<C;x++){
    if(!grid[y][x])continue;
    colOcc[x]++;
    if(x<3)left++;else right++
  }
  let occupied=left+right,imbalance=occupied?Math.abs(left-right)/occupied:1,
      leftOuter=(colOcc[0]+colOcc[1])/(2*V),rightOuter=(colOcc[4]+colOcc[5])/(2*V),
      middle=(colOcc[2]+colOcc[3])/(2*V),corridor=0,
      outerFloor=isMobileLayout()?.09:.12,
      balanceLimit=isMobileLayout()?.24:.2;
  if(occupied/total>.2){
    if(leftOuter<outerFloor&&(rightOuter>.34||middle>.42))corridor+=(outerFloor-leftOuter)*(isMobileLayout()?145:180);
    if(rightOuter<outerFloor&&(leftOuter>.34||middle>.42))corridor+=(outerFloor-rightOuter)*(isMobileLayout()?145:180)
  }
  let balance=imbalance>balanceLimit?(imbalance-balanceLimit)*(isMobileLayout()?92:110):0;
  return{cost:clamp(corridor+balance,0,100),corridor:clamp(corridor,0,100),balance:clamp(balance,0,100),imbalance,leftOuter,rightOuter}
}

function whiteField(ps,start,V){
  let g=viewportGrid(ps,start,V),seen=Array.from({length:V},()=>Array(C).fill(false)),comps=[],dirs=[[1,0],[-1,0],[0,1],[0,-1]];
  for(let y=0;y<V;y++)for(let x=0;x<C;x++){
    if(g[y][x]||seen[y][x])continue;
    let q=[[x,y]],k=0,cells=[],minx=x,maxx=x,miny=y,maxy=y;
    seen[y][x]=true;
    while(k<q.length){
      let[cx,cy]=q[k++];cells.push([cx,cy]);minx=Math.min(minx,cx);maxx=Math.max(maxx,cx);miny=Math.min(miny,cy);maxy=Math.max(maxy,cy);
      dirs.forEach(([dx,dy])=>{let nx=cx+dx,ny=cy+dy;if(nx>=0&&nx<C&&ny>=0&&ny<V&&!g[ny][nx]&&!seen[ny][nx]){seen[ny][nx]=true;q.push([nx,ny])}})
    }
    let bw=maxx-minx+1,bh=maxy-miny+1,box=bw*bh;
    comps.push({area:cells.length,bw,bh,minx,maxx,miny,maxy,touchesSide:minx===0||maxx===C-1,ragged:box?1-cells.length/box:0})
  }
  comps.sort((a,b)=>b.area-a.area);
  let total=C*V,largest=comps[0]||{area:0,bw:0,bh:0,ragged:0},largestRatio=largest.area/total,
      small=comps.filter(c=>c.area/total<.025),slivers=comps.filter(c=>(c.bw===1&&c.bh>=V*.16)||(c.bh<=2&&c.bw>=3)),
      verticalCorridors=comps.filter(c=>c.touchesSide&&c.bw>=2&&c.bh>=V*.62&&c.area/total>.12),
      white=comps.reduce((sum,c)=>sum+c.area,0),occ=1-white/total,
      missing=largestRatio<.12?(.12-largestRatio)*150:largestRatio>.6?(largestRatio-.6)*60:0,
      fragment=small.length*4+Math.max(0,comps.length-6)*2.5,
      sliver=slivers.length*8,
      ragged=largest.ragged*18,
      occupancy=occ>.84?(occ-.84)*130:occ<(isMobileLayout()?.24:.28)?((isMobileLayout()?.24:.28)-occ)*45:0,
      corridor=verticalCorridors.reduce((sum,c)=>sum+12+(c.area/total-.12)*100,0),
      cb=corridorBalance(g),cost=clamp(missing+fragment+sliver+ragged+occupancy+corridor+cb.cost*.65,0,100);
  return{cost,largestRatio,components:comps.length,smallCount:small.length,sliverCount:slivers.length,occ,corridorCost:clamp(corridor+cb.corridor,0,100),balanceCost:cb.balance,imbalance:cb.imbalance}
}

function composition(ps,start,V){
  let visible=ps.map(p=>({p,m:intersect(p,start,start+V)*p.span})).filter(item=>item.m>0).sort((a,b)=>b.m-a.m);
  if(!visible.length)return 80;
  let cost=0,maxVisible=isMobileLayout()?4:5;
  if(visible.length>maxVisible)cost+=(visible.length-maxVisible)*9;
  if(visible.length>1){
    let ratio=visible[0].m/Math.max(1,visible[1].m);
    if(ratio<1.08)cost+=(1.08-ratio)*40;
    if(ratio>4.2)cost+=(ratio-4.2)*5
  }
  let axes=new Set(visible.map(item=>`${item.p.x}:${item.p.x+item.p.span}`));
  if(visible.length>=3&&axes.size===1)cost+=28;
  return clamp(cost,0,100)
}

function semanticCost(ps){
  let values=[];
  for(let i=1;i<ps.length;i++){
    let e=entries[i],m=editorialValue(e),signal=boundarySignal(i),p=ps[i],q=ps[i-1],samePhrase=p.phraseId===q.phraseId,
        verticalGap=Math.max(0,p.row-(q.row+q.rows)),sameAxis=p.x===q.x||p.x+p.span===q.x+q.span,cost=0;
    if(samePhrase){
      cost+=signal.breakStrength*24;
      if(signal.continuity>.6&&verticalGap>8)cost+=(verticalGap-8)*1.6;
      if(m?.dependency==='dependsOnPrevious'&&!sameAxis)cost+=8
    }else{
      cost+=(1-signal.breakStrength)*20;
      if(signal.topicShift>.68&&verticalGap<3)cost+=(3-verticalGap)*4
    }
    values.push(clamp(cost,0,100))
  }
  return mean(values)
}

function axisRepetitionCost(ps){
  let phrases=new Map();
  ps.forEach(p=>{if(!phrases.has(p.phraseId))phrases.set(p.phraseId,[]);phrases.get(p.phraseId).push(p)});
  let axes=[...phrases.values()].map(group=>phraseAxisForPlacement(group[0])),cost=0,run=1;
  for(let i=1;i<axes.length;i++){
    if(axes[i]===axes[i-1]){run++;if(run===2)cost+=4;if(run>2)cost+=18+(run-3)*8}else run=1
  }
  return clamp(cost,0,100)
}

function phraseGeometryCost(ps){
  let groups=new Map();
  ps.forEach(p=>{if(!groups.has(p.phraseId))groups.set(p.phraseId,[]);groups.get(p.phraseId).push(p)});
  let costs=[];
  groups.forEach(group=>{
    if(group.length<2)return;
    let minX=Math.min(...group.map(p=>p.x)),maxX=Math.max(...group.map(p=>p.x+p.span)),coverage=maxX-minX,cost=0,
        minimumCoverage=isMobileLayout()?5:6;
    if(coverage<minimumCoverage)cost+=(minimumCoverage-coverage)*12;
    let uniqueAxes=new Set(group.map(p=>`${p.x}:${p.x+p.span}`));
    if(uniqueAxes.size<2)cost+=20;
    costs.push(cost)
  });
  return mean(costs)
}

function rolling(ps){
  let V=viewportRows(),wins=windowStarts(ps,V).map(start=>{
    let wf=whiteField(ps,start,V),comp=composition(ps,start,V),cost=.46*wf.cost+.32*comp+.22*Math.max(wf.corridorCost,wf.balanceCost);
    return{start,V,wf,comp,cost}
  }),costs=wins.map(win=>win.cost),p90=pct(costs,.9),avg=mean(costs),max=Math.max(0,...costs),roll=.48*p90+.32*avg+.2*max,worst=wins.reduce((a,b)=>!a||b.cost>a.cost?b:a,null);
  return{cost:roll,p90,mean:avg,max,worst,wins,whiteField:mean(wins.map(win=>win.wf.cost)),corridor:mean(wins.map(win=>win.wf.corridorCost)),balance:mean(wins.map(win=>win.wf.balanceCost))}
}

function metrics(ps,full=true){
  let area=0,shape=0,move=0,editorial=0;
  ps.forEach((p,index)=>{
    let e=entries[index],a=p.span*p.rows,target=layoutTargetFor(e);
    area+=Math.abs(a-target)/target*100;
    shape+=p.shape?.intrinsic||0;
    editorial+=p.shape?.editorial||0;
    let q=previous.get(p.id);
    if(q)move+=Math.abs(q.x-p.x)*8+Math.abs(q.row-p.row)*.8+Math.abs(q.span-p.span)*4
  });
  let r=full?rolling(ps):{cost:0,whiteField:0,wins:[],worst:null,p90:0,mean:0,max:0,corridor:0,balance:0},
      editorialGlobal=axisRepetitionCost(ps)+phraseGeometryCost(ps);
  return{m:{
    shape:shape/ps.length,
    editorial:clamp(editorial/ps.length+editorialGlobal,0,100),
    semantic:semanticCost(ps),
    area:area/ps.length,
    whiteField:r.whiteField,
    rolling:clamp(r.cost+.2*r.corridor+.15*r.balance,0,100),
    move:move/ps.length
  },diag:r}
}

function score(m){
  let total=0,weight=0;
  Object.keys(W).forEach(key=>{total+=(m[key]||0)*W[key];weight+=W[key]});
  return total/weight
}

function emergencyLayout(){
  let ps=[],row=0;
  entries.forEach((e,index)=>{
    let span,x;
    if(isMobileLayout()){
      span=index%2===0?6:Math.max(5,layoutMinSpan(e));
      x=span===6?0:(index%4===1?C-span:0)
    }else{
      span=index%2===0?4:3;
      x=index%2===0?0:3
    }
    let p=makeLocalPlacement(e,index,x,row,span,index,`emergency-${layoutProfileKey()}`,1);
    ps.push(p);row+=p.rows+4
  });
  return{ps,phrases:ps.map((p,index)=>({id:index,start:index,end:index+1,template:`emergency-${layoutProfileKey()}`,axis:p.x?'right':'left',row:p.row,height:p.rows,gap:4,cost:50})),rawCost:100}
}

function activeDatasetSignature(){return `${layoutProfileKey()}|`+entries.map((e,index)=>`${e.externalId||e.id||index}:${e.digest}`).join('|')}

function candidateSignature(state){return `${layoutProfileKey()}|`+state.ps.map(p=>`${p.x},${p.row},${p.span},${p.rows}`).join('|')}

function generate(){
  window.TypeBlockLayoutProfile?.applyDom?.();
  if(!entries.length){candidates=[];selected=0;renderAll();return}
  let signature=activeDatasetSignature(),signals=boundarySignals(),partitions=phrasePartitions(signals),states=[];
  partitions.forEach(partition=>states.push(...layoutStatesForPartition(partition,signals).slice(0,20)));
  if(!states.length)states=[emergencyLayout()];

  let unique=new Map();
  states.forEach(state=>{
    if(state.ps.length!==entries.length)return;
    let key=candidateSignature(state),computed=metrics(state.ps,true),candidate={
      ...state,m:computed.m,diag:computed.diag,s:score(computed.m)+state.rawCost/Math.max(1,entries.length)*.035,datasetSignature:signature,
      phraseCount:state.phrases?.length||new Set(state.ps.map(p=>p.phraseId)).size,
      layoutProfile:layoutProfileKey()
    };
    if(!unique.has(key)||candidate.s<unique.get(key).s)unique.set(key,candidate)
  });
  let ranked=[...unique.values()].sort((a,b)=>a.s-b.s),byStructure=new Map();
  ranked.forEach(candidate=>{
    let key=(candidate.phrases||[]).map(phrase=>`${phrase.end-phrase.start}:${phrase.template}:${phrase.axis}`).join('|');
    if(!byStructure.has(key))byStructure.set(key,candidate)
  });
  candidates=[...byStructure.values()].sort((a,b)=>a.s-b.s).slice(0,8);
  if(candidates.length<8){
    let seen=new Set(candidates.map(candidate=>candidateSignature(candidate))),rest=ranked.filter(candidate=>!seen.has(candidateSignature(candidate)));
    candidates.push(...rest.slice(0,8-candidates.length))
  }
  if(!candidates.length){
    let emergency=emergencyLayout(),computed=metrics(emergency.ps,true);
    candidates=[{...emergency,m:computed.m,diag:computed.diag,s:score(computed.m),datasetSignature:signature,phraseCount:emergency.phrases.length,layoutProfile:layoutProfileKey()}]
  }
  selected=0;
  renderAll()
}

function dominant(ps){
  let ids=new Set,V=viewportRows();
  windowStarts(ps,V).forEach(start=>{
    let visible=ps.map(p=>({p,m:intersect(p,start,start+V)*p.span})).filter(item=>item.m>0).sort((a,b)=>b.m-a.m);
    if(visible[0]&&(visible.length===1||visible[0].m/(visible[1]?.m||1)>1.2))ids.add(visible[0].p.id)
  });
  return ids
}
