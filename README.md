# Serverless Dinner Planner

Weekly dinner plans built from Danish supermarket offers, with Strands agents on Bedrock AgentCore. See [docs/plan.md](docs/plan.md) for the architecture and roadmap.

## Layout

```
infra/            CDK app (TypeScript, run via tsx)
packages/shared/  Shared types, Zod schemas, chain list, week helpers
packages/ingest/  Daily offer ingest: Tjek → S3 raw + DynamoDB + week snapshots
packages/tools/   AgentCore Gateway tools (offers, Frida nutrition, preferences, meal history) and the request interceptor
packages/agents/  Strands agents on AgentCore Runtime: weekly planner + judge loop with code-only plan checks
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

1. Create the household members (Cognito emails each person a temporary password):
   ```bash
   scripts/create-user.sh you@example.com [given-name]
   ```
2. Confirm the SNS subscription email for `dinner-prod-alerts`, so ingest alarms reach you.
3. Activate the `project` cost allocation tag in Billing → Cost allocation tags, so the budget filter starts working. The tag only shows up there after tagged resources exist.

## Data attribution

Nutrition data comes from Frida, the Danish Food Composition Database (DTU Food), version 5.5, licensed CC BY 4.0. See [packages/tools/data/NOTICE.md](packages/tools/data/NOTICE.md).
