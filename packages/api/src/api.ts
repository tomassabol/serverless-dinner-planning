/**
 * Buffered REST endpoints for the web app:
 *   GET /conversations            conversation list (newest first)
 *   GET /conversations/{id}       messages of one conversation, from AgentCore Memory
 *   GET /plans/{week}             stored plan for "current", "next" or an ISO week, with each dinner's rating
 *   POST /meals/{date}/rating     { rating: "up" | "down" } for a planned dinner
 */
import { BedrockAgentCoreClient, paginateListEvents } from '@aws-sdk/client-bedrock-agentcore';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { householdKeys, isoWeekDates, resolveWeekKey } from '@dinner/shared';
import { PlanRepo } from '@dinner/workflow/plans';
import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { z } from 'zod';
import { ConversationRepo } from './conversations.js';
import { callerFrom } from './identity.js';

const env = z.object({ TABLE_NAME: z.string(), MEMORY_ID: z.string() }).parse(process.env);
const logger = new Logger({ serviceName: 'api' });
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const conversations = new ConversationRepo(ddb, env.TABLE_NAME);
const plans = new PlanRepo(ddb, env.TABLE_NAME);
const agentcore = new BedrockAgentCoreClient({});

const json = (statusCode: number, body: unknown): APIGatewayProxyResult => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    const { householdId } = callerFrom(event);
    const id = event.pathParameters?.id;
    const week = event.pathParameters?.week;

    if (event.resource === '/conversations') return json(200, { conversations: await conversations.list(householdId) });

    if (event.resource === '/conversations/{id}' && id) {
      const known = (await conversations.list(householdId)).some((c) => c.id === id);
      if (!known) return json(404, { message: 'Conversation not found' });
      return json(200, { id, messages: await loadMessages(householdId, id) });
    }

    if (event.resource === '/plans/{week}' && week) {
      const key = resolveWeekKey(week, new Date());
      const plan = await plans.get(householdId, key);
      if (!plan) return json(404, { week: key, message: 'No plan for this week yet' });
      const { usage: _usage, executionId: _executionId, ...visible } = plan;
      const ratings = await weekRatings(householdId, key);
      return json(200, { ...visible, dinners: visible.dinners.map((d) => ({ ...d, rating: ratings.get(d.date) ?? null })) });
    }

    const date = event.pathParameters?.date;
    if (event.resource === '/meals/{date}/rating' && date && event.httpMethod === 'POST') {
      const { rating } = RatingSchema.parse(JSON.parse(event.body ?? '{}'));
      z.iso.date().parse(date);
      try {
        await ddb.send(
          new UpdateCommand({
            TableName: env.TABLE_NAME,
            Key: householdKeys.meal(householdId, date),
            UpdateExpression: 'SET rating = :rating',
            ConditionExpression: 'attribute_exists(pk)',
            ExpressionAttributeValues: { ':rating': rating },
          }),
        );
      } catch (error) {
        if ((error as Error).name === 'ConditionalCheckFailedException') return json(404, { message: 'No dinner on that date' });
        throw error;
      }
      return json(200, { date, rating });
    }
    return json(404, { message: 'Not found' });
  } catch (error) {
    logger.error('Request failed', { error, resource: event.resource });
    return json(error instanceof z.ZodError ? 400 : 500, { message: 'Request failed' });
  }
};

const RatingSchema = z.object({ rating: z.enum(['up', 'down']) });

async function weekRatings(householdId: string, week: string): Promise<Map<string, string>> {
  const dates = isoWeekDates(week);
  const { Items = [] } = await ddb.send(
    new QueryCommand({
      TableName: env.TABLE_NAME,
      KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
      ExpressionAttributeValues: { ':pk': `HOUSEHOLD#${householdId}`, ':from': `MEAL#${dates[0]}`, ':to': `MEAL#${dates[6]}` },
    }),
  );
  return new Map(Items.filter((i) => i.rating).map((i) => [i.date as string, i.rating as string]));
}

async function loadMessages(householdId: string, sessionId: string) {
  const messages: { role: 'user' | 'assistant'; text: string; timestamp: string }[] = [];
  for await (const page of paginateListEvents(
    { client: agentcore },
    { memoryId: env.MEMORY_ID, actorId: householdId, sessionId, includePayloads: true },
  )) {
    for (const event of page.events ?? []) {
      for (const item of event.payload ?? []) {
        const c = item.conversational;
        if (!c?.content?.text || (c.role !== 'USER' && c.role !== 'ASSISTANT')) continue;
        messages.push({ role: c.role === 'USER' ? 'user' : 'assistant', text: c.content.text, timestamp: event.eventTimestamp!.toISOString() });
      }
    }
  }
  return messages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
