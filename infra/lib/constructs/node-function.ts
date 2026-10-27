import * as path from 'node:path';
import { Duration } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import type { StageConfig } from '../config';

export const REPO_ROOT = path.resolve(__dirname, '../../..');

export interface NodeFunctionProps extends Omit<nodejs.NodejsFunctionProps, 'entry' | 'runtime' | 'architecture'> {
  config: StageConfig;
  /** Entry file relative to the repository root, e.g. `packages/ingest/src/handler.ts`. */
  entry: string;
  /** Powertools service name, also used in the function name. */
  serviceName: string;
}

/** Lambda defaults for this project: Node 24 on arm64, ESM bundle, X-Ray tracing, Powertools env. */
export class NodeFunction extends nodejs.NodejsFunction {
  constructor(scope: Construct, id: string, props: NodeFunctionProps) {
    const { config, entry, serviceName, environment, bundling, ...rest } = props;

    const logGroup = new logs.LogGroup(scope, `${id}Logs`, {
      logGroupName: `/aws/lambda/${config.prefix}-${serviceName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: config.removalPolicy,
    });

    super(scope, id, {
      functionName: `${config.prefix}-${serviceName}`,
      entry: path.join(REPO_ROOT, entry),
      projectRoot: REPO_ROOT,
      depsLockFilePath: path.join(REPO_ROOT, 'pnpm-lock.yaml'),
      runtime: lambda.Runtime.NODEJS_24_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 512,
      timeout: Duration.seconds(30),
      tracing: lambda.Tracing.ACTIVE,
      logGroup,
      loggingFormat: lambda.LoggingFormat.JSON,
      environment: {
        POWERTOOLS_SERVICE_NAME: serviceName,
        POWERTOOLS_METRICS_NAMESPACE: 'DinnerPlanner',
        NODE_OPTIONS: '--enable-source-maps',
        ...environment,
      },
      bundling: {
        format: nodejs.OutputFormat.ESM,
        target: 'node24',
        minify: true,
        sourceMap: true,
        // Some dependencies still call require(); give the ESM bundle a working one.
        banner: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        mainFields: ['module', 'main'],
        externalModules: [],
        ...bundling,
      },
      ...rest,
    });
  }
}
