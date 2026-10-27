/**
 * Runs the weekly planner/judge loop locally against the deployed Gateway and Bedrock.
 * Usage: AWS_PROFILE=tomassabol pnpm --filter @dinner/agents plan-local [week] [out.json]
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createGatewayClient } from '../src/gateway.js';
import { loadWeeklyConfig } from '../src/config.js';
import { WEEKLY_TOOL_FILTER, runWeekly } from '../src/weekly/run-weekly.js';

const [week = 'next', out] = process.argv.slice(2);
const region = 'eu-west-1';
const url = execFileSync(
  'aws',
  ['ssm', 'get-parameter', '--name', '/dinner-prod/gateway/url', '--query', 'Parameter.Value', '--output', 'text', '--region', region],
  { encoding: 'utf8' },
).trim();

const gateway = createGatewayClient({ url, region, householdId: 'home', caller: 'weekly', toolFilters: WEEKLY_TOOL_FILTER });
const started = Date.now();
try {
  const plan = await runWeekly({ householdId: 'home', week }, loadWeeklyConfig({ AWS_REGION: region, ...process.env }), gateway, (message, data) =>
    console.log(`[${Math.round((Date.now() - started) / 1000)}s] ${message}`, data ?? ''),
  );
  console.log(`\n${plan.week}: ${plan.status} after ${plan.rounds} round(s), score ${plan.verdict.score}/10`);
  console.log(plan.verdict.summary);
  for (const d of plan.dinners) {
    const offers = d.ingredients.filter((i) => i.offerId).length;
    console.log(`- ${d.date} ${d.dish} [${d.mainProtein}, ${d.cuisine}, ${d.cookingMinutes} min] ${d.nutrition.kcal} kcal, ${d.nutrition.protein} g protein, ${offers} offers, ~${d.estimatedCostDkk} DKK`);
  }
  if (plan.checks.length) console.log('Checks:', plan.checks);
  console.log('Usage:', plan.usage, `in ${Math.round((Date.now() - started) / 1000)}s`);
  if (out) writeFileSync(out, JSON.stringify(plan, null, 2));
} finally {
  await gateway.disconnect();
}
