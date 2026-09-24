# AI Module — Property & Location Intelligence

Module 2 of the ERP, mounted at `/api/v1/ai` beside `/pms`. It analyses a
candidate property before it is shortlisted: what the catchment looks like,
where the group demand comes from, who competes, what could go wrong, and
whether the site is worth a visit.

It is **decision support, never the decision.** Nothing in this module changes a
record's status, writes to a form, or shortlists anything. The Shortlist and
Reject controls stay exactly where they were, in human hands.

---

## Why it exists

Phase 1 of a franchise launch is: engage a broker → visit properties → capture
each one → shortlist the good ones → run four expert assessments in Phase 2.

The weak link is the shortlisting step. A doer captures ten properties from a
broker; someone has to judge which deserve the cost of a full feasibility,
financial, technical and operational assessment. That judgement has historically
depended on whoever happened to know the city.

This module does the desk research that judgement needs — grounded in live web
search, scored against a fixed rubric, and cited so it can be checked.

---

## How a run works

```
 Record (p1)
     │
     ▼
 ① context      build the property dossier from record.values, compute ₹/sq.ft,
                 fingerprint the decision-relevant fields
     │
     ▼
 ② research      GROUNDED call — web search over 9 research areas
                 → evidence brief + citations
     │
     ▼
 ③ synthesis     STRUCTURED call — no tools, strict JSON schema
                 → 8 pillar scores + findings + risks + recommendation
     │
     ▼
 ④ scoring       SERVER-SIDE arithmetic — weighted composite, band, confidence
     │
     ▼
 AiAnalysis document
```

### Why two calls, not one

1. **Reliability.** Structured outputs are most dependable when the model is not
   also juggling tool calls. Gemini enforces this outright — `google_search`
   grounding and `responseSchema` cannot be combined in a single request.
2. **Auditability.** The evidence brief is stored separately from the verdict,
   so a reader can see what the score was actually based on.
3. **Separation of concerns.** Retrieval quality and reasoning quality can be
   tuned, priced and debugged independently.

### Why the server computes the score

The model returns eight independent 0–100 pillar scores and nothing else
numeric. Every aggregate is computed in `analysis/scoring.js`:

- **Language models are unreliable at arithmetic.** A weighted average the model
  computes cannot be trusted, and a wrong total silently corrupts every ranking
  downstream.
- **Reproducibility.** Re-running the function over a stored report yields the
  same number. `POST /ai/analyses/:id/rescore` re-applies a changed rubric to
  historical reports with no provider call and no cost.
- **Reviewability.** Tuning the business model becomes a code diff, not a prompt
  edit whose effect nobody can predict.

---

## The rubric

Eight weighted pillars, defined in `ai.constants.js`. Weights sum to 100 — this
is asserted at import time, so a bad edit fails at boot rather than silently
skewing scores.

| Pillar | Weight | What it measures |
|---|---:|---|
| Catchment & Demographics | 18 | Size and age/affluence profile of the 5–8 km drawable population |
| Group Demand Drivers | 16 | Colleges, coaching hubs, IT parks, corporate offices — the sources of group bookings |
| Site & Built-Form Suitability | 14 | Ceiling height, column-free depth, power load, lift, floor level |
| Accessibility & Connectivity | 14 | Metro/bus/road, drive time, and **evening** two-wheeler parking |
| Footfall & Trip-Chaining Anchors | 12 | Malls, multiplexes, cafés — what makes the venue part of an outing |
| Competition & Cannibalisation | 10 | Escape rooms penalise; complementary leisure rewards |
| Commercial Viability | 10 | Rent vs local non-prime benchmark, implied rent-to-revenue |
| Regulatory, Safety & Environment Risk | 6 | Fire NOC and egress, licensing, waterlogging, neighbourhood |

**Verdict bands:** ≥78 Strong Fit · 65–77 Viable · 50–64 Conditional · <50 Not
Recommended.

### Why these weights

The rubric encodes how location-based entertainment actually works, which is
materially different from retail:

- **Demand is destination demand.** Guests book online and travel to the venue,
  so catchment size and profile outweigh passing footfall — hence Catchment (18)
  above Footfall (12).
