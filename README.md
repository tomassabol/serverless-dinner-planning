# Serverless Dinner Planner

Weekly dinner plans built from Danish supermarket offers, with Strands agents on Bedrock AgentCore. See [docs/plan.md](docs/plan.md) for the architecture and roadmap.

## Layout

```
infra/            CDK app (TypeScript, run via tsx)
packages/shared/  Shared types, Zod schemas, chain list, week helpers
packages/ingest/  Daily offer ingest: Tjek → S3 raw + DynamoDB + week snapshots
packages/tools/   AgentCore Gateway tools (offers, Frida nutrition, preferences, meal history) and the request interceptor
packages/agents/  Strands agents on AgentCore Runtime: weekly planner + judge loop with code-only plan checks
packages/workflow/ Durable weekly workflow Lambda: run the planner, save plan + shopping list, meal photos, SES email
packages/api/     Web API: streaming chat Lambda (API Gateway REST + Cognito) and conversation/plan/rating endpoints
apps/web/         React app (Vite): plan view with shopping list and ratings, streaming chat with history
scripts/          Operational scripts
```

## Prerequisites

- Node 24 (`.nvmrc`), pnpm 11
- AWS profile `tomassabol`, region `eu-west-1` (CDK already bootstrapped)

## Commands

```bash
pnpm install
pnpm build && pnpm typecheck
pnpm -r test
```

Fetch and normalize offers locally without writing to AWS (`--tag` also classifies a sample with Bedrock):

```bash
AWS_PROFILE=tomassabol pnpm --filter @dinner/ingest dry-run --tag netto
```

Call the deployed Gateway tools over MCP (SigV4, household `home`); with no tool name it lists the tools:

```bash
AWS_PROFILE=tomassabol pnpm --filter @dinner/tools call-gateway search_offers '{"query":"laks","week":"next"}'
```

After changing a tool's Zod input, regenerate the Gateway schema (a test fails if it is stale):

```bash
pnpm --filter @dinner/tools gen:schema
```

Run the weekly planner/judge loop locally against the deployed Gateway and Bedrock:

```bash
AWS_PROFILE=tomassabol pnpm --filter @dinner/agents plan-local next
```

Invoke the deployed weekly runtime (AgentCore Runtime, IAM auth):

```bash
AWS_PROFILE=tomassabol pnpm --filter @dinner/agents invoke next
```

Start the weekly workflow by hand (it also runs every Sunday at 17:00 Copenhagen time). `skipFetch` skips the offer refresh, `sendEmail: false` skips the email:

```bash
aws lambda invoke --function-name dinner-prod-workflow-weekly-plan:live --invocation-type Event --cli-binary-format raw-in-base64-out --payload '{"householdId":"home","week":"next"}' --profile tomassabol --region eu-west-1 /dev/null
```

Preview the plan email for a plan JSON file (from `pnpm --filter @dinner/agents invoke next plan.json`):

```bash
AWS_PROFILE=tomassabol pnpm --filter @dinner/workflow preview-email plan.json preview.html
```

Chat with the agent locally (deployed Gateway, Memory and Bedrock), or through the deployed streaming Lambda:

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

Run the deployed ingest by hand (it also runs daily at 05:00 Copenhagen time):

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

## After the first deploy

1. Create the household members (Cognito emails each person a temporary password, valid for 7 days; the first sign-in in the web app asks for a new password and a first name):
   ```bash
   scripts/create-user.sh you@example.com [given-name]
   ```
2. Confirm the SES verification emails for the sender and every household address (SES is in sandbox mode, so recipients must be verified). Addresses live in `infra/cdk.context.json` (`senderEmail`, `householdEmails`).
3. Confirm the SNS subscription email for `dinner-prod-alerts`, so ingest alarms reach you.
4. Activate the `project` cost allocation tag in Billing → Cost allocation tags, so the budget filter starts working. The tag only shows up there after tagged resources exist.

## Data attribution

Nutrition data comes from Frida, the Danish Food Composition Database (DTU Food), version 5.5, licensed CC BY 4.0. See [packages/tools/data/NOTICE.md](packages/tools/data/NOTICE.md).
