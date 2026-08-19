function desktopPhraseTemplates(group,phraseId){
  let groupEntries=entries.slice(group.start,group.end),n=groupEntries.length,out=[],push=template=>{if(template)out.push(template)};
  if(n===1){
    let e=groupEntries[0],spans=e.target>125?[5,6,4]:e.target<42?[3,4,5]:[4,5,3];
    spans.forEach(span=>{
      push(finishTemplate(`solo-${span}-left`,phraseId,groupEntries,[{x:0,row:0,span}],span===6?12:0));
      if(span<6)push(finishTemplate(`solo-${span}-right`,phraseId,groupEntries,[{x:C-span,row:0,span}],0));
      if(span<=4){let x=Math.floor((C-span)/2);push(finishTemplate(`solo-${span}-center`,phraseId,groupEntries,[{x,row:0,span}],7))}
    })
  }
  if(n===2){
    let r0=rowsFor(groupEntries[0],3),r1=rowsFor(groupEntries[1],3),stagger=Math.max(2,Math.min(6,Math.round(Math.min(r0,r1)*.18)));
    push(finishTemplate('pair-3-3',phraseId,groupEntries,[{x:0,row:0,span:3},{x:3,row:0,span:3}],0));
    push(finishTemplate('pair-3-3-stagger-right',phraseId,groupEntries,[{x:0,row:0,span:3},{x:3,row:stagger,span:3}],1));
    push(finishTemplate('pair-3-3-stagger-left',phraseId,groupEntries,[{x:3,row:0,span:3},{x:0,row:stagger,span:3}],2));
    let large=groupEntries[0].target>=groupEntries[1].target?0:1;
    if(large===0){
      push(finishTemplate('pair-4-2',phraseId,groupEntries,[{x:0,row:0,span:4},{x:4,row:3,span:2}],2));
      push(finishTemplate('pair-4-2-mirror',phraseId,groupEntries,[{x:2,row:0,span:4},{x:0,row:3,span:2}],3))
    }else{
      push(finishTemplate('pair-2-4',phraseId,groupEntries,[{x:0,row:0,span:2},{x:2,row:3,span:4}],2));
      push(finishTemplate('pair-2-4-mirror',phraseId,groupEntries,[{x:4,row:0,span:2},{x:0,row:3,span:4}],3))
    }
  }
  if(n===3){
    let pairBottom=Math.max(rowsFor(groupEntries[0],3),rowsFor(groupEntries[1],3));
    push(finishTemplate('pair-then-wide-left',phraseId,groupEntries,[{x:0,row:0,span:3},{x:3,row:0,span:3},{x:0,row:pairBottom+3,span:4}],0));
    push(finishTemplate('pair-then-wide-right',phraseId,groupEntries,[{x:0,row:0,span:3},{x:3,row:0,span:3},{x:2,row:pairBottom+3,span:4}],0));
    let first4=rowsFor(groupEntries[0],4),second2=rowsFor(groupEntries[1],2);
    push(finishTemplate('lead-left-stack-right',phraseId,groupEntries,[{x:0,row:0,span:4},{x:4,row:0,span:2},{x:4,row:second2+3,span:2}],3));
    push(finishTemplate('lead-right-stack-left',phraseId,groupEntries,[{x:2,row:0,span:4},{x:0,row:3,span:2},{x:0,row:3+second2+3,span:2}],4));
    push(finishTemplate('triptych-step',phraseId,groupEntries,[{x:0,row:0,span:2},{x:2,row:2,span:2},{x:4,row:4,span:2}],8));
    push(finishTemplate('wide-then-pair',phraseId,groupEntries,[{x:0,row:0,span:4},{x:0,row:first4+3,span:3},{x:3,row:first4+3,span:3}],2))
  }
  if(n===4){
    let topBottom=Math.max(rowsFor(groupEntries[0],3),rowsFor(groupEntries[1],3));
    push(finishTemplate('quad-3-grid',phraseId,groupEntries,[{x:0,row:0,span:3},{x:3,row:0,span:3},{x:0,row:topBottom+3,span:3},{x:3,row:topBottom+3,span:3}],1));
    let r1=rowsFor(groupEntries[1],2),r2=rowsFor(groupEntries[2],2);
    push(finishTemplate('lead-plus-three',phraseId,groupEntries,[{x:0,row:0,span:4},{x:4,row:0,span:2},{x:4,row:r1+3,span:2},{x:4,row:r1+3+r2+3,span:2}],6));
    push(finishTemplate('lead-plus-three-mirror',phraseId,groupEntries,[{x:2,row:0,span:4},{x:0,row:3,span:2},{x:0,row:3+r1+3,span:2},{x:0,row:3+r1+3+r2+3,span:2}],7))
  }
  return out.sort((a,b)=>a.cost-b.cost).slice(0,12)
}

