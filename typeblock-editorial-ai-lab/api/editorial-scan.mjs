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

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    analyses: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "integer" },
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

function extractChatContent(response) {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") return part.text;
        if (typeof part?.text === "string") return part.text;
        return "";
      })
      .join("");
  }
  return "";
}

function parseStructuredOutput(raw) {
  const text = String(raw || "").trim();
  const attempts = [text];

  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced?.[1]) attempts.push(fenced[1].trim());

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    attempts.push(text.slice(firstBrace, lastBrace + 1));
  }

  let lastError = null;
  for (const candidate of [...new Set(attempts)]) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      lastError = error;
    }
  }

  const err = new Error(
    `OpenRouter returned structured output that could not be parsed as JSON (${lastError?.message || "unknown parse error"}).`
  );
  err.statusCode = 502;
  throw err;
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

function fallbackUsageCost(usage, pricing) {
  const input = Number(usage?.prompt_tokens ?? usage?.input_tokens ?? 0);
  const cached = Number(
    usage?.prompt_tokens_details?.cached_tokens ??
    usage?.input_tokens_details?.cached_tokens ??
    0
  );
  const output = Number(usage?.completion_tokens ?? usage?.output_tokens ?? 0);
  const nonCached = Math.max(0, input - cached);
  return (nonCached * pricing.input + cached * pricing.cachedInput + output * pricing.output) / 1_000_000;
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
    previous: item.previous
      ? { id: Number(item.previous.id), tail: String(item.previous.tail || "").slice(-1200) }
      : null,
    next: item.next
      ? { id: Number(item.next.id), head: String(item.next.head || "").slice(0, 1200) }
      : null
  }));

  const model = process.env.OPENROUTER_MODEL || "openai/gpt-5-mini";
  const apiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
        {
          role: "user",
          content: JSON.stringify({ schemaVersion: 1, items: sanitizedItems })
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "typeblock_editorial_scan",
          strict: true,
          schema
        }
      },
      provider: { require_parameters: true },
      plugins: [{ id: "response-healing" }],
      max_tokens: Math.max(800, Math.min(8000, items.length * 160)),
      stream: false
    })
  });

  const responseBody = await apiResponse.json();

  if (!apiResponse.ok || responseBody?.error) {
    const message = responseBody?.error?.message || `OpenRouter request failed with HTTP ${apiResponse.status}`;
    const err = new Error(message);
    err.statusCode = apiResponse.ok ? 502 : apiResponse.status;
    throw err;
  }

  const choice = responseBody?.choices?.[0];
  if (choice?.finish_reason === "error" || choice?.error) {
    const message = choice?.error?.message || "OpenRouter provider failed while generating the structured output.";
    const err = new Error(message);
    err.statusCode = 502;
    throw err;
  }

  const outputText = extractChatContent(responseBody);
  if (!outputText) {
    const finishReason = choice?.finish_reason || "unknown";
    const err = new Error(`OpenRouter returned no structured output text (finish_reason: ${finishReason}).`);
    err.statusCode = 502;
    throw err;
  }

  const parsed = parseStructuredOutput(outputText);

  const byId = new Set(sanitizedItems.map((item) => item.id));
  const analyses = (parsed.analyses || []).filter((item) => byId.has(item.id));
  if (analyses.length !== sanitizedItems.length) {
    const err = new Error(`Expected ${sanitizedItems.length} analyses but received ${analyses.length}.`);
    err.statusCode = 502;
    throw err;
  }

  const pricing = configuredPricing();
  const reportedCost = Number(responseBody?.usage?.cost);
  const cost = Number.isFinite(reportedCost)
    ? reportedCost
    : fallbackUsageCost(responseBody.usage, pricing);

  return {
    schemaVersion: 1,
    provider: "openrouter",
    transport: "chat_completions_structured_output_healed",
    model: responseBody.model || model,
    analyses,
    usage: responseBody.usage || {},
    cost: {
      usd: cost,
      method: Number.isFinite(reportedCost)
        ? "openrouter_reported_usage_cost"
        : "actual_tokens_x_configured_pricing",
      pricingSnapshot: {
        perMillionInputUSD: pricing.input,
        perMillionCachedInputUSD: pricing.cachedInput,
        perMillionOutputUSD: pricing.output
      }
    },
    requestId: responseBody.id || apiResponse.headers.get("x-request-id") || null
  };
}
