# TypeBlock Editorial AI Lab — local LIVE backend

This directory adds a local Node.js backend to the existing TypeBlock Editorial AI Lab. The browser never receives the OpenAI API key.

## Requirements

- Node.js 20+
- An OpenAI API key

## Setup

From `typeblock-editorial-ai-lab/`:

```bash
cp .env.example .env
```

Edit `.env` and replace:

```text
OPENAI_API_KEY=sk-proj-replace-me
```

with your real key.

Keep the default model/pricing together unless you intentionally change both:

```text
OPENAI_MODEL=gpt-5-mini
OPENAI_INPUT_PRICE_PER_M=0.25
OPENAI_CACHED_INPUT_PRICE_PER_M=0.025
OPENAI_OUTPUT_PRICE_PER_M=2.00
```

## Install and run

```bash
npm install
npm start
```

Open:

```text
http://localhost:8787
```

Do **not** use the raw.githack URL for LIVE mode; raw.githack serves only static files and cannot execute `/api/editorial-scan`.

## Run a real scan

1. Open `http://localhost:8787`.
2. Select **LIVE**.
3. Leave the endpoint as `/api/editorial-scan`.
4. Click **Analyze stale / missing**.

The backend sends a Responses API request with strict JSON Schema output and returns the four layout-oriented editorial fields:

```json
{
  "analyses": [
    {
      "id": 1,
      "function": "referenceMaterial",
      "continuity": 0.21,
      "dependency": "standalone",
      "topicShift": 0.79
    }
  ]
}
```

It also returns the real Responses API `usage` object plus a server-side usage-based cost estimate calculated from actual tokens and the pricing configured in `.env`.

## Health check

Open:

```text
http://localhost:8787/api/health
```

You should see `"hasKey": true` before trying LIVE mode.

## Privacy and behavior

- `store: false` is sent to the Responses API.
- The model is instructed to do only shallow editorial analysis.
- It does not return summaries, importance scores, fact checks, sentiment, or argument evaluation.
- The four returned fields are `function`, `continuity`, `dependency`, and `topicShift`.
- The API key stays server-side in `.env`.
- `.env` is ignored by git.