function mobileShort(entry){return layoutMinSpan(entry)<=3&&entry.chars<=340}

function mobileStackSpan(entry,index,wideFirst=true){
  let min=layoutMinSpan(entry),wide=index%2===0?wideFirst:!wideFirst,span;
  if(min>=5)span=wide?6:5;
  else if(min===4)span=wide?5:4;
  else span=wide?4:3;
  return clamp(Math.max(min,span),3,6)
}

function mobileSequentialSpecs(groupEntries,mirror=false,wideFirst=true){
  let row=0;
  return groupEntries.map((entry,index)=>{
    let span=mobileStackSpan(entry,index,wideFirst),right=(index%2===1)!==mirror,x=span===6?0:(right?C-span:0),spec={x,row,span};
    row+=rowsFor(entry,span)+3;
    return spec
  })
}

function mobilePhraseTemplates(group,phraseId){
  let groupEntries=entries.slice(group.start,group.end),n=groupEntries.length,out=[],push=template=>{if(template)out.push(template)};

  if(n===1){
    let entry=groupEntries[0],min=layoutMinSpan(entry),spans=min>=5?[6,5]:min===4?[5,4,6]:[4,3,5];
    spans.forEach((span,index)=>{
      push(finishTemplate(`mobile-solo-${span}-left`,phraseId,groupEntries,[{x:0,row:0,span}],index*1.5));
      if(span<6)push(finishTemplate(`mobile-solo-${span}-right`,phraseId,groupEntries,[{x:C-span,row:0,span}],index*1.5+.5))
    })
  }

  if(n===2){
    let a=groupEntries[0],b=groupEntries[1],shortA=mobileShort(a),shortB=mobileShort(b);
    if(shortA&&shortB){
      let stagger=Math.max(2,Math.min(5,Math.round(Math.min(rowsFor(a,3),rowsFor(b,3))*.16)));
      push(finishTemplate('mobile-pair-3-3',phraseId,groupEntries,[{x:0,row:0,span:3},{x:3,row:0,span:3}],0));
      push(finishTemplate('mobile-pair-3-3-stagger',phraseId,groupEntries,[{x:0,row:0,span:3},{x:3,row:stagger,span:3}],1));
      push(finishTemplate('mobile-pair-3-3-stagger-mirror',phraseId,groupEntries,[{x:3,row:0,span:3},{x:0,row:stagger,span:3}],2))
    }
    push(finishTemplate('mobile-stack-wide-left',phraseId,groupEntries,mobileSequentialSpecs(groupEntries,false,true),0));
    push(finishTemplate('mobile-stack-wide-right',phraseId,groupEntries,mobileSequentialSpecs(groupEntries,true,true),.5));
    push(finishTemplate('mobile-stack-offset-left',phraseId,groupEntries,mobileSequentialSpecs(groupEntries,false,false),1.5));
    push(finishTemplate('mobile-stack-offset-right',phraseId,groupEntries,mobileSequentialSpecs(groupEntries,true,false),2))
  }

  if(n===3){
    let short=groupEntries.map(mobileShort);
    push(finishTemplate('mobile-zigzag-3-left',phraseId,groupEntries,mobileSequentialSpecs(groupEntries,false,true),1));
    push(finishTemplate('mobile-zigzag-3-right',phraseId,groupEntries,mobileSequentialSpecs(groupEntries,true,true),1.5));
    push(finishTemplate('mobile-zigzag-3-narrow-left',phraseId,groupEntries,mobileSequentialSpecs(groupEntries,false,false),2));
    push(finishTemplate('mobile-zigzag-3-narrow-right',phraseId,groupEntries,mobileSequentialSpecs(groupEntries,true,false),2.5));

    if(short[0]&&short[1]){
      let pairBottom=Math.max(rowsFor(groupEntries[0],3),rowsFor(groupEntries[1],3)),thirdSpan=Math.max(layoutMinSpan(groupEntries[2]),layoutMinSpan(groupEntries[2])>=5?6:5);
      push(finishTemplate('mobile-pair-then-wide-left',phraseId,groupEntries,[{x:0,row:0,span:3},{x:3,row:0,span:3},{x:0,row:pairBottom+3,span:thirdSpan}],0));
      push(finishTemplate('mobile-pair-then-wide-right',phraseId,groupEntries,[{x:0,row:0,span:3},{x:3,row:0,span:3},{x:C-thirdSpan,row:pairBottom+3,span:thirdSpan}],.5))
    }
    if(short[1]&&short[2]){
      let firstSpan=Math.max(layoutMinSpan(groupEntries[0]),layoutMinSpan(groupEntries[0])>=5?6:5),pairRow=rowsFor(groupEntries[0],firstSpan)+3;
      push(finishTemplate('mobile-wide-then-pair-left',phraseId,groupEntries,[{x:0,row:0,span:firstSpan},{x:0,row:pairRow,span:3},{x:3,row:pairRow,span:3}],0));
      push(finishTemplate('mobile-wide-then-pair-right',phraseId,groupEntries,[{x:C-firstSpan,row:0,span:firstSpan},{x:0,row:pairRow,span:3},{x:3,row:pairRow,span:3}],.5))
    }
  }

  if(n===4){
    let short=groupEntries.map(mobileShort);
    push(finishTemplate('mobile-zigzag-4-left',phraseId,groupEntries,mobileSequentialSpecs(groupEntries,false,true),1));
    push(finishTemplate('mobile-zigzag-4-right',phraseId,groupEntries,mobileSequentialSpecs(groupEntries,true,true),1.5));
    push(finishTemplate('mobile-zigzag-4-narrow-left',phraseId,groupEntries,mobileSequentialSpecs(groupEntries,false,false),2));
    push(finishTemplate('mobile-zigzag-4-narrow-right',phraseId,groupEntries,mobileSequentialSpecs(groupEntries,true,false),2.5));

    if(short.every(Boolean)){
      let secondRow=Math.max(rowsFor(groupEntries[0],3),rowsFor(groupEntries[1],3))+3;
      push(finishTemplate('mobile-quad-short-grid',phraseId,groupEntries,[{x:0,row:0,span:3},{x:3,row:0,span:3},{x:0,row:secondRow,span:3},{x:3,row:secondRow,span:3}],0))
    }
    if(short[1]&&short[2]){
      let firstSpan=Math.max(layoutMinSpan(groupEntries[0]),layoutMinSpan(groupEntries[0])>=5?6:5),
          pairRow=rowsFor(groupEntries[0],firstSpan)+3,
          pairBottom=pairRow+Math.max(rowsFor(groupEntries[1],3),rowsFor(groupEntries[2],3)),
          lastSpan=Math.max(layoutMinSpan(groupEntries[3]),layoutMinSpan(groupEntries[3])>=5?5:4);
      push(finishTemplate('mobile-wide-pair-tail-left',phraseId,groupEntries,[{x:0,row:0,span:firstSpan},{x:0,row:pairRow,span:3},{x:3,row:pairRow,span:3},{x:0,row:pairBottom+3,span:lastSpan}],0));
      push(finishTemplate('mobile-wide-pair-tail-right',phraseId,groupEntries,[{x:C-firstSpan,row:0,span:firstSpan},{x:0,row:pairRow,span:3},{x:3,row:pairRow,span:3},{x:C-lastSpan,row:pairBottom+3,span:lastSpan}],1))
    }
  }

  return out.sort((a,b)=>a.cost-b.cost).slice(0,14)
}

