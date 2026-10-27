# Serverless Dinner Planner

Weekly dinner plans built from Danish supermarket offers, with Strands agents on Bedrock AgentCore. See [docs/plan.md](docs/plan.md) for the architecture and roadmap.

## Layout

```
infra/            CDK app (TypeScript, run via tsx)
packages/shared/  Shared types, Zod schemas, chain list, week helpers
packages/ingest/  Daily offer ingest: Tjek → S3 raw + DynamoDB + week snapshots
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
