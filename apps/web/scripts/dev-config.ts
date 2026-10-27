/** Writes public/config.json and .dev-api from SSM so `pnpm dev` talks to the deployed backend. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const region = 'eu-west-1';
const param = (name: string) =>
  execFileSync('aws', ['ssm', 'get-parameter', '--name', name, '--query', 'Parameter.Value', '--output', 'text', '--region', region], {
    encoding: 'utf8',
  }).trim();

writeFileSync(
  'public/config.json',
  JSON.stringify({
    region,
    userPoolId: param('/dinner-prod/auth/user-pool-id'),
    userPoolClientId: param('/dinner-prod/auth/web-client-id'),
  }, null, 2),
);
writeFileSync('.dev-api', param('/dinner-prod/api/url').replace(/\/$/, ''));
console.log('Wrote public/config.json and .dev-api');

// Real plans for the dev-only preview mode (/?preview), fetched through the API Lambda as household "home".
mkdirSync('public/preview', { recursive: true });
for (const week of ['current', 'next']) {
  const event = JSON.stringify({
    resource: '/plans/{week}',
    httpMethod: 'GET',
    pathParameters: { week },
    requestContext: { authorizer: { claims: { sub: 'dev', 'custom:householdId': 'home' } } },
  });
  const outFile = join(mkdtempSync(join(tmpdir(), 'dinner-')), 'out.json');
  execFileSync('aws', ['lambda', 'invoke', '--function-name', 'dinner-prod-api', '--cli-binary-format', 'raw-in-base64-out', '--payload', event, '--region', region, outFile]);
  const result = JSON.parse(readFileSync(outFile, 'utf8')) as { statusCode: number; body: string };
  if (result.statusCode === 200) writeFileSync(`public/preview/plan-${week}.json`, result.body);
}
console.log('Wrote public/preview plans');