- **Revenue is group-driven**, so group demand sources are scored separately
  from generic footfall.
- **The shopfront is nearly irrelevant.** Rooms are windowless by design, so an
  escape room can profitably occupy first-floor or basement space that retail
  rejects, at 30–50% of prime ground-floor rent. The prompts state this
  explicitly so an upper floor is not penalised as it would be for a shop.
- **Fire egress is the #1 regulatory killer** for a venue where guests sit
  behind closed doors, so it is a first-class pillar rather than a footnote.

---

## Confidence

A separate 0–100 figure, blended so that a fluent model cannot talk its own
confidence up:

- 50% the model's stated confidence
- 30% evidence quality (weighted mean of per-pillar `data_quality`)
- 20% research breadth (citation count, saturating at 12 sources)

Then hard ceilings apply regardless of what the model claims:

| Condition | Confidence capped at |
|---|---:|
| < 3 citations | 45 |
| < 6 citations | 70 |
| Rubric coverage < 100% | `coverage × 0.8` |

A report resting on two sources can never present itself as high-confidence.

---

## Providers

All four are supported through one capability interface. `AI_PROVIDER=auto`
prefers whichever is configured, in the order `gemini → grok → groq → openai`.

> **`grok` and `groq` are different vendors**, one letter apart. `grok` is xAI
> (api.x.ai, keys start `xai-`); `groq` is an inference host running open models
> (api.groq.com, keys start `gsk_`). Neither falls back to the other, and a key
> in the wrong slot fails with a bare 401.

| | OpenAI | Gemini | Grok (xAI) | Groq |
|---|---|---|---|---|
| Endpoint | `POST /v1/responses` | `:generateContent` | `/v1/chat/completions` | `/openai/v1/chat/completions` |
| Grounding | `web_search` tool | `google_search` tool | `search_parameters` | `compound_custom.tools` |
| Structured output | `text.format` strict schema | `responseSchema` | strict `json_schema` | strict `json_schema` |
| Auth | `Authorization: Bearer` | `x-goog-api-key` | `Authorization: Bearer` | `Authorization: Bearer` |

**Gemini leads the auto order** because `google_search` is first-party Google
Search, consistently stronger on the hyper-local Indian geography this module
asks about.

### Groq is the one provider that uses two models

On Groq, grounding and structured output live on different models, so it is
configured with both:

- `GROQ_RESEARCH_MODEL` (default `groq/compound`) — agentic, runs server-side
  web search, and reports what it fetched in `executed_tools`. That tool output
  is a plain `Title:` / `URL:` / `Content:` text block, which the adapter parses
  for citations; there is no structured citation array to read instead.
- `GROQ_MODEL` (default `openai/gpt-oss-120b`) — a plain reasoning model for the
  synthesis call, where strict `json_schema` is what matters and search would
  only add cost.

Using the search-capable model for both was measured and rejected:
`gpt-oss-120b` with the `browser_search` tool inlines every fetched page into
the prompt, costing **~121k tokens** for a research call that `groq/compound`
answers in **~7k**.

Two Groq-specific behaviours are worth knowing, because both look like bugs:

- **413 means "rate limited", not "payload too large".** Groq refuses a request
  outright when its `max_completion_tokens` exceeds what is left in the
  token-per-minute window, rather than truncating. The adapter treats 413 as
  retryable, and clamps the requested budget to `GROQ_MAX_COMPLETION_TOKENS`
  (default 6000) — without that clamp the synthesis call, which asks for 16k,
  could never be admitted on an 8k/minute tier.
- **`compound_custom.tools.enabled_tools` is load-bearing.** Left on its default
  toolset, `groq/compound` builds a request large enough to be refused. It is
  restricted to `web_search`, which is both what this call needs and what makes
  it fit. `search_settings.max_results` is deliberately not sent — it pushes the
  request back over the limit, so `GROQ_MAX_SEARCH_RESULTS` bounds how many
  citations are kept, not how many are fetched.

Implementation notes:

- Built on Node 20's global `fetch`, not a vendor SDK — the two REST surfaces
  are small and stable, and the server's dependency list is unchanged.
