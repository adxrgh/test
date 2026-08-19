const FUNCTIONS = [
  "referenceMaterial",
  "background",
  "fragment",
  "continuation",
  "response",
  "newThought",
  "neutral"
];

const DEPENDENCIES = [
  "standalone",
  "dependsOnPrevious",
  "refersToNearby"
];

const instructions = `You are TypeBlock's shallow editorial scanner.

The user's library is mainly a mixture of collected articles and casual authored notes. Do not perform deep reading, fact checking, argument evaluation, sentiment analysis, summarization, or importance ranking.

For each input Entry, return only four layout-oriented editorial signals:

1. function
- referenceMaterial: a largely self-contained collected article/material
- background: collected material acting as nearby context
- fragment: short authored note that is not clearly a continuation
- continuation: authored note continuing the immediately previous thought
- response: authored note reacting to nearby collected material or a prior item
- newThought: authored note that clearly opens a new local topic
- neutral: none of the above is sufficiently clear

2. continuity, 0..1
How strongly this Entry should remain spatially continuous with the immediately previous Entry. This is about editorial adjacency, not semantic similarity in the abstract.

3. dependency
- standalone
- dependsOnPrevious
- refersToNearby

4. topicShift, 0..1
How strongly the Entry marks a local context/topic break from the immediately previous Entry.

Rules:
- Do not judge which content is more important.
- Do not infer provenance; use the provided provenance field.
- Collected long-form material should usually remain self-contained unless context clearly says otherwise.
- Casual authored notes may be continuations, responses, fragments, or new thoughts.
- Use previous/next snippets only to resolve local relationships.
- Return exactly one analysis for every input item, preserving each integer id.
- Do not output prose outside the JSON schema.`;

function schemaFor(ids) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      analyses: {
        type: "array",
        minItems: ids.length,
        maxItems: ids.length,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "integer", enum: ids },
            function: { type: "string", enum: FUNCTIONS },
            continuity: { type: "number", minimum: 0, maximum: 1 },
            dependency: { type: "string", enum: DEPENDENCIES },
            topicShift: { type: "number", minimum: 0, maximum: 1 }
          },
          required: ["id", "function", "continuity", "dependency", "topicShift"]
        }
      }
    },
    required: ["analyses"]
  };
}

function extractChatContent(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (part?.type === "text" && typeof part.text === "string") return part.text;
      if (typeof part?.text === "string") return part.text;
      return "";
    }).join("");
  }
  return "";
}

function parseJsonLenient(text) {
  const raw = String(text || "").trim();
  const attempts = [
    raw,
    raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim()
  ];
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) attempts.push(raw.slice(first, last + 1));
  let lastError;
  for (const candidate of attempts) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch (error) { lastError = error; }
  }
  throw lastError || new Error("Invalid JSON");
}

function configuredPricing() {
  const num = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    input: num("OPENROUTER_INPUT_PRICE_PER_M", 0.25),
    cachedInput: num("OPENROUTER_CACHED_INPUT_PRICE_PER_M", 0.025),
    output: num("OPENROUTER_OUTPUT_PRICE_PER_M", 2.0)
  };
}

function requestTimeoutMs() {
  const configured = Number(process.env.OPENROUTER_REQUEST_TIMEOUT_MS || 90000);
  if (!Number.isFinite(configured)) return 90000;
  return Math.max(15000, Math.min(300000, configured));
}

function fallbackUsageCost(usage, pricing) {
  const input = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0);
  const cached = Number(usage?.prompt_tokens_details?.cached_tokens ?? usage?.input_tokens_details?.cached_tokens ?? 0);
  const output = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0);
  const nonCached = Math.max(0, input - cached);
  return (nonCached * pricing.input + cached * pricing.cachedInput + output * pricing.output) / 1_000_000;
}

function normalizeUsage(usage = {}) {
  return {
    prompt_tokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
    completion_tokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
    total_tokens: Number(usage.total_tokens ?? 0),
    prompt_tokens_details: {
      cached_tokens: Number(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0)
    },
    cost: Number(usage.cost)
  };
}

function addUsage(total, next) {
  const u = normalizeUsage(next);
  total.prompt_tokens += u.prompt_tokens;
  total.completion_tokens += u.completion_tokens;
  total.total_tokens += u.total_tokens || (u.prompt_tokens + u.completion_tokens);
  total.prompt_tokens_details.cached_tokens += u.prompt_tokens_details.cached_tokens;
  if (Number.isFinite(u.cost)) total.cost += u.cost;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function callOpenRouter(batch, model) {
  const ids = batch.map((item) => item.id);
  const timeoutMs = requestTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let apiResponse;

  try {
    apiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "http://localhost:8787",
        "X-Title": "TypeBlock Editorial AI Lab"
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: JSON.stringify({ schemaVersion: 1, items: batch }) }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "typeblock_editorial_scan",
            strict: true,
            schema: schemaFor(ids)
          }
        },
        plugins: [{ id: "response-healing" }],
        provider: { require_parameters: true },
        max_completion_tokens: Math.max(1200, Math.min(4000, batch.length * 500)),
        stream: false
      }),
      signal: controller.signal
    });
  } catch (error) {
    const err = error?.name === "AbortError"
      ? new Error(`OpenRouter request timed out after ${Math.round(timeoutMs / 1000)} seconds for Entries ${ids.join(", ")}.`)
      : new Error(`OpenRouter network request failed for Entries ${ids.join(", ")}: ${error.message || error}`);
    err.statusCode = 504;
    throw err;
  } finally {
    clearTimeout(timer);
  }

  const rawBody = await apiResponse.text();
  let responseBody;
  try {
    responseBody = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    const err = new Error(`OpenRouter returned non-JSON output with HTTP ${apiResponse.status}.`);
    err.statusCode = 502;
    throw err;
  }

  if (!apiResponse.ok || responseBody?.error) {
    const message = responseBody?.error?.message || `OpenRouter request failed with HTTP ${apiResponse.status}`;
    const err = new Error(message);
    err.statusCode = apiResponse.ok ? 502 : apiResponse.status;
    throw err;
  }

  const outputText = extractChatContent(responseBody);
  if (!outputText) {
    const finishReason = responseBody?.choices?.[0]?.finish_reason || "unknown";
    const err = new Error(`OpenRouter returned no structured output text (finish_reason: ${finishReason}).`);
    err.statusCode = 502;
    throw err;
  }

  let parsed;
  try {
    parsed = parseJsonLenient(outputText);
  } catch (error) {
    const finishReason = responseBody?.choices?.[0]?.finish_reason || "unknown";
    const err = new Error(`OpenRouter returned unparsable structured JSON (finish_reason: ${finishReason}; ${error.message}).`);
    err.statusCode = 502;
    throw err;
  }

  const allowed = new Set(ids);
  const seen = new Set();
  const analyses = [];
  for (const item of parsed.analyses || []) {
    if (!allowed.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    analyses.push(item);
  }

  return {
    analyses,
    missingIds: ids.filter((id) => !seen.has(id)),
    usage: responseBody.usage || {},
    model: responseBody.model || model,
    requestId: responseBody.id || apiResponse.headers.get("x-request-id") || null
  };
}

