# Serverless Dinner Planner

Weekly dinner plans built from Danish or Swedish supermarket offers, with Strands agents on Bedrock AgentCore and Claude via the Claude API. Every household gets its own weekly plan; each one picks Denmark or Sweden (and, in Sweden, where it shops) in the web app's Settings tab. See [docs/plan.md](docs/plan.md) for the architecture and roadmap.

## Layout

```
infra/            CDK app (TypeScript, run via tsx)
packages/shared/  Shared types, Zod schemas, chain list, week helpers
packages/ingest/  Daily offer ingest per market: Tjek (Danish chains, Swedish ICA/Willys/Lidl/Coop/City Gross) and Axfood (Hemköp) → S3 raw + DynamoDB + week snapshots
packages/tools/   AgentCore Gateway tools (offers, Frida nutrition, preferences, meal history) and the request interceptor
packages/agents/  Strands agents on AgentCore Runtime: weekly planner + judge loop with code-only plan checks
packages/workflow/ Sunday dispatcher (one run per household) and the durable weekly workflow: run the planner, save plan + shopping list, meal photos, SES email
packages/api/     Web API: streaming chat Lambda (API Gateway REST + Cognito) and conversation/plan/rating/household endpoints
apps/web/         React app (Vite): plan view with shopping list and ratings, streaming chat with history, household settings
scripts/          Operational scripts
```

## Prerequisites

- Node 24 (`.nvmrc`), pnpm 11
- AWS profile `tomassabol`, region `eu-west-1` (CDK already bootstrapped)
- `ANTHROPIC_API_KEY` in the repo's `.env` (local scripts load it from there). Deployed code reads it from Secrets Manager; after the first deploy of `dinner-prod-data`, and whenever the key changes, copy it there:

```bash
scripts/put-anthropic-key.sh
```

## Commands

```bash
pnpm install
pnpm build && pnpm typecheck
pnpm -r test
```

Fetch and normalize offers locally without writing to AWS (`--tag` also classifies a sample with Claude). Without `--near` it fetches the Danish chains; with `--near=<lat>,<lng>` the nearest Swedish stores:

```bash
AWS_PROFILE=tomassabol pnpm --filter @dinner/ingest dry-run --tag netto
```

```bash
pnpm --filter @dinner/ingest dry-run --near=57.7089,11.9746
```

Call the deployed Gateway tools over MCP (SigV4, household `home`); with no tool name it lists the tools:

```bash
AWS_PROFILE=tomassabol pnpm --filter @dinner/tools call-gateway search_offers '{"query":"laks","week":"next"}'
```

After changing a tool's Zod input, regenerate the Gateway schema (a test fails if it is stale):

```bash
pnpm --filter @dinner/tools gen:schema
```

Run the weekly planner/judge loop locally against the deployed Gateway and the Claude API:

```bash
AWS_PROFILE=tomassabol pnpm --filter @dinner/agents plan-local next
```

Invoke the deployed weekly runtime (AgentCore Runtime, IAM auth):

```bash
AWS_PROFILE=tomassabol pnpm --filter @dinner/agents invoke next
```

Every Sunday at 17:00 (Copenhagen/Stockholm time) the dispatcher refreshes every market's offers once and starts one weekly workflow per household. Run it by hand for all households, or only some (`householdIds`); `skipFetch` skips the offer refresh, `sendEmail: false` skips the email:

```bash
aws lambda invoke --function-name dinner-prod-workflow-dispatch --cli-binary-format raw-in-base64-out --payload '{"week":"next","householdIds":["home"]}' --profile tomassabol --region eu-west-1 /dev/stdout
```

Or start one household's workflow directly (it refreshes only that household's market):

```bash
aws lambda invoke --function-name dinner-prod-workflow-weekly-plan:live --invocation-type Event --cli-binary-format raw-in-base64-out --payload '{"householdId":"home","week":"next"}' --profile tomassabol --region eu-west-1 /dev/null
```

Preview the plan email for a plan JSON file (from `pnpm --filter @dinner/agents invoke next plan.json`):

