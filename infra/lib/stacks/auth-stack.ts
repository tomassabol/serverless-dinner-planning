import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { StageConfig } from '../config';

export interface AuthStackProps extends StackProps {
  config: StageConfig;
}

export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly webClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${config.prefix}-users`,
      // Household members are created by an admin (scripts/create-user.sh).
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      keepOriginal: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        givenName: { required: false, mutable: true },
      },
      customAttributes: {
        // Set by admin only; the web client cannot write it. Tools trust this claim, never model input.
        householdId: new cognito.StringAttribute({ minLen: 1, maxLen: 64, mutable: true }),
      },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      deletionProtection: true,
      removalPolicy: config.removalPolicy,
    });

    const readAttributes = new cognito.ClientAttributes()
      .withStandardAttributes({ email: true, emailVerified: true, givenName: true })
      .withCustomAttributes('householdId');
    // Cognito requires every required attribute (email) to be writable by the client.
    const writeAttributes = new cognito.ClientAttributes().withStandardAttributes({ email: true, givenName: true });

    this.webClient = this.userPool.addClient('WebClient', {
      userPoolClientName: `${config.prefix}-web`,
      generateSecret: false,
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      readAttributes,
      writeAttributes,
      accessTokenValidity: Duration.hours(1),
      idTokenValidity: Duration.hours(1),
      refreshTokenValidity: Duration.days(30),
      enableTokenRevocation: true,
    });

    new ssm.StringParameter(this, 'UserPoolIdParam', {
      parameterName: `/${config.prefix}/auth/user-pool-id`,
      stringValue: this.userPool.userPoolId,
    });
    new ssm.StringParameter(this, 'WebClientIdParam', {
      parameterName: `/${config.prefix}/auth/web-client-id`,
      stringValue: this.webClient.userPoolClientId,
    });

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'WebClientId', { value: this.webClient.userPoolClientId });
  }
}
