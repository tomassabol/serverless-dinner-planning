import { QueryCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export interface Conversation {
  id: string;
  title: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const key = (householdId: string, id: string) => ({ pk: `HOUSEHOLD#${householdId}`, sk: `CONV#${id}` });

/** Conversation list for the chat sidebar. Message contents live in AgentCore Memory. */
export class ConversationRepo {
  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async touch(householdId: string, id: string, userName: string, firstMessage: string, now = new Date()) {
    await this.ddb.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: key(householdId, id),
        UpdateExpression:
          'SET updatedAt = :now, createdAt = if_not_exists(createdAt, :now), title = if_not_exists(title, :title), createdBy = if_not_exists(createdBy, :user), id = :id',
        ExpressionAttributeValues: { ':now': now.toISOString(), ':title': titleFrom(firstMessage), ':user': userName, ':id': id },
      }),
    );
  }

  async list(householdId: string): Promise<Conversation[]> {
    const { Items = [] } = await this.ddb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: { ':pk': `HOUSEHOLD#${householdId}`, ':prefix': 'CONV#' },
      }),
    );
    return (Items as Conversation[])
      .map(({ id, title, createdBy, createdAt, updatedAt }) => ({ id, title, createdBy, createdAt, updatedAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
}

export function titleFrom(message: string): string {
  const oneLine = message.replace(/\s+/g, ' ').trim();
  return oneLine.length <= 60 ? oneLine : `${oneLine.slice(0, 57).trimEnd()}…`;
}
