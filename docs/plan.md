# Serverless Dinner Planner — Architecture Review & Plan

Region `eu-west-1`, AWS profile `tomassabol`, CDK (TypeScript), Strands Agents (TypeScript), Bedrock AgentCore.

---

## 1. Grocery offer data sources (research, 2026-10-27)

| Source | Chains | Official? | Notes |
|---|---|---|---|
| **Tjek / eTilbudsavis** `squid-api.tjek.com/v2` | All of them (one integration) | Public endpoints, **not** a licensed API for us | Structured JSON: heading, description, `pricing.price` / `pre_price`, quantity + SI unit, `run_from` / `run_till`, `publish`, product images. No auth needed right now. |
| Salling Group API `api.sallinggroup.com` | Netto, føtex, Bilka | Yes, free signup, API key | **No weekly-offers API.** It has Anti Food Waste (per-store markdowns), Stores, Product Suggestions, Holidays and Jobs. Anti Food Waste is a nice extra later. |
| REMA 1000 web product API | REMA 1000 | Unofficial | Only known from third-party scrapers. Not verified. |
| Coop (365, SuperBrugsen, Brugsen, Kvickly) | Coop | No public API | The Coop app is private. |
| Lidl | Lidl | No public API | Only reachable through Tjek. |
| Apify actors (paid) | Mixed | Third party | A fallback if Tjek stops working. |

**I checked these dealer IDs live against Tjek (`/v2/dealers?country_id=DK`):**

| Chain | Tjek `dealer_id` |
|---|---|
| Netto | `9ba51` |
| Lidl | `71c90` |
| REMA 1000 | `11deC` |
| føtex | `bdf5A` |
| Bilka | `93f13` |
| 365discount | `DWZE1w` |
| SuperBrugsen | `0b1e8` |
| Brugsen | `d311fg` |
| Kvickly | `c1edq` |
| SPAR | `88ddE` |
| MENY | `267e1m` |
| Løvbjerg (regional, not ingested by default) | `65caN` |
| ABC Lavpris (regional, one catalog per store, not ingested by default) | `70d42L` |

Useful endpoints: `GET /v2/catalogs?dealer_ids=<id>`, then `GET /v2/offers?catalog_ids=<id>&limit=100&offset=N`, plus `GET /v2/dealers`.

