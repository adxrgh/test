const LANGUAGES = ["zh", "en", "other"];
const DEFAULT_MODEL = "openai/gpt-5-mini";
const DEFAULT_REASONING_EFFORT = "minimal";
const DEFAULT_MAX_COMPLETION_TOKENS = 1800;
const DEFAULT_RETRY_MAX_COMPLETION_TOKENS = 4200;

const instructions = `You create a faithful editorial projection for TypeBlock.

The user's library contains collected articles and casual authored notes. The projection is display-only metadata: it must never rewrite, judge, fact-check, or add claims to the source text.

For the one input item:
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

Return exactly one projection and no prose outside the JSON schema.`;

function schemaFor(id) {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      projections: {
        type: "array",
        minItems: 1,
        maxItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "integer", enum: [id] },
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
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
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

function positiveInteger(name, fallback, minimum, maximum) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function reasoningEffort() {
  const allowed = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);
  const configured = String(process.env.OPENROUTER_PROJECTION_REASONING_EFFORT || DEFAULT_REASONING_EFFORT).toLowerCase();
  return allowed.has(configured) ? configured : DEFAULT_REASONING_EFFORT;
}

function firstBudget() {
  return positiveInteger(
    "OPENROUTER_PROJECTION_MAX_COMPLETION_TOKENS",
    DEFAULT_MAX_COMPLETION_TOKENS,
    800,
    16000
  );
}

function retryBudget() {
  return positiveInteger(
    "OPENROUTER_PROJECTION_RETRY_MAX_COMPLETION_TOKENS",
    DEFAULT_RETRY_MAX_COMPLETION_TOKENS,
    firstBudget(),
    24000
  );
}

function normalizeUsage(usage = {}) {
  return {
    prompt_tokens: Number(usage.prompt_tokens ?? usage.input_tokens ?? 0),
    completion_tokens: Number(usage.completion_tokens ?? usage.output_tokens ?? 0),
    total_tokens: Number(usage.total_tokens ?? 0),
    prompt_tokens_details: {
      cached_tokens: Number(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? 0)
    },
    completion_tokens_details: {
      reasoning_tokens: Number(
        usage.completion_tokens_details?.reasoning_tokens ??
        usage.output_tokens_details?.reasoning_tokens ??
        0
      )
    },
    cost: Number(usage.cost)
  };
}

function emptyUsage() {
  return {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    prompt_tokens_details: { cached_tokens: 0 },
    completion_tokens_details: { reasoning_tokens: 0 },
    cost: 0
  };
}

function addUsage(total, next) {
  const usage = normalizeUsage(next);
  total.prompt_tokens += usage.prompt_tokens;
  total.completion_tokens += usage.completion_tokens;
  total.total_tokens += usage.total_tokens || usage.prompt_tokens + usage.completion_tokens;
  total.prompt_tokens_details.cached_tokens += usage.prompt_tokens_details.cached_tokens;
  total.completion_tokens_details.reasoning_tokens += usage.completion_tokens_details.reasoning_tokens;
  if (Number.isFinite(usage.cost)) total.cost += usage.cost;
}

function fallbackUsageCost(usage, pricing) {
  const input = Number(usage.prompt_tokens || 0);
  const cached = Number(usage.prompt_tokens_details?.cached_tokens || 0);
  const output = Number(usage.completion_tokens || 0);
  const nonCached = Math.max(0, input - cached);
  return (nonCached * pricing.input + cached * pricing.cachedInput + output * pricing.output) / 1_000_000;
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/^\s*[#>*`"“”'‘’]+\s*/u, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeProjection(item, source) {
  const projection = {
    id: source.id,
    title: source.needTitle ? cleanText(item?.title, 160) : "",
    deck: source.needDeck ? cleanText(item?.deck, 360) : "",
    confidence: Math.max(0, Math.min(1, Number(item?.confidence || 0))),
    language: LANGUAGES.includes(item?.language) ? item.language : "other"
  };
  if (source.needTitle && !projection.title) {
    throw Object.assign(new Error(`Entry ${source.id} returned an empty required title.`), { retryable: true });
  }
  if (source.needDeck && !projection.deck) {
    throw Object.assign(new Error(`Entry ${source.id} returned an empty required deck.`), { retryable: true });
  }
  return projection;
}

async function requestOnce(item, model, maxCompletionTokens) {
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
          { role: "user", content: JSON.stringify({ schemaVersion: 1, item }) }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "typeblock_editorial_projection",
            strict: true,
            schema: schemaFor(item.id)
          }
        },
        reasoning: {
          effort: reasoningEffort(),
          exclude: true
        },
        plugins: [{ id: "response-healing" }],
        provider: { require_parameters: true },
        max_completion_tokens: maxCompletionTokens,
        stream: false
      }),
      signal: controller.signal
    });
  } catch (error) {
    const wrapped = error?.name === "AbortError"
      ? new Error(`OpenRouter projection request timed out after ${Math.round(timeoutMs / 1000)} seconds for Entry ${item.id}.`)
      : new Error(`OpenRouter projection request failed for Entry ${item.id}: ${error.message || error}`);
    wrapped.statusCode = 504;
    wrapped.retryable = true;
    throw wrapped;
  } finally {
    clearTimeout(timer);
  }

  const raw = await response.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    const error = new Error(`OpenRouter returned non-JSON projection output with HTTP ${response.status} for Entry ${item.id}.`);
    error.statusCode = 502;
    error.retryable = true;
    throw error;
  }

  if (!response.ok || body?.error) {
    const error = new Error(body?.error?.message || `OpenRouter projection request failed with HTTP ${response.status} for Entry ${item.id}.`);
    error.statusCode = response.ok ? 502 : response.status;
    error.retryable = response.status >= 500 || response.status === 408 || response.status === 429;
    error.usage = body?.usage || null;
    throw error;
  }

  return {
    body,
    output: extractChatContent(body),
    finishReason: body?.choices?.[0]?.finish_reason || "unknown",
    usage: body.usage || {},
    model: body.model || model,
    requestId: body.id || response.headers.get("x-request-id") || null,
    maxCompletionTokens
  };
}

