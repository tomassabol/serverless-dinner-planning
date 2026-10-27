/**
 * Calls the deployed AgentCore Gateway over MCP with SigV4, like the agent runtimes will.
 * Usage: AWS_PROFILE=tomassabol pnpm --filter @dinner/tools call-gateway [tool] [json-args] [--caller chat|weekly]
 * Without a tool it lists the available tools.
 */
import { Sha256 } from '@aws-crypto/sha256-js';
import { fromNodeProviderChain } from '@aws-sdk/credential-providers';
import { SignatureV4 } from '@smithy/signature-v4';
import { execFileSync } from 'node:child_process';

const REGION = 'eu-west-1';
const args = process.argv.slice(2);
const callerIndex = args.indexOf('--caller');
const caller = callerIndex >= 0 ? args.splice(callerIndex, 2)[1]! : 'chat';
const [tool, rawArgs] = args;

const gatewayUrl = execFileSync(
  'aws',
  ['ssm', 'get-parameter', '--name', '/dinner-prod/gateway/url', '--query', 'Parameter.Value', '--output', 'text', '--region', REGION],
  { encoding: 'utf8' },
).trim();

const signer = new SignatureV4({
  service: 'bedrock-agentcore',
  region: REGION,
  credentials: fromNodeProviderChain(),
  sha256: Sha256,
});

let sessionId: string | undefined;
let nextId = 1;

async function rpc(method: string, params?: unknown, notification = false) {
  const url = new URL(gatewayUrl);
  const body = JSON.stringify({ jsonrpc: '2.0', method, ...(notification ? {} : { id: nextId++ }), ...(params ? { params } : {}) });
  const signed = await signer.sign({
    method: 'POST',
    protocol: url.protocol,
    hostname: url.hostname,
    path: url.pathname,
    headers: {
      host: url.hostname,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-dinner-household-id': 'home',
      'x-dinner-caller': caller,
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body,
  });

  const response = await fetch(url, { method: 'POST', headers: signed.headers, body });
  sessionId = response.headers.get('mcp-session-id') ?? sessionId;
  const text = await response.text();
  if (!response.ok) throw new Error(`${response.status} ${text}`);
  if (notification || !text) return undefined;
  // Streamable HTTP may answer with SSE; take the last data line.
  const json = response.headers.get('content-type')?.includes('text/event-stream')
    ? text.split('\n').filter((l) => l.startsWith('data:')).at(-1)!.slice(5)
    : text;
  const message = JSON.parse(json);
  if (message.error) throw new Error(JSON.stringify(message.error));
  return message.result;
}

await rpc('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'call-gateway', version: '0.1.0' },
});
await rpc('notifications/initialized', undefined, true);

if (!tool) {
  const { tools } = await rpc('tools/list');
  for (const t of tools) console.log(`${t.name}\n  ${t.description.slice(0, 110)}`);
} else {
  const result = await rpc('tools/call', { name: `dinner-tools___${tool}`, arguments: rawArgs ? JSON.parse(rawArgs) : {} });
  for (const item of result.content ?? []) console.log(item.text ?? item);
  if (result.isError) process.exitCode = 1;
}
