async function analyze(){
  if(mode==='off'){
    entries.forEach(e=>{e.editorial=null;e.usage=null});
    lastUsage=null;
    setStatus('<strong>OFF</strong> — editorial metadata disabled. Layout is deterministic only.');
    generate();
    return;
  }

  const todo=entries.filter(e=>!e.editorial||e.editorial.status==='stale'||e.editorial.status==='missing');
  if(!todo.length){
    setStatus('<strong>READY</strong> — nothing stale or missing.');
    return;
  }

  if(mode==='mock'){
    let input=0,output=0;
    todo.forEach(e=>{
      const i=entries.indexOf(e),inp=estimateTokens(analysisInputFor(e,i)),out=estimatedOutputTokens();
      input+=inp;output+=out;
      e.editorial=mockEditorial(e,i);
      e.usage={inputTokens:inp,cachedInputTokens:0,outputTokens:out,estimatedUSD:priceCost(inp,0,out),actualUSD:null,kind:'estimate'};
    });
    lastUsage={inputTokens:input,cachedInputTokens:0,outputTokens:output,cost:priceCost(input,0,output),kind:'estimate'};
    setStatus(`<strong>MOCK READY</strong> — ${todo.length} Entries analyzed locally. No API request.`);
    generate();
    return;
  }

  setStatus(`<strong>LIVE / OPENROUTER</strong> — sending ${todo.length} stale/missing Entries to the local backend…`);

  try{
    const endpoint=$('endpoint').value.trim()||'/api/editorial-scan';
    const payload={
      schemaVersion:1,
      items:todo.map(e=>{
        const i=entries.indexOf(e),prev=entries[i-1],next=entries[i+1];
        return {
          id:e.id,
          provenance:e.provenance,
          text:e.body,
          sourceDigest:e.digest,
          previous:prev?{id:prev.id,tail:prev.body.slice(-380)}:null,
          next:next?{id:next.id,head:next.body.slice(0,380)}:null
        };
      })
    };

    const r=await fetch(endpoint,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(payload)
    });
    const data=await r.json();
    if(!r.ok)throw new Error(data?.error||`HTTP ${r.status}`);

    const map=new Map((data.analyses||[]).map(x=>[x.id,x]));
    todo.forEach(e=>{
      const a=map.get(e.id);
      if(a)e.editorial={
        status:'ready',
        function:FUNCTIONS.includes(a.function)?a.function:'neutral',
        continuity:clamp(+a.continuity||0,0,1),
        dependency:['standalone','dependsOnPrevious','refersToNearby'].includes(a.dependency)?a.dependency:'standalone',
        topicShift:clamp(+a.topicShift||0,0,1),
        sourceDigest:e.digest,
        model:data.model||'openrouter',
        schemaVersion:1,
        analyzedAt:new Date().toISOString()
      };
    });

    const u=data.usage||{};
    const input=Number(u.input_tokens??u.prompt_tokens??0);
    const cached=Number(u.input_tokens_details?.cached_tokens??u.prompt_tokens_details?.cached_tokens??0);
    const output=Number(u.output_tokens??u.completion_tokens??0);
    const serverCost=Number(data?.cost?.usd);
    const cost=Number.isFinite(serverCost)?serverCost:priceCost(input,cached,output);

    lastUsage={inputTokens:input,cachedInputTokens:cached,outputTokens:output,cost,kind:'actual'};

    const weights=todo.map(e=>estimateTokens(analysisInputFor(e,entries.indexOf(e))));
    const totalWeight=weights.reduce((a,b)=>a+b,0)||1;
    todo.forEach((e,index)=>{
      const share=weights[index]/totalWeight;
      e.usage={
        inputTokens:Math.round(input*share),
        cachedInputTokens:Math.round(cached*share),
        outputTokens:Math.round(output*share),
        estimatedUSD:null,
        actualUSD:cost*share,
        kind:'actual'
      };
    });

    setStatus(`<strong>LIVE READY / OPENROUTER</strong> — ${todo.length} Entries analyzed · ${input.toLocaleString()} input · ${output.toLocaleString()} output · billed $${cost.toFixed(6)}.`);
    generate();
  }catch(err){
    setStatus(`<strong>LIVE FAILED</strong> — ${String(err.message||err)}`);
  }
}