function phraseTemplates(group,phraseId){
  return isMobileLayout()?mobilePhraseTemplates(group,phraseId):desktopPhraseTemplates(group,phraseId)
}

function phraseAxisForPlacement(first){
  let center=first.x+first.span/2;
  if(first.x===0&&center<3)return'left';
  if(first.x+first.span===C&&center>3)return'right';
  return'center'
}

function shiftTemplate(template,baseRow){
  return template.ps.map(p=>{
    let shifted={...p,row:p.row+baseRow,shape:{...p.shape}},entry=entries.find(e=>e.id===p.id);
    if(entry)shifted.shape.stability=stability(entry,shifted);
    return shifted
  })
}

function phraseLeadAxis(template){return phraseAxisForPlacement(template.ps[0])}

function partialBalanceCost(ps){
  let left=0,right=0;
  ps.forEach(p=>{
    let leftSpan=Math.max(0,Math.min(p.x+p.span,3)-Math.max(p.x,0)),
        rightSpan=Math.max(0,Math.min(p.x+p.span,6)-Math.max(p.x,3));
    left+=leftSpan*p.rows;
    right+=rightSpan*p.rows
  });
  let total=left+right;
  if(!total)return 0;
  let imbalance=Math.abs(left-right)/total,threshold=isMobileLayout()?.22:.18;
  return imbalance>threshold?(imbalance-threshold)*(isMobileLayout()?48:58):0
}

