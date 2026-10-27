import { QueryCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { MealRecordSchema, householdKeys, type MealRecord } from '@dinner/shared';

export class MealHistoryRepo {
  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async list(householdId: string, weeks: number, now = new Date()): Promise<MealRecord[]> {
    const from = new Date(now.getTime() - weeks * 7 * 24 * 3600_000).toISOString().slice(0, 10);
    const { pk } = householdKeys.meal(householdId, from);
    const { Items = [] } = await this.ddb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: { ':pk': pk, ':from': `MEAL#${from}`, ':to': 'MEAL#9999' },
        ScanIndexForward: false,
      }),
    );
    return Items.map((item) => MealRecordSchema.parse(item));
  }
}
