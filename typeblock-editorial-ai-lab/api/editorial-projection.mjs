const LANGUAGES = ["zh", "en", "other"];

const instructions = `You create a faithful editorial projection for TypeBlock.

The user's library contains collected articles and casual authored notes. The projection is display-only metadata: it must never rewrite, judge, fact-check, or add claims to the source text.

For every input item:
- Respect needTitle and needDeck exactly.
- If needTitle is false, return an empty title string.
- If needDeck is false, return an empty deck string.
- Use the source text's primary language.
- A title must identify the actual subject, not market the text.
- A deck must describe what the text discusses without adding conclusions, praise, certainty, or facts absent from the source.
- Avoid templates such as “本文将…”, “一文看懂…”, “带你了解…”, “This article will…”, or clickbait.
- Do not mention that AI generated the text.
- Do not quote long passages.

Length targets:
- Chinese title: 8–18 Han characters when possible, never more than 28 display characters.
- Chinese deck: 30–70 display characters when possible, never more than 96.
- English title: 4–10 words when possible, never more than 14.
- English deck: 15–35 words when possible, never more than 48.

Return exactly one projection for every integer id and no prose outside the JSON schema.`;

function schemaFor(ids) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      projections: {
        type: "array",
        minItems: ids.length,
        maxItems: ids.length,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "integer", enum: ids },
            title: { type: "string", maxLength: 160 },
            deck: { type: "string", maxLength: 360 },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            language: { type: "string", enum: LANGUAGES }
          },
          required: ["id", "title", "deck", "confidence", "language"]
        }
      }
    },
    required: ["projections"]
  };
}

function extractChatContent(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
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
  const number = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    input: number("OPENROUTER_INPUT_PRICE_PER_M", 0.25),
    cachedInput: number("OPENROUTER_CACHED_INPUT_PRICE_PER_M", 0.025),
    output: number("OPENROUTER_OUTPUT_PRICE_PER_M", 2.0)
  };
}

function requestTimeoutMs() {
  const configured = Number(process.env.OPENROUTER_REQUEST_TIMEOUT_MS || 90000);
  if (!Number.isFinite(configured)) return 90000;
  return Math.max(15000, Math.min(300000, configured));
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
  const usage = normalizeUsage(next);
  total.prompt_tokens += usage.prompt_tokens;
  total.completion_tokens += usage.completion_tokens;
  total.total_tokens += usage.total_tokens || usage.prompt_tokens + usage.completion_tokens;
  total.prompt_tokens_details.cached_tokens += usage.prompt_tokens_details.cached_tokens;
  if (Number.isFinite(usage.cost)) total.cost += usage.cost;
}

function fallbackUsageCost(usage, pricing) {
  const input = Number(usage.prompt_tokens || 0);
  const cached = Number(usage.prompt_tokens_details?.cached_tokens || 0);
  const output = Number(usage.completion_tokens || 0);
  const nonCached = Math.max(0, input - cached);
  return (nonCached * pricing.input + cached * pricing.cachedInput + output * pricing.output) / 1_000_000;
}

function chunk(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/^\s*[#>*`"“”'‘’]+\s*/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeProjection(item, source) {
  return {
    id: source.id,
    title: source.needTitle ? cleanText(item?.title, 160) : "",
    deck: source.needDeck ? cleanText(item?.deck, 360) : "",
    confidence: Math.max(0, Math.min(1, Number(item?.confidence || 0))),
    language: LANGUAGES.includes(item?.language) ? item.language : "other"
  };
}

async function callOpenRouter(batch, model) {
  const ids = batch.map((item) => item.id);
  const timeoutMs = requestTimeoutMs();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;

  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "http://localhost:8787",
        "X-Title": "TypeBlock Editorial Projection"
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
            name: "typeblock_editorial_projection",
            strict: true,
            schema: schemaFor(ids)
          }
        },
        plugins: [{ id: "response-healing" }],
        provider: { require_parameters: true },
        max_completion_tokens: Math.max(700, Math.min(2400, batch.length * 420)),
        stream: false
      }),
      signal: controller.signal
    });
  } catch (error) {
    const wrapped = error?.name === "AbortError"
      ? new Error(`OpenRouter projection request timed out after ${Math.round(timeoutMs / 1000)} seconds for Entries ${ids.join(", ")}.`)
      : new Error(`OpenRouter projection request failed for Entries ${ids.join(", ")}: ${error.message || error}`);
    wrapped.statusCode = 504;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error(`OpenRouter returned non-JSON projection output with HTTP ${response.status}.`);
    error.statusCode = 502;
    throw error;
  }

  if (!response.ok || body?.error) {
    const error = new Error(body?.error?.message || `OpenRouter projection request failed with HTTP ${response.status}.`);
    error.statusCode = response.ok ? 502 : response.status;
    throw error;
  }

  const output = extractChatContent(body);
  if (!output) {
    const error = new Error(`OpenRouter returned no projection output (finish_reason: ${body?.choices?.[0]?.finish_reason || "unknown"}).`);
    error.statusCode = 502;
    throw error;
  }

  let parsed;
  try {
    parsed = parseJsonLenient(output);
  } catch (cause) {
    const error = new Error(`OpenRouter returned unparsable projection JSON (${cause.message}).`);
    error.statusCode = 502;
    throw error;
  }

  const sourceById = new Map(batch.map((item) => [item.id, item]));
  const seen = new Set();
  const projections = [];
  for (const item of parsed.projections || []) {
    const source = sourceById.get(item.id);
    if (!source || seen.has(item.id)) continue;
    seen.add(item.id);
    projections.push(normalizeProjection(item, source));
  }

  return {
    projections,
    missingIds: ids.filter((id) => !seen.has(id)),
    usage: body.usage || {},
    model: body.model || model,
    requestId: body.id || response.headers.get("x-request-id") || null
  };
}