```bash
AWS_PROFILE=tomassabol pnpm --filter @dinner/workflow preview-email plan.json preview.html
```

Chat with the agent locally (deployed Gateway and Memory, Claude API), or through the deployed streaming Lambda:

```bash
AWS_PROFILE=tomassabol pnpm --filter @dinner/agents chat-local conv-$(uuidgen | tr 'A-Z' 'a-z') "What's for dinner on Wednesday?"
```

```bash
AWS_PROFILE=tomassabol pnpm --filter @dinner/api invoke-chat "What's for dinner on Wednesday?"
```

The web app is served at https://d2ivvz1qrl3ljv.cloudfront.net (app, `/images/*` and `/api/*` share one CloudFront distribution and deploy with `dinner-prod-cdn`). To run it locally against the deployed backend:

```bash
AWS_PROFILE=tomassabol pnpm --filter @dinner/web dev-config
```

```bash
pnpm --filter @dinner/web dev
```

Open http://localhost:5173, or http://localhost:5173/?preview to see the signed-in UI with real plan data and a simulated chat, without Cognito (dev server only; stripped from production builds).

Run the deployed ingest by hand (it also runs daily at 05:00 Copenhagen time, for Denmark and every Swedish household location; pass `{"householdIds":["<id>"]}` to refresh one household's market):

```bash
aws lambda invoke --function-name dinner-prod-ingest --payload '{}' --cli-binary-format raw-in-base64-out --cli-read-timeout 900 --profile tomassabol --region eu-west-1 /dev/stdout
```

```bash
cd infra && AWS_PROFILE=tomassabol npx cdk diff -c alertEmail=you@example.com
```

```bash
cd infra && AWS_PROFILE=tomassabol npx cdk deploy --all -c alertEmail=you@example.com
```

To avoid passing `alertEmail` every time, add it to `infra/cdk.context.json`.

## Stage and tags

There is a single stage, `prod` (the default `stage` context). Every resource is tagged `project=dinner-planner` and `stage=prod`, and physical names are prefixed `dinner-prod-`.

## Households

The app is multi-tenant. A household is every Cognito user that shares a `custom:householdId`; its plans, meal history, preferences, chat conversations and long-term memory are all keyed on that id, which the API and tools read only from the verified token (never from the request or the model). The Sunday dispatcher plans one week per household it finds in Cognito.

Where a household shops is set in the web app's **Settings** tab:
- **Denmark**: national flyers from Netto, Lidl, REMA 1000, føtex, Bilka, 365discount, SuperBrugsen, Brugsen, Kvickly, SPAR and MENY.
- **Sweden**: Swedish flyers are per store, so the household picks its city (or shares its location) and gets the nearest Maxi ICA, ICA Kvantum, ICA Supermarket, ICA Nära, Hemköp, Willys, Lidl, Coop, Stora Coop and City Gross within 15 km. Saving starts an offer fetch for that location right away; plans and the chat then use SEK.

Existing households default to Denmark. Preferred stores are limited to the household's country.

## After the first deploy

1. Create the household members (Cognito emails each person a temporary password, valid for 7 days; the first sign-in in the web app asks for a new password and a first name). Members of the same household share the third argument; a new household just needs a new id:
   ```bash
   scripts/create-user.sh you@example.com [given-name] [household-id]
   ```
2. Confirm the SES verification emails for the sender and every household address (SES is in sandbox mode, so recipients must be verified). Addresses live in `infra/cdk.context.json` (`senderEmail`, `householdEmails`); add every new member there and redeploy `dinner-prod-workflow`.
3. Confirm the SNS subscription email for `dinner-prod-alerts`, so ingest alarms reach you.
4. Activate the `project` cost allocation tag in Billing → Cost allocation tags, so the budget filter starts working. The tag only shows up there after tagged resources exist.

## Data attribution

Nutrition data comes from Frida, the Danish Food Composition Database (DTU Food), version 5.5, licensed CC BY 4.0. See [packages/tools/data/NOTICE.md](packages/tools/data/NOTICE.md).
