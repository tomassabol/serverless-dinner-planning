/**
 * Invokes the deployed weekly runtime, like Step Functions will.
 * Usage: AWS_PROFILE=tomassabol pnpm --filter @dinner/agents invoke [week] [out.json]
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
import type { MealPlan } from '@dinner/shared';

const [week = 'next', out] = process.argv.slice(2);
const region = 'eu-west-1';
const runtimeArn = execFileSync(
  'aws',
  ['ssm', 'get-parameter', '--name', '/dinner-prod/agents/weekly-runtime-arn', '--query', 'Parameter.Value', '--output', 'text', '--region', region],
  { encoding: 'utf8' },
).trim();

const client = new BedrockAgentCoreClient({ region, requestHandler: { requestTimeout: 15 * 60_000 } });
const started = Date.now();
const response = await client.send(
  new InvokeAgentRuntimeCommand({
    agentRuntimeArn: runtimeArn,
    runtimeSessionId: `weekly-local-${randomUUID()}`,
    contentType: 'application/json',
    accept: 'application/json',
    payload: new TextEncoder().encode(JSON.stringify({ action: 'plan_week', householdId: 'home', week })),
  }),
);
const body = JSON.parse(await response.response!.transformToString()) as { plan?: MealPlan; error?: string };
console.log(`HTTP ${response.statusCode} in ${Math.round((Date.now() - started) / 1000)}s`);
if (!body.plan) {
  console.log(body);
  process.exit(1);
}
const { plan } = body;
console.log(`${plan.week}: ${plan.status} after ${plan.rounds} round(s), score ${plan.verdict.score}/10`);
console.log(plan.verdict.summary);
for (const d of plan.dinners) console.log(`- ${d.date} ${d.dish} (${d.nutrition.kcal} kcal, ${d.nutrition.protein} g protein)`);
console.log('Usage:', plan.usage);
if (out) writeFileSync(out, JSON.stringify(plan, null, 2));