export async function runEditorialScan(payload) {
  if (!process.env.OPENROUTER_API_KEY) {
    const err = new Error("OPENROUTER_API_KEY is missing. Add it to .env and restart the server.");
    err.statusCode = 500;
    throw err;
  }

  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) {
    const err = new Error("Request must include a non-empty items array.");
    err.statusCode = 400;
    throw err;
  }
  if (items.length > 100) {
    const err = new Error("This lab accepts at most 100 Entries per scan.");
    err.statusCode = 400;
    throw err;
  }

  const sanitizedItems = items.map((item) => ({
    id: Number(item.id),
    provenance: item.provenance === "authored" ? "authored" : "collected",
    text: String(item.text || "").slice(0, 80_000),
    sourceDigest: String(item.sourceDigest || ""),
    previous: item.previous ? { id: Number(item.previous.id), tail: String(item.previous.tail || "").slice(-1200) } : null,
    next: item.next ? { id: Number(item.next.id), head: String(item.next.head || "").slice(0, 1200) } : null
  }));

  const model = process.env.OPENROUTER_MODEL || "openai/gpt-5-mini";
  const batchSize = Math.max(1, Math.min(8, Number(process.env.OPENROUTER_BATCH_SIZE || 4)));
  const batches = chunk(sanitizedItems, batchSize);
  const results = [];
  const usage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    prompt_tokens_details: { cached_tokens: 0 },
    cost: 0
  };
  const requestIds = [];
  let resolvedModel = model;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    const batch = batches[batchIndex];
    const ids = batch.map((item) => item.id);
    const startedAt = Date.now();
    console.log(`[editorial-scan] batch ${batchIndex + 1}/${batches.length} start · Entries ${ids.join(", ")}`);

    const result = await callOpenRouter(batch, model);
    results.push(...result.analyses);
    addUsage(usage, result.usage);
    resolvedModel = result.model || resolvedModel;
    if (result.requestId) requestIds.push(result.requestId);

    if (result.missingIds.length) {
      for (const missingId of result.missingIds) {
        const item = batch.find((x) => x.id === missingId);
        if (!item) continue;
        console.log(`[editorial-scan] retry · Entry ${missingId}`);
        const retry = await callOpenRouter([item], model);
        results.push(...retry.analyses);
        addUsage(usage, retry.usage);
        resolvedModel = retry.model || resolvedModel;
        if (retry.requestId) requestIds.push(retry.requestId);
        if (retry.missingIds.length) {
          const err = new Error(`OpenRouter still omitted analysis for Entry ${missingId} after an individual retry.`);
          err.statusCode = 502;
          throw err;
        }
      }
    }

    console.log(
      `[editorial-scan] batch ${batchIndex + 1}/${batches.length} done · ` +
      `${Date.now() - startedAt} ms · Entries ${ids.join(", ")}`
    );
  }

  const byId = new Map(results.map((item) => [item.id, item]));
  const analyses = sanitizedItems.map((item) => byId.get(item.id)).filter(Boolean);
  if (analyses.length !== sanitizedItems.length) {
    const missing = sanitizedItems.filter((item) => !byId.has(item.id)).map((item) => item.id);
    const err = new Error(`Missing analyses after retries: ${missing.join(", ")}.`);
    err.statusCode = 502;
    throw err;
  }

  const pricing = configuredPricing();
  const reportedCost = Number(usage.cost);
  const cost = Number.isFinite(reportedCost) && reportedCost > 0
    ? reportedCost
    : fallbackUsageCost(usage, pricing);

  return {
    schemaVersion: 1,
    provider: "openrouter",
    transport: "chat_completions_structured_output_chunked",
    model: resolvedModel,
    analyses,
    usage,
    cost: {
      usd: cost,
      method: Number.isFinite(reportedCost) && reportedCost > 0
        ? "openrouter_reported_usage_cost"
        : "actual_tokens_x_configured_pricing",
      pricingSnapshot: {
        perMillionInputUSD: pricing.input,
        perMillionCachedInputUSD: pricing.cachedInput,
        perMillionOutputUSD: pricing.output
      }
    },
    requestId: requestIds[0] || null,
    requestIds,
    batchSize
  };
}