- One canonical JSON Schema drives both. OpenAI strict mode needs
  `additionalProperties: false` and every key in `required`; Gemini rejects
  `additionalProperties` and honours `propertyOrdering`. The transforms live in
  `providers/base.js`. The schema has **no optional fields** — "unknown" is an
  empty string, empty array, or an explicit `unknown` enum member — which is
  what lets one definition satisfy both dialects.
- `temperature` is omitted for reasoning-family models (`gpt-5`, `o*`), which
  reject it.
- If OpenAI rejects `web_search`, the adapter retries once with
  `web_search_preview`, so neither tool name has to be guessed at deploy time.
- Retries: 408/409/429/5xx and transport faults, with exponential backoff plus
  jitter and `Retry-After` support. 4xx fails fast.
- Failover between providers happens only on genuine provider faults. A bug in
  our own prompt would fail identically everywhere, so it propagates rather than
  doubling the spend.

---

## Async run model

`POST` returns **202** immediately with a `queued` document; the client polls
`GET` every 3s until the status settles. A grounded research call plus a
synthesis call takes 30–90s, and holding an HTTP request open that long is
fragile — proxy timeouts, and a user navigating away kills the work.

There is no job queue. A single process is the deployment shape, so a run is a
detached async function. The one failure that matters — a restart mid-run —
is handled by a lazy sweep: any `running` document older than
`AI_RUN_STALE_MINUTES` is marked failed the next time anyone reads it.

> If this ever runs multi-instance, `startPropertyAnalysis` is the single seam
> to swap for a real queue. Nothing else in the module would change.

---

## Caching

A `fingerprint` hashes the decision-relevant fields (name, locality, city, area,
frontage, floor, commercials, GPS rounded to ~11m) **plus** `PROMPT_VERSION` and
`RUBRIC_VERSION`.

- Editing a broker's phone number or fixing a typo → same fingerprint → the
  cached report is reused, nothing is spent.
- Renegotiating the rent → new fingerprint → a fresh analysis.
- Editing a prompt or a weight → bump the version constant → every cached report
  invalidates at once, so a comparison table can never mix two scoring
  generations.

Completed reports stay authoritative for `AI_CACHE_TTL_HOURS` (default 168 =
7 days), after which the UI marks them stale. `force: true` bypasses the cache.

---

## API

All routes require authentication. `viewer` may read; `executor`, `manager` and
`admin` may spend money running an analysis.

| Method | Route | Notes |
|---|---|---|
| `GET` | `/ai/status` | Provider config + the live rubric. Never returns keys. |
| `POST` | `/ai/property-intelligence/:recordId` | Start a run. `202` started, `200` cached. Body: `{ force?: boolean }` |
| `GET` | `/ai/property-intelligence/:recordId` | Latest run. `?includeBrief=true` adds the full research brief. |
| `GET` | `/ai/property-intelligence/:recordId/history` | All runs, newest first. |
| `GET` | `/ai/projects/:projectId/scores` | Compact per-record scores for the table column. |
| `POST` | `/ai/projects/:projectId/comparison` | Rank analysed properties. Needs ≥ 2. |
| `GET` | `/ai/projects/:projectId/comparison` | Latest comparison. |
| `POST` | `/ai/analyses/:id/rescore` | Re-apply the current rubric. No provider call. |

Endpoints that call a provider carry a second, tighter rate limiter
(`aiLimiter`, default 60/hour) **keyed per user**, so one enthusiastic analyst
cannot exhaust the office's allowance behind a shared NAT. Reads and polling
stay on the general limiter — a client polling a running analysis must never
exhaust its own budget for starting one.

---

## Configuration

The module is **optional everywhere**. With no key set the server boots
normally, the endpoints answer `503` with a clear reason, and the UI renders a
"not configured" state instead of an error. The AI Score column and the
comparison panel disappear entirely rather than showing empty furniture.

