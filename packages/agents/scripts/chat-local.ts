/**
 * Sends one chat message through the chat agent locally (deployed Gateway, Memory and Bedrock).
 * Usage: AWS_PROFILE=tomassabol pnpm --filter @dinner/agents chat-local <conversationId> "<message>" [userName]
 */
import { execFileSync } from 'node:child_process';
import { createGatewayClient } from '../src/gateway.js';
import { runChat } from '../src/chat/run-chat.js';

const [conversationId, message, userName = 'Tomas'] = process.argv.slice(2);
if (!conversationId || !message) throw new Error('Usage: chat-local <conversationId> "<message>" [userName]');

const region = 'eu-west-1';
const param = (name: string) =>
  execFileSync('aws', ['ssm', 'get-parameter', '--name', name, '--query', 'Parameter.Value', '--output', 'text', '--region', region], {
    encoding: 'utf8',
  }).trim();

const gateway = createGatewayClient({ url: param('/dinner-prod/gateway/url'), region, householdId: 'home', caller: 'chat' });
const config = { region, modelId: 'eu.anthropic.claude-sonnet-4-6', memoryId: param('/dinner-prod/agents/memory-id') };
try {
  for await (const event of runChat({ householdId: 'home', userName, conversationId, message }, config, gateway)) {
    if (event.type === 'text') process.stdout.write(event.delta);
    else if (event.type === 'tool') process.stdout.write(`\n  [tool: ${event.name}]\n`);
    else console.log('\n', event);
  }
} finally {
  await gateway.disconnect();
}