function parseProjection(item, result) {
  if (!result.output) {
    const message = result.finishReason === "length"
      ? `OpenRouter exhausted ${result.maxCompletionTokens} completion tokens before returning projection JSON for Entry ${item.id}.`
      : `OpenRouter returned no projection output for Entry ${item.id} (finish_reason: ${result.finishReason}).`;
    const error = new Error(message);
    error.statusCode = 502;
    error.retryable = true;
    throw error;
  }

  let parsed;
  try {
    parsed = parseJsonLenient(result.output);
  } catch (cause) {
    const error = new Error(
      `OpenRouter returned unparsable projection JSON for Entry ${item.id} ` +
      `(finish_reason: ${result.finishReason}; ${cause.message}).`
    );
    error.statusCode = 502;
    error.retryable = true;
    throw error;
  }

  const candidate = (parsed.projections || []).find((projection) => projection?.id === item.id);
  if (!candidate) {
    const error = new Error(`OpenRouter omitted projection for Entry ${item.id}.`);
    error.statusCode = 502;
    error.retryable = true;
    throw error;
  }
  return normalizeProjection(candidate, item);
}

async function projectOne(item, model) {
  const attempts = [firstBudget(), retryBudget()];
  const usage = emptyUsage();
  const requestIds = [];
  let resolvedModel = model;
  let lastError;

  for (let attemptIndex = 0; attemptIndex < attempts.length; attemptIndex += 1) {
    const budget = attempts[attemptIndex];
    try {
      const result = await requestOnce(item, model, budget);
      addUsage(usage, result.usage);
      resolvedModel = result.model || resolvedModel;
      if (result.requestId) requestIds.push(result.requestId);
      const projection = parseProjection(item, result);
      return { projection, usage, model: resolvedModel, requestIds, attempts: attemptIndex + 1 };
    } catch (error) {
      if (error?.usage) addUsage(usage, error.usage);
      lastError = error;
      const canRetry = attemptIndex + 1 < attempts.length && error?.retryable !== false;
      console.warn(
        `[editorial-projection] Entry ${item.id} attempt ${attemptIndex + 1}/${attempts.length} failed · ` +
        `${error.message || error}${canRetry ? ` · retrying with ${attempts[attemptIndex + 1]} completion tokens` : ""}`
      );
      if (!canRetry) break;
    }
  }

  const error = new Error(
    `Projection failed for Entry ${item.id} after ${attempts.length} attempts: ${lastError?.message || lastError || "unknown error"}`
  );
  error.statusCode = Number(lastError?.statusCode || 502);
  throw error;
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
  if (items.length > 20) {
    const error = new Error("This endpoint accepts at most 20 Entries per projection request.");
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

  const model = process.env.OPENROUTER_PROJECTION_MODEL || process.env.OPENROUTER_MODEL || DEFAULT_MODEL;
  console.log(
    `[editorial-projection] v2 · ${sanitized.length} item(s) · model ${model} · ` +
    `reasoning ${reasoningEffort()} · budgets ${firstBudget()}/${retryBudget()}`
  );

  const settled = await Promise.allSettled(sanitized.map((item) => projectOne(item, model)));
  const failed = settled
    .map((result, index) => ({ result, item: sanitized[index] }))
    .filter(({ result }) => result.status === "rejected");

  if (failed.length) {
    const details = failed
      .map(({ result, item }) => `Entry ${item.id}: ${result.reason?.message || result.reason}`)
      .join(" | ");
    const error = new Error(details);
    error.statusCode = Number(failed[0].result.reason?.statusCode || 502);
    throw error;
  }

  const completed = settled.map((result) => result.value);
  const usage = emptyUsage();
  const requestIds = [];
  const attemptsById = {};
  let resolvedModel = model;

  completed.forEach((result) => {
    addUsage(usage, result.usage);
    resolvedModel = result.model || resolvedModel;
    requestIds.push(...result.requestIds);
    attemptsById[result.projection.id] = result.attempts;
  });

  const projectionsById = new Map(completed.map((result) => [result.projection.id, result.projection]));
  const projections = sanitized.map((item) => projectionsById.get(item.id)).filter(Boolean);
  const pricing = configuredPricing();
  const reportedCost = Number(usage.cost);
  const cost = Number.isFinite(reportedCost) && reportedCost > 0
    ? reportedCost
    : fallbackUsageCost(usage, pricing);

  return {
    schemaVersion: 1,
    provider: "openrouter",
    transport: "chat_completions_structured_output_projection_v2",
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
    reasoning: {
      effort: reasoningEffort(),
      excludedFromResponse: true,
      tokens: usage.completion_tokens_details.reasoning_tokens
    },
    attemptsById,
    batchSize: 1
  };
}
