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

function extractOutputText(response) {
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const content of item.content || []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return "";
}

function pricingFromEnv() {
  const num = (name, fallback) => {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    input: num("OPENAI_INPUT_PRICE_PER_M", 0.25),
    cachedInput: num("OPENAI_CACHED_INPUT_PRICE_PER_M", 0.025),
    output: num("OPENAI_OUTPUT_PRICE_PER_M", 2.0)
  };
}

function usageCost(usage, pricing) {
  const input = Number(usage?.input_tokens || 0);
  const cached = Number(usage?.input_tokens_details?.cached_tokens || 0);
  const output = Number(usage?.output_tokens || 0);
  const nonCached = Math.max(0, input - cached);
  return (
    nonCached * pricing.input +
    cached * pricing.cachedInput +
    output * pricing.output
  ) / 1_000_000;
}

export async function runEditorialScan(payload) {
  if (!process.env.OPENAI_API_KEY) {
    const err = new Error("OPENAI_API_KEY is missing. Copy .env.example to .env and add your key.");
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

  const model = process.env.OPENAI_MODEL || "gpt-5-mini";
  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions,
      input: JSON.stringify({ schemaVersion: 1, items: sanitizedItems }),
      text: {
        format: {
          type: "json_schema",
          name: "typeblock_editorial_scan",
          description: "Shallow editorial relationship metadata for TypeBlock layout.",
          strict: true,
          schema
        }
      },
      max_output_tokens: Math.max(600, Math.min(6000, items.length * 120))
    })
  });

  const responseBody = await apiResponse.json();
  if (!apiResponse.ok) {
    const message = responseBody?.error?.message || `OpenAI request failed with HTTP ${apiResponse.status}`;
    const err = new Error(message);
    err.statusCode = apiResponse.status;
    throw err;
  }

  const outputText = extractOutputText(responseBody);
  if (!outputText) {
    const err = new Error("OpenAI returned no structured output text.");
    err.statusCode = 502;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    const err = new Error("OpenAI returned structured output that could not be parsed as JSON.");
    err.statusCode = 502;
    throw err;
  }

  const byId = new Set(sanitizedItems.map((item) => item.id));
  const analyses = (parsed.analyses || []).filter((item) => byId.has(item.id));
  if (analyses.length !== sanitizedItems.length) {
    const err = new Error(`Expected ${sanitizedItems.length} analyses but received ${analyses.length}.`);
    err.statusCode = 502;
    throw err;
  }

  const pricing = pricingFromEnv();
  const cost = usageCost(responseBody.usage, pricing);

  return {
    schemaVersion: 1,
    model: responseBody.model || model,
    analyses,
    usage: responseBody.usage || {},
    cost: {
      usd: cost,
      method: "actual_tokens_x_configured_pricing",
      pricingSnapshot: {
        perMillionInputUSD: pricing.input,
        perMillionCachedInputUSD: pricing.cachedInput,
        perMillionOutputUSD: pricing.output
      }
    },
    requestId: apiResponse.headers.get("x-request-id") || null
  };
}
