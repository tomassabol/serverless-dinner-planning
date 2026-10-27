/**
 * POST /chat — streams the chat agent's answer as Server-Sent Events through API Gateway
 * (REST API, response streaming, Cognito authorizer).
 * Body: { message, conversationId? }. The first event is `{ type: "conversation", id }`.
 */
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { BedrockAgentCoreClient, InvokeAgentRuntimeCommand } from '@aws-sdk/client-bedrock-agentcore';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import { z } from 'zod';
import { ConversationRepo } from './conversations.js';
import { callerFrom } from './identity.js';

const env = z.object({ CHAT_RUNTIME_ARN: z.string(), TABLE_NAME: z.string() }).parse(process.env);
const logger = new Logger({ serviceName: 'chat-api' });
const agentcore = new BedrockAgentCoreClient({ requestHandler: { requestTimeout: 10 * 60_000 } });
const conversations = new ConversationRepo(DynamoDBDocumentClient.from(new DynamoDBClient({})), env.TABLE_NAME);

const BodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  // AgentCore session ids are 33+ characters; ours are "conv-" + UUID.
  conversationId: z.string().regex(/^conv-[0-9a-f-]{36}$/).optional(),
});

const sse = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;

export const handler = awslambda.streamifyResponse(async (event: APIGatewayProxyEvent, responseStream) => {
  const write = (status: number, chunks: string[]) => {
    const stream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: status,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
    });
    for (const chunk of chunks) stream.write(chunk);
    stream.end();
  };

  let caller;
  let body;
  try {
    caller = callerFrom(event);
    body = BodySchema.parse(JSON.parse(event.body ?? '{}'));
  } catch (error) {
    logger.warn('Rejected chat request', { error });
    write(400, [sse({ type: 'error', message: 'Invalid request.' })]);
    return;
  }

  const conversationId = body.conversationId ?? `conv-${randomUUID()}`;
  await conversations.touch(caller.householdId, conversationId, caller.userName, body.message);

  const response = await agentcore.send(
    new InvokeAgentRuntimeCommand({
      agentRuntimeArn: env.CHAT_RUNTIME_ARN,
      runtimeSessionId: conversationId,
      contentType: 'application/json',
      accept: 'text/event-stream',
      payload: new TextEncoder().encode(
        JSON.stringify({ action: 'chat', householdId: caller.householdId, userName: caller.userName, conversationId, message: body.message }),
      ),
    }),
  );

  const stream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 200,
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'x-conversation-id': conversationId },
  });
  stream.write(sse({ type: 'conversation', id: conversationId }));
  // The runtime already emits SSE frames; pass them through unchanged.
  await pipeline(response.response as unknown as Readable, stream);
  logger.info('Chat turn streamed', { householdId: caller.householdId, conversationId });
});