function phraseContextCost(template,state,startBoundary){
  let cost=0,axis=phraseLeadAxis(template),history=state.phrases||[],last=history.at(-1),before=history.at(-2);
  if(last){
    if(last.axis===axis)cost+=startBoundary<.35?2:9+startBoundary*9;
    if(before&&before.axis===axis&&last.axis===axis)cost+=24;
    if(last.template===template.name)cost+=8
  }
  let shifted=shiftTemplate(template,state.bottom),combined=[...state.ps,...shifted];
  cost+=partialBalanceCost(combined);
  return cost
}

function phraseGapChoices(signal,isFirst){
  if(isFirst)return[0];
  let base=Math.round((isMobileLayout()?2:3)+signal.breakStrength*(isMobileLayout()?6:8)),
      values=[base-2,base,base+2].map(value=>clamp(value,2,isMobileLayout()?10:13));
  return[...new Set(values)]
}

function cheapStateScore(state){
  let count=Math.max(1,state.phrases.length),area=0,shape=0,editorial=0,move=0;
  state.ps.forEach((p,index)=>{
    let e=entries[index],target=layoutTargetFor(e);
    area+=Math.abs(p.span*p.rows-target)/target*100;
    shape+=p.shape.intrinsic||0;
    editorial+=p.shape.editorial||0;
    move+=p.shape.stability||0
  });
  return state.rawCost/count+.2*shape/state.ps.length+.16*editorial/state.ps.length+.12*area/state.ps.length+.08*move/state.ps.length
}

function layoutStatesForPartition(partition,signals){
  let beam=[{groupIndex:0,ps:[],phrases:[],bottom:0,rawCost:partition.cost}];
  while(beam.some(state=>state.groupIndex<partition.groups.length)){
    let next=[];
    for(let state of beam){
      if(state.groupIndex>=partition.groups.length){next.push(state);continue}
      let phraseIndex=state.groupIndex,group=partition.groups[phraseIndex],templates=phraseTemplates(group,phraseIndex),signal=signals[group.start]||{breakStrength:1};
      for(let template of templates){
        for(let gap of phraseGapChoices(signal,phraseIndex===0)){
          let baseRow=phraseIndex===0?0:state.bottom+gap,
              shifted=shiftTemplate(template,baseRow),
              axis=phraseLeadAxis(template),
              contextCost=phraseContextCost(template,state,signal.breakStrength),
              phrase={id:phraseIndex,start:group.start,end:group.end,template:template.name,axis,row:baseRow,height:template.height,gap,cost:template.cost+contextCost};
          let candidate={
            groupIndex:phraseIndex+1,
            ps:[...state.ps,...shifted],
            phrases:[...state.phrases,phrase],
            bottom:Math.max(state.bottom,baseRow+template.height),
            rawCost:state.rawCost+template.cost+contextCost+gap*.08
          };
          candidate.cheap=cheapStateScore(candidate);
          next.push(candidate)
        }
      }
    }
    beam=next.sort((a,b)=>a.cheap-b.cheap).slice(0,LAYOUT_BEAM_WIDTH)
  }
  return beam.filter(state=>state.groupIndex===partition.groups.length)
}