Learned while building Phase 1:
- Tjek rejects `offset + limit` above 1000 (`PAGINATION_MAX_REACHED`), so offers are fetched per catalog. That also lets us skip non-food catalogs (Bilka's toy and electronics flyers). Dealers without listed catalogs (Løvbjerg) fall back to dealer paging.
- The 11 default chains give about 2,700 offers. The first full tagging run cost about $0.96 (238k input and 144k output tokens on Haiku 4.5) and took 6 minutes. Later runs only tag new offers and take about 15 seconds.
- Next week's flyers appear gradually from Tuesday to Saturday, so the next-week snapshot fills up during the week.
- Lidl's "Fast lav pris" catalog lists everyday prices that run until the end of the year. They're not deals; the planner should weight them lower.

**⚠️ Legal / ToS risk:** Tjek's terms say the API is for contracted customers only. Access through third-party apps needs written approval, and using the data to *train or develop* AI/ML models is prohibited. Feeding offers into prompts is not training, but this project still sits outside their terms.
**Recommendation:** email `services@tjek.com` to ask for personal, non-commercial use. Keep the volume tiny (≈15 dealers × a few pages, once a day), cache everything, never redistribute, and hide the source behind an `OfferSource` interface so it can be swapped out.

---

## 2. What I'd change in the proposed design

### Ingestion
1. **Fetch daily, not only Sunday 00:00.** Flyers are `publish`ed days before `run_from`, and chains switch weeks on different days. Netto's current flyer, for example, runs Sat 00:00 → Fri 23:59 local time. A daily idempotent upsert keyed on offer `id` is cheap. The planner then filters on offers that are *valid on the day the meal is planned*.
2. **Use EventBridge Scheduler with `timezone: Europe/Copenhagen`.** A plain UTC cron drifts by an hour when daylight saving time changes.
3. **Raw data goes to S3, normalized data goes to DynamoDB.** Store the raw JSON per dealer and day (replayable, debuggable). Normalize into a common `Offer` shape: price per kg/l, valid dates, chain, image, and a category.
4. **Enrich at ingest time with a cheap model.** Run a Haiku batch that tags each offer: `isFood`, `category` (protein / veg / carb / dairy / pantry / non-food) and `canonicalIngredient`. This drops roughly half the offers (non-food, drinks, candy) and saves a lot of planner tokens.
5. **Search:** DynamoDB is poor at text search. The week's food offers come to about 1–3k items, so the tool Lambda can load the week's normalized JSON from S3 into memory and use fuzzy search (e.g. `fuse.js`) plus filters. That means no OpenSearch.

### Agents
6. **Planner and judge share one AgentCore Runtime and form an evaluator–optimizer loop**, with a hard cap of 3 iterations. Two Strands `Agent` instances, or a Strands Graph with a conditional edge. Two separate runtimes add latency and IAM work for no gain.
7. **Run deterministic checks before the LLM judge**, in plain code:
   - no repeated dish or main protein within N weeks (from the plan history table)
   - **allergens: hard fail, never left to an LLM**
   - every dish uses at least one valid offer, and the offer is valid on that day
   - the nutrition totals are within range

   The LLM judge then scores only the subjective parts (variety, appeal, effort, seasonality) and returns structured feedback.
8. **The judge sees only the plan and the context**, never the planner's reasoning, so it doesn't just rubber-stamp it. Use Zod schemas and structured output for both `MealPlan` and `JudgeVerdict`.
9. **Nutrition comes from a database, not from the LLM.** LLMs make up macros. Ingest DTU's **Frida** Danish food composition database (open data) and expose a `nutrition_lookup(ingredient, grams)` tool. The planner gives ingredients in grams and the code adds them up.
10. **Models in eu-west-1 use the `eu.` cross-region inference profiles.** Check availability with `aws bedrock list-inference-profiles --region eu-west-1 --profile tomassabol`. Sonnet for the planner, which makes many tool calls. Sonnet or Opus for the judge. Haiku for ingest tagging. **As of 2026-10-27 this account can call Haiku 4.5 and Sonnet 4.6, but not the Claude 5 family (Haiku/Sonnet/Opus 5.x return AccessDenied).** Request access before Phase 3, or use Sonnet 4.6. Use prompt caching on the system prompt and the offers context.
11. **Side effects stay outside the agent.** The agent returns a validated plan as JSON. The workflow (a Lambda durable function) then saves it, generates images and sends the email. Retries become deterministic and the agent can't send twice.

### Images
12. Tjek images show *products*, not meals. Generate one image per meal with a Bedrock image model and store it in S3 behind CloudFront, via an image model available in eu-west-1 (verify first). Scraping recipe-site photos has copyright problems. As a cheap fallback, show the main offer's product image.

### Notifications
13. **Use SES instead of SNS for the email.** SNS email is plain text only and needs a confirmation per subscriber. SES gives an HTML email with images, a per-store shopping list and a link to the app. SES sandbox mode is fine: just verify both addresses.

### Auth & multi-user
14. **Cognito user pool, self-signup off, 2 users in a `household`.** Key plans and preferences on `householdId`, so both of you see the same plan. Allergies and dislikes stay per person.
15. **Security: tool Lambdas take `householdId` only from a trusted source, never from model-supplied arguments.** Otherwise a prompt injection (for example from offer text) could read or write another household's data. *Implemented in Phase 2:* the Gateway uses `AWS_IAM` auth, so only the agent runtimes' roles can call it. Each runtime sends `X-Dinner-Household-Id` (from the workflow input, or from the chat user's Cognito claims) and `X-Dinner-Caller` (`weekly` or `chat`). A REQUEST interceptor writes the household into the tool arguments, overwriting any model value, and blocks write tools (`update_preferences`) unless the caller is `chat`. This replaced the Cognito machine-to-machine plan, which costs about $6/month per app client.

### Memory
16. **AgentCore Memory:** short-term memory for chat sessions; long-term memory with user-preference and semantic strategies for soft taste signals ("we liked the Thai curry").
17. **Allergies and hard constraints belong in DynamoDB**, written by a tool and read by the planner on every run. Long-term memory extraction is fuzzy and must not be the source of truth for safety data.
18. Keep the conversation *list* (title, last message time) in DynamoDB for the sidebar. The message content lives in AgentCore Memory.

### Chat path
19. Browser → CloudFront (`/api/*` behavior, same origin so no CORS) → **API Gateway REST API with response streaming** (Lambda proxy integration, `responseTransferMode: STREAM`) + **Cognito user pool authorizer** → chat Lambda (`awslambda.streamifyResponse`) → `InvokeAgentRuntime` (streaming) → SSE chunks back to the browser.
    - The Cognito authorizer validates the JWT before the Lambda runs. The Lambda reads `householdId` / `sub` from `requestContext.authorizer.claims` and passes them to the runtime as the session's identity, never as model input.
    - Also gives you throttling/usage plans, access logs and WAF if ever needed.
    - Check streaming limits (integration timeout, payload/bandwidth after the first MBs) against a long agent turn; keep chat turns short and push long work (re-planning) to the weekly workflow.
    - Non-streaming routes on the same API: `GET /plans/{week}`, `GET /conversations`, `POST /meals/{date}/rating`.
20. "Start the weekly flow again" becomes a tool that calls `StartExecution` on the planning state machine with `{ skipFetch: true, reason }`, and returns at once. The UI polls the plan status, or you get the email.

### Product improvements
- **A shopping list grouped by store**, with the expected cost and savings versus `pre_price`. This is probably the most useful output.
- Rate each meal (👍/👎) in the UI. The ratings go into long-term memory and the history table, so the planner learns over time.
- Settings: number of dinners (e.g. 5 plus leftovers), max cooking time on weekdays, preferred stores, budget.
- Pantry staples list, so it doesn't plan around buying salt.
- Later: Salling Anti Food Waste markdowns for your local Netto or føtex.

---

## 3. Target architecture

```
EventBridge Scheduler (Europe/Copenhagen)
 ├─ daily 05:00 ─► Ingest Lambda ─► Tjek API ─► S3 raw ─► normalize + Haiku tag ─► S3 week.json + DDB Offers
 └─ Sun 17:00 ─► Durable Lambda "weekly-plan"
                   1. (optional) ensure ingest is fresh
                   2. InvokeAgentRuntime: Planner⇄Judge (max 3 rounds) ──► AgentCore Gateway ──► Tools Lambda(s)
                   3. Validate plan (Zod) ─► DDB Plans + History                               ├ search_offers
                   4. map: generate meal images ─► S3/CloudFront                               ├ nutrition_lookup (Frida)
                   5. SES HTML email (plan + shopping list + link)                             ├ get_history / get_preferences
                                                                                               ├ get_plan / update_plan_day
React (Vite) on S3 + CloudFront ─► API GW REST /api/chat (streaming, Cognito authorizer)        ├ update_preferences
                                     └► Chat Lambda ─► InvokeAgentRuntime: Chat agent ─► Gateway └ trigger_replan (→ workflow)
Cognito user pool (household group), AgentCore Memory (STM + LTM), AgentCore Observability → CloudWatch
```

### DynamoDB (single table, or a few small tables)
- `HOUSEHOLD#<id>` / `PROFILE#<userId>`: allergies, dislikes, diet
- `HOUSEHOLD#<id>` / `PLAN#<isoWeek>`: plan, judge score, iterations, status
- `HOUSEHOLD#<id>` / `MEAL#<date>`: dish, tags, main protein, rating (repetition history)
- `HOUSEHOLD#<id>` / `CONV#<sessionId>`: chat sidebar index
- `OFFERWEEK#<isoWeek>` / `OFFER#<id>`: normalized offers (TTL 30 days)

### Observability (AgentCore Observability, required for every agent)
- **Account prerequisite (Phase 0, Monitoring stack):** CloudWatch Transaction Search is enabled. X-Ray spans go to the `aws/spans` log group, which the CloudWatch GenAI Observability → Bedrock AgentCore views read.
- **Runtimes (planner-judge, chat):** the agent containers start with ADOT/OpenTelemetry auto-instrumentation (Node `--require @aws/aws-distro-opentelemetry-node-autoinstrumentation/register`, `OTEL_*` env vars). Strands' built-in OTel spans then show agent loops, model calls (tokens, latency) and tool calls. The runtime role gets the X-Ray and CloudWatch Logs permissions.
- **Session and trace correlation:** every invocation passes a `runtimeSessionId` (the chat conversation id, or `weekly-<isoWeek>-<executionId>`), so a durable execution, its agent session and its Gateway tool calls can be followed together. Add span attributes for `household.id`, `plan.week` and `judge.iteration`/`judge.score`.
- **Gateway and Memory:** turn on log and trace delivery for the Gateway and the Memory resource (CloudWatch Logs + X-Ray destinations) in CDK.
- **Tool Lambdas, ingest and chat Lambda:** active X-Ray tracing and Powertools for TypeScript (logger, tracer, metrics), so their spans join the same trace.
- **Custom metrics (EMF):** judge iterations per run, final judge score, tokens and estimated cost per run, offers ingested per chain. Alarms: weekly run failed or did not run, judge cap reached, ingest returned 0 offers for a chain.

---

## 4. Repository layout (pnpm workspaces)

```
infra/                 CDK app: bin/app.ts, lib/stacks/*, single stage `prod` (context `stage`)
packages/shared/       Zod schemas (Offer, MealPlan, JudgeVerdict, Preferences), types
packages/ingest/       Tjek OfferSource adapter, normalizer, tagger
packages/tools/        Gateway tool Lambdas
packages/agents/       planner-judge runtime + chat runtime (Strands TS, Express, /ping + /invocations, arm64)
packages/workflow/     Durable weekly workflow Lambda plus its planner and image task Lambdas
apps/web/              React + Vite chat UI (Amplify Auth lib for Cognito only)
```

CDK stacks: `Data`, `Auth`, `Ingest`, `Tools+Gateway`, `Agents+Memory`, `Workflow`, `Api` (API Gateway + chat Lambda), `Web`. Every stack gets `Tags.of(app).add('project', 'dinner-planner')` and `Tags.of(app).add('stage', stage)`. Resource names are prefixed `dinner-<stage>-`. For AgentCore, use the `@aws-cdk/aws-bedrock-agentcore-alpha` L2 constructs where they cover what we need, otherwise the L1 `Cfn*` resources.

---

## 5. Phased plan

| Phase | Deliverable | Done when |
|---|---|---|
| **0. Foundations** ✅ | pnpm monorepo, CDK bootstrap in eu-west-1, tags/stage, Cognito pool with 2 users, AWS Budget alarm, CloudWatch Transaction Search (AgentCore Observability prerequisite) | `cdk deploy --all` works and resources are tagged |
| **1. Offer ingestion** ✅ | Tjek adapter, normalization, Haiku tagging, S3 + DDB, daily schedule | a week of normalized food offers for all target chains in S3 |
| **2. Tools + Gateway** ✅ | Tools Lambda, Frida nutrition import, AgentCore Gateway (AWS_IAM auth + household-injecting interceptor) | the tools can be called via the Gateway MCP endpoint from a local script |
| **3. Planner + Judge** ✅ | Strands TS runtime with ADOT instrumentation, deterministic checks, judge loop, Zod output; first run locally, then on AgentCore | a valid 5–7 day plan from fixture offers; a small eval set (allergy, repetition, budget) passes |
| **4. Weekly workflow** ✅ | Workflow (Step Functions, later a Lambda durable function), images, SES email, plan + history persistence | a Sunday run produces the email end to end |
| **5. Chat agent** ✅ | Chat runtime, AgentCore Memory (STM/LTM), preference tools, `trigger_replan`, API Gateway (streaming) + chat Lambda | you can change Wednesday's meal and add an allergy via chat |
| **6. Web app** ✅ | React chat with history sidebar, plan view, 👍/👎, login | it runs on CloudFront behind Cognito |
| **7. Hardening** | Observability dashboards and alarms tuned on real runs, cost per run metric, Tjek fallback, prompt caching tuning | about a month of unattended Sundays |

### Phase 3 notes
- **Runtime packaging:** code-zip deploy on `NODE_22`, entry point `["opentelemetry-instrument", "main.js"]`. `main.js` is an esbuild **CommonJS** bundle, because ADOT only instruments CommonJS. `node_modules` holds only ADOT plus two Fastify plugins that `bedrock-agentcore` loads via `createRequire`. CDK builds it with local asset bundling (`packages/agents/scripts/package-runtime.ts`); no Docker or ECR.
- **Loop:** the planner (Strands, Gateway read tools only) produces a structured `MealPlanDraft`. Code then computes per-serving nutrition through `nutrition_lookup`, checks every offer id with `get_offer`, and runs `checkPlan`, which covers allergens, dislikes, repetition, thumbs-down dishes, offer validity, nutrition ranges and weekday cooking time. Blocking findings go straight back to the planner. Otherwise a fresh judge agent scores the plan. There are at most 3 rounds, and the best plan without blocking issues wins.
- **First real run (week 45):** approved in round 2 with score 7. Round 1 scored 4 with 13 findings. It took about 3 minutes on Sonnet 4.6.
- **Strands MCP tool filters** match strings exactly, and regex filters are anchored at the start of the name. Use full names like `dinner-tools___search_offers`.

### Phase 4 notes
- **Workflow:** EventBridge Scheduler (Sunday 17:00, Europe/Copenhagen) invokes the `dinner-prod-workflow-weekly-plan:live` durable function asynchronously (it replaced the original Step Functions state machine). Its steps: refresh offers (unless `skipFetch`) → plan Lambda (`InvokeAgentRuntime`) → save the plan, shopping list and meal history → map: one photo per dinner, max 3 at once (retried once, then a `null` URL) → attach images → send email (unless `sendEmail: false`, never retried). The ingest, plan and image Lambdas are chained `context.invoke` calls, so the orchestrator is suspended while they run; the rest are checkpointed steps. Executions start through the `live` alias, so each one is pinned to the version it started on. Alarms fire on `DurableExecutionFailed` and `DurableExecutionTimedOut`.
- **Images:** no text-to-image model is offered in the EU regions. Stability Stable Image Core in **us-west-2** is used instead, at about $0.04 per image. Photos are stored at `images/<household>/<week>/<date>-<dish>.jpg`, so unchanged dinners reuse their photo when a week is re-planned. They're served by CloudFront (`CdnStack`), which Phase 6 will extend with the web app as its default behavior.
- **Email:** SES is in sandbox mode, using verified email identities. `tomassabol.com` DNS is hosted at Vercel, so domain DKIM would need three CNAME records added there. That would improve deliverability and is an optional follow-up.
- **Plan quality:** on a Tuesday most chains haven't published next week's flyer yet, so the planner falls back on Lidl's everyday prices. A minor check now flags dinners with no real deal. The Sunday run sees far more offers.

### Phase 5 notes
- **Chat runtime** (`dinner_prod_chat`): built from the same code package as the weekly runtime (`chat.js`). It streams SSE events: `text` deltas, `tool`, `done`, `error`.
- **AgentCore Memory** (`dinner_prod_memory`): the actor is the household, so both members share what the assistant learns, and every message carries the speaker's name. Short-term history is reloaded from `ListEvents` on each turn. A Strands `MemoryManager` with the SDK's AgentCore stores injects long-term recall and writes the turn back. Its strategies are user preferences (`/households/{actorId}/preferences`), facts (`/households/{actorId}/facts`) and session summaries. Allergies are still saved authoritatively in DynamoDB through `update_preferences`.
- **New chat-only Gateway tools:** `get_plan`, `replace_dinner` (blocks allergens, recomputes nutrition and the shopping list, syncs history, and generates a new photo asynchronously), `remove_dinner`, `rate_meal` and `replan_week` (starts the workflow with `skipFetch`). The interceptor allows all write tools only for `X-Dinner-Caller: chat`.
- **API:** REST API with a Cognito authorizer (ID token, which carries `custom:householdId`).
  - `POST /chat` streams through API Gateway response streaming to a `streamifyResponse` Lambda, then to `InvokeAgentRuntime`. The integration timeout is 10 minutes.
  - `GET /conversations`, `GET /conversations/{id}` and `GET /plans/{week}` are buffered.
  - The conversation index (`CONV#…`) also acts as the ownership check for reading messages.
- **Cycle avoidance:** the Gateway tools reach the Workflow stack's weekly-plan alias and image Lambda through ARNs built from names, not CloudFormation references.
- **Lessons:** the model can't be trusted to map weekdays to dates, so the system prompt lists every date with its day name and `get_plan` returns day names. `@fastify/sse` JSON-encodes `data`, so the runtime yields objects rather than strings.

### Phase 6 notes
- **One CloudFront distribution, all same-origin:**
  - `/` serves the React app from the web bucket.
  - `/images/*` serves the media bucket, so existing image URLs keep working.
  - `/api/*` goes to API Gateway. A CloudFront Function strips the prefix, caching is disabled, all viewer headers except Host are forwarded, and the origin read timeout is 60 s. The chat Lambda sends SSE keep-alive comments every 15 s, and only between complete frames.
  - The response headers policy sets the CSP (`connect-src` is self plus Cognito), HSTS, frame-deny and nosniff.
- **App:** Vite + React 19, using only Amplify's Auth part.
  - Sign-in handles the new-password challenge on first login and saves `given_name`, which the chat uses as the speaker's name.
  - The Cognito ID token is sent to the API, because the authorizer reads `custom:householdId` from it.
  - The shopping list remembers ticked items per week in `localStorage`.
  - `config.json` is written at deploy time with `Source.jsonData`, and the app is built by CDK local bundling.
- **New endpoint:** `POST /meals/{date}/rating`. `GET /plans/{week}` now includes each dinner's rating.
- **Dev preview** (`/?preview`, Vite dev server only) renders the signed-in UI from real plan JSON with a simulated chat stream, so the UI can be checked without credentials.
- **Not yet verified:** a real Cognito sign-in and an authenticated chat through CloudFront → API Gateway streaming. The first real login is that test.

### Open decisions
1. Tjek ToS: ask for permission, or accept the personal-use risk?
2. Number of dinners per week, leftovers, and weekday cooking-time limit.
3. Image generation (cost per image) or product images only.
