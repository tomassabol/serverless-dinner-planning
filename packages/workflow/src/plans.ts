import {
  BatchWriteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import { StoredPlanSchema, householdKeys, isoWeekDates, type MealRecord, type StoredPlan } from '@dinner/shared';

export class PlanRepo {
  constructor(
    private readonly ddb: DynamoDBDocumentClient,
    private readonly tableName: string,
  ) {}

  async get(householdId: string, week: string): Promise<StoredPlan | null> {
    const { Item } = await this.ddb.send(
      new GetCommand({ TableName: this.tableName, Key: householdKeys.plan(householdId, week) }),
    );
    return Item ? StoredPlanSchema.parse(Item) : null;
  }

  async put(plan: StoredPlan) {
    await this.ddb.send(
      new PutCommand({
        TableName: this.tableName,
        Item: { ...householdKeys.plan(plan.householdId, plan.week), ...StoredPlanSchema.parse(plan) },
      }),
    );
  }

  /**
   * Makes the meal history match the plan for its week: planned dinners are written and dinners
   * from an earlier version of the same week are removed. Existing ratings are kept.
   */
  async syncMealHistory(plan: StoredPlan) {
    const dates = isoWeekDates(plan.week);
    const { pk } = householdKeys.meal(plan.householdId, dates[0]!);
    const { Items = [] } = await this.ddb.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: 'pk = :pk AND sk BETWEEN :from AND :to',
        ExpressionAttributeValues: { ':pk': pk, ':from': `MEAL#${dates[0]}`, ':to': `MEAL#${dates[6]}` },
      }),
    );
    const existing = new Map(Items.map((item) => [item.date as string, item as MealRecord]));

    const puts = plan.dinners.map((d) => {
      const previous = existing.get(d.date);
      const record: MealRecord = {
        date: d.date,
        dish: d.dish,
        mainProtein: d.mainProtein,
        cuisine: d.cuisine,
        tags: [],
        rating: previous && previous.dish === d.dish ? previous.rating : null,
      };
      return { PutRequest: { Item: { ...householdKeys.meal(plan.householdId, d.date), ...record } } };
    });
    const planned = new Set(plan.dinners.map((d) => d.date));
    const deletes = [...existing.keys()]
      .filter((date) => !planned.has(date))
      .map((date) => ({ DeleteRequest: { Key: householdKeys.meal(plan.householdId, date) } }));

    const requests = [...puts, ...deletes];
    for (let i = 0; i < requests.length; i += 25) {
      const response = await this.ddb.send(
        new BatchWriteCommand({ RequestItems: { [this.tableName]: requests.slice(i, i + 25) } }),
      );
      if (response.UnprocessedItems?.[this.tableName]?.length) throw new Error('Meal history write was throttled');
    }
  }
}
