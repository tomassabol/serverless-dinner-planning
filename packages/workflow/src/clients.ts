import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';

export const logger = new Logger({ serviceName: 'workflow' });
export const tracer = new Tracer({ serviceName: 'workflow' });

export const ddb = DynamoDBDocumentClient.from(tracer.captureAWSv3Client(new DynamoDBClient({})), {
  marshallOptions: { removeUndefinedValues: true },
});

export function env<K extends string>(...names: K[]): Record<K, string> {
  return Object.fromEntries(
    names.map((name) => {
      const value = process.env[name];
      if (!value) throw new Error(`Missing environment variable ${name}`);
      return [name, value];
    }),
  ) as Record<K, string>;
}