```bash
AI_ENABLED=true
# "auto", or an explicit comma-separated order that doubles as the failover
# chain — e.g. AI_PROVIDER=groq,gemini
AI_PROVIDER=auto

GROQ_API_KEY=                       # keys start "gsk_"
GROQ_MODEL=openai/gpt-oss-120b      # synthesis (strict JSON)
GROQ_RESEARCH_MODEL=groq/compound   # grounded research (web search)
GROQ_MAX_COMPLETION_TOKENS=6000     # raise with your Groq tier; 0 disables

XAI_API_KEY=                        # keys start "xai-" — different vendor
XAI_MODEL=grok-4-fast-reasoning

OPENAI_API_KEY=
OPENAI_MODEL=gpt-5

GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-pro

AI_REQUEST_TIMEOUT_MS=120000
AI_MAX_RETRIES=2
AI_CACHE_TTL_HOURS=168
AI_RUN_STALE_MINUTES=15
AI_RATE_LIMIT_MAX=60
```

Verify a key and both its models before trusting a deployment:

```bash
node check-ai-key.mjs            # every configured provider
node check-ai-key.mjs groq       # just one
```

Cost is roughly **$0.05–0.15 per property analysis** on Gemini/OpenAI, and
under **$0.01** on Groq (~16k tokens across two calls). On Groq's **free tier
(8,000 tokens/minute)** a single analysis fits, but two at once will not —
runs retry on 429/413, and for concurrent use either raise the tier or set a
second provider as failover (`AI_PROVIDER=groq,gemini`). Every report stores its own token count and
an indicative cost, shown in the UI, so provider invoices hold no surprises.

---

## Files

```
server/src/modules/ai/
├── ai.constants.js               rubric, weights, bands, versions, pricing
├── ai.model.js                   AiAnalysis — persisted, auditable runs
├── ai.service.js                 facade + stale-run sweep + presentation
├── ai.controller.js / .routes.js / .validation.js
├── providers/
│   ├── base.js                   retry/timeout fetch, schema dialects, JSON recovery
│   ├── openai.provider.js
│   ├── gemini.provider.js
│   ├── grok.provider.js          xAI — api.x.ai
│   ├── groq.provider.js          Groq — api.groq.com (different vendor)
│   └── index.js                  registry + failover
└── analysis/
    ├── context.js                Record → dossier, fingerprinting
    ├── prompts.js                the domain knowledge  ← the product
    ├── schema.js                 canonical structured-output contract
    ├── scoring.js                deterministic composite, bands, confidence
    ├── propertyIntelligence.service.js
    └── siteComparison.service.js

client/src/features/ai/
├── aiUi.js                       tones, bands, labels, formatters
├── ReportSections.jsx            presentational report pieces
├── PropertyIntelligencePanel.jsx run lifecycle + report
├── SiteComparisonPanel.jsx       cross-property ranking
└── AiScoreCell.jsx               the table column
```

`analysis/prompts.js` is where the value lives. The model supplies language and
retrieval; everything that makes the output *right for this business* is encoded
there. **Editing it means bumping `PROMPT_VERSION`.**

---

## Extending it

The module is built to grow — property analysis is the first service, not the
only one. To add another (lease-clause review, vendor scoring, launch demand
forecasting):

1. Add a kind to `AI_ANALYSIS_KIND`.
2. Add its schema to `analysis/schema.js` and its prompts to `analysis/prompts.js`.
3. Write a service beside `propertyIntelligence.service.js`.
4. Add routes.

Providers, retries, failover, caching, cost tracking, the async run model, the
audit trail and the stale sweep are all reused unchanged.

---

## Honesty guarantees

These are enforced in the prompts and in code, because a confident wrong answer
is worse than an admitted gap — a wrong one gets acted on.

- The model is instructed never to invent a distance, rent, competitor or
  population figure, and to name real checkable places or omit the entry.
- Each pillar declares its own `data_quality` (`strong` → `assumed`), shown in
  the UI as an explicit chip.
- Thin evidence caps confidence in code, whatever the model claims.
- A partially-scored rubric is flagged as partial rather than presented as
  complete; weights are renormalised over scored pillars rather than treating a
  missing pillar as zero, which would be a fabricated penalty.
- Every report ships its sources, and the full research brief is one click away.
- The panel closes with a plain-English note on what the report is and is not.
