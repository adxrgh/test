const LIVE_CLIENT_BATCH_SIZE=2;
const LIVE_REQUEST_TIMEOUT_MS=120000;

function livePayloadFor(batch){
  return {
    schemaVersion:1,
    items:batch.map(e=>{
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
}

function liveChunks(items,size){
  const out=[];
  for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size));
  return out;
}

async function requestLiveBatch(batch){
  const endpoint=$('endpoint').value.trim()||'/api/editorial-scan';
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),LIVE_REQUEST_TIMEOUT_MS);
  let response;
  let raw='';

  try{
    response=await fetch(endpoint,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(livePayloadFor(batch)),
      signal:controller.signal
    });
    raw=await response.text();
  }catch(error){
    if(error?.name==='AbortError'){
      throw new Error(`Local backend timed out after ${Math.round(LIVE_REQUEST_TIMEOUT_MS/1000)} seconds.`);
    }
    throw error;
  }finally{
    clearTimeout(timeout);
  }

  let data={};
  if(raw){
    try{data=JSON.parse(raw)}catch{
      throw new Error(`Local backend returned non-JSON output (HTTP ${response.status}).`);
    }
  }
  if(!response.ok)throw new Error(data?.error||`HTTP ${response.status}`);

  const map=new Map((data.analyses||[]).map(x=>[x.id,x]));
  const missing=batch.filter(e=>!map.has(e.id));
  if(missing.length){
    throw new Error(`Backend omitted Entry ${missing.map(e=>e.id).join(', ')}.`);
  }

  batch.forEach(e=>{
    const a=map.get(e.id);
    e.editorial={
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

  const weights=batch.map(e=>estimateTokens(analysisInputFor(e,entries.indexOf(e))));
  const totalWeight=weights.reduce((a,b)=>a+b,0)||1;
  batch.forEach((e,index)=>{
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

  let saved=0;
  if(window.EditorialPersistence?.saveAnalyses){
    saved=await window.EditorialPersistence.saveAnalyses(batch);
  }

  return {input,cached,output,cost,saved};
}

async function analyze(){
  if(mode==='off'){
    entries.forEach(e=>{e.editorial=null;e.usage=null});
    lastUsage=null;
    setStatus('<strong>OFF</strong> — editorial metadata disabled. Layout is deterministic only.');
    generate();
    return {ok:true,processed:0};
  }

  const todo=entries.filter(e=>!e.editorial||e.editorial.status==='stale'||e.editorial.status==='missing');
  if(!todo.length){
    setStatus('<strong>READY</strong> — nothing stale or missing. Existing local analyses remain active.');
    return {ok:true,processed:0};
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
    return {ok:true,processed:todo.length};
  }

  const analyzeButton=$('analyze');
  if(analyzeButton)analyzeButton.disabled=true;
  const batches=liveChunks(todo,LIVE_CLIENT_BATCH_SIZE);
  const totals={input:0,cached:0,output:0,cost:0,saved:0,processed:0};

  try{
    for(let i=0;i<batches.length;i++){
      const batch=batches[i];
      const from=totals.processed+1;
      const to=totals.processed+batch.length;
      setStatus(
        `<strong>LIVE / OPENROUTER</strong> — batch ${i+1}/${batches.length}; `+
        `analyzing Entries ${from}–${to} of ${todo.length}. `+
        `${totals.saved} completed analyses already stored locally.`
      );

      const result=await requestLiveBatch(batch);
      totals.input+=result.input;
      totals.cached+=result.cached;
      totals.output+=result.output;
      totals.cost+=result.cost;
      totals.saved+=result.saved;
      totals.processed+=batch.length;
      lastUsage={
        inputTokens:totals.input,
        cachedInputTokens:totals.cached,
        outputTokens:totals.output,
        cost:totals.cost,
        kind:'actual'
      };

      generate();
      setStatus(
        `<strong>LIVE / OPENROUTER</strong> — ${totals.processed}/${todo.length} analyzed; `+
        `${totals.saved} stored locally. Continuing…`
      );
    }

    setStatus(
      `<strong>LIVE READY / OPENROUTER</strong> — ${totals.processed}/${todo.length} Entries analyzed · `+
      `${totals.input.toLocaleString()} input · ${totals.output.toLocaleString()} output · `+
      `billed $${totals.cost.toFixed(6)} · ${totals.saved} saved locally.`
    );
    generate();
    return {ok:true,processed:totals.processed,saved:totals.saved,persisted:true};
  }catch(err){
    const remaining=entries.filter(e=>!e.editorial||e.editorial.status==='stale'||e.editorial.status==='missing').length;
    setStatus(
      `<strong>LIVE PARTIAL / OPENROUTER</strong> — ${totals.processed}/${todo.length} completed and `+
      `${totals.saved} stored locally; ${remaining} remain. ${String(err.message||err)} `+
      `Click Analyze stale / missing to resume from the remaining Entries.`
    );
    generate();
    return {ok:false,processed:totals.processed,saved:totals.saved,persisted:true,error:String(err.message||err)};
  }finally{
    if(analyzeButton)analyzeButton.disabled=false;
  }
}