export async function runEditorialProjection(payload) {
  if (!process.env.OPENROUTER_API_KEY) {
    const error = new Error("OPENROUTER_API_KEY is missing. Add it to .env and restart the server.");
    error.statusCode = 500;
    throw error;
  }

  const items = Array.isArray(payload?.items) ? payload.items : [];
  if (!items.length) {
    const error = new Error("Projection request must include a non-empty items array.");
    error.statusCode = 400;
    throw error;
  }
  if (items.length > 100) {
    const error = new Error("This lab accepts at most 100 Entries per projection request.");
    error.statusCode = 400;
    throw error;
  }

  const sanitized = items.map((item) => ({
    id: Number(item.id),
    provenance: item.provenance === "authored" ? "authored" : "collected",
    text: String(item.text || "").slice(0, 80_000),
    sourceDigest: String(item.sourceDigest || ""),
    needTitle: Boolean(item.needTitle),
    needDeck: Boolean(item.needDeck),
    existingTitle: cleanText(item.existingTitle, 160)
  }));

  if (sanitized.some((item) => !Number.isInteger(item.id) || !item.text || (!item.needTitle && !item.needDeck))) {
    const error = new Error("Every projection item needs an integer id, source text, and at least one requested field.");
    error.statusCode = 400;
    throw error;
  }

  const model = process.env.OPENROUTER_MODEL || "openai/gpt-5-mini";
  const batchSize = Math.max(1, Math.min(4, Number(process.env.OPENROUTER_PROJECTION_BATCH_SIZE || 2)));
  const batches = chunk(sanitized, batchSize);
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

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    const ids = batch.map((item) => item.id);
    const startedAt = Date.now();
    console.log(`[editorial-projection] batch ${index + 1}/${batches.length} start · Entries ${ids.join(", ")}`);

    const result = await callOpenRouter(batch, model);
    results.push(...result.projections);
    addUsage(usage, result.usage);
    resolvedModel = result.model || resolvedModel;
    if (result.requestId) requestIds.push(result.requestId);

    for (const missingId of result.missingIds) {
      const item = batch.find((candidate) => candidate.id === missingId);
      if (!item) continue;
      console.log(`[editorial-projection] retry · Entry ${missingId}`);
      const retry = await callOpenRouter([item], model);
      results.push(...retry.projections);
      addUsage(usage, retry.usage);
      resolvedModel = retry.model || resolvedModel;
      if (retry.requestId) requestIds.push(retry.requestId);
      if (retry.missingIds.length) {
        const error = new Error(`OpenRouter still omitted projection for Entry ${missingId} after an individual retry.`);
        error.statusCode = 502;
        throw error;
      }
    }

    console.log(`[editorial-projection] batch ${index + 1}/${batches.length} done · ${Date.now() - startedAt} ms · Entries ${ids.join(", ")}`);
  }

  const byId = new Map(results.map((item) => [item.id, item]));
  const projections = sanitized.map((item) => byId.get(item.id)).filter(Boolean);
  if (projections.length !== sanitized.length) {
    const missing = sanitized.filter((item) => !byId.has(item.id)).map((item) => item.id);
    const error = new Error(`Missing projections after retries: ${missing.join(", ")}.`);
    error.statusCode = 502;
    throw error;
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
    projections,
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
