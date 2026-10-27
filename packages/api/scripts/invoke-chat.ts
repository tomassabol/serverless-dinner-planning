/**
 * Invokes the deployed streaming chat Lambda directly with authorizer-style claims (household "home"),
 * printing the SSE stream. Bypasses API Gateway, so no user password is needed.
 * Usage: AWS_PROFILE=tomassabol pnpm --filter @dinner/api invoke-chat "<message>" [conversationId] [userName]
 */
import { InvokeWithResponseStreamCommand, LambdaClient } from '@aws-sdk/client-lambda';

const [message, conversationId, userName = 'Tomas'] = process.argv.slice(2);
if (!message) throw new Error('Usage: invoke-chat "<message>" [conversationId] [userName]');

const event = {
  resource: '/chat',
  httpMethod: 'POST',
  body: JSON.stringify({ message, ...(conversationId ? { conversationId } : {}) }),
  requestContext: { authorizer: { claims: { sub: 'cli', 'custom:householdId': 'home', given_name: userName } } },
};

const client = new LambdaClient({ region: 'eu-west-1' });
const response = await client.send(
  new InvokeWithResponseStreamCommand({ FunctionName: 'dinner-prod-chat-api', Payload: new TextEncoder().encode(JSON.stringify(event)) }),
);

let buffer = '';
for await (const chunk of response.EventStream ?? []) {
  if (chunk.PayloadChunk?.Payload) buffer += new TextDecoder().decode(chunk.PayloadChunk.Payload);
  if (chunk.InvokeComplete?.ErrorCode) console.error('\nError:', chunk.InvokeComplete.ErrorCode, chunk.InvokeComplete.ErrorDetails);
  const frames = buffer.split('\n\n');
  buffer = frames.pop() ?? '';
  for (const frame of frames) {
    // The Lambda prefixes the stream with a JSON metadata prelude (status, headers) before the body.
    const data = frame.split('\n').find((l) => l.startsWith('data:'))?.slice(5).trim();
    if (!data) {
      if (frame.trim()) console.log(`[prelude] ${frame.replace(/\0/g, '').slice(0, 200)}`);
      continue;
    }
    const parsed = JSON.parse(data) as { type: string; delta?: string; name?: string; id?: string };
    if (parsed.type === 'text') process.stdout.write(parsed.delta ?? '');
    else console.log(`\n[${parsed.type}] ${parsed.name ?? parsed.id ?? JSON.stringify(parsed)}`);
  }
}
