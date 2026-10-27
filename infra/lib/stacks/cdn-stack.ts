import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { CfnOutput, DockerImage, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import type * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { StageConfig } from '../config';
import { REPO_ROOT } from '../constructs/node-function';

export interface CdnStackProps extends StackProps {
  config: StageConfig;
  api: apigw.RestApi;
  userPool: cognito.IUserPool;
  webClient: cognito.IUserPoolClient;
}

/**
 * One CloudFront distribution for everything the browser loads, all same-origin:
 *   /          the React app (web bucket)
 *   /images/*  generated meal photos (media bucket)
 *   /api/*     the REST API (API Gateway, prefix stripped), streaming chat included
 * The media bucket lives here rather than in the Data stack because the OAC bucket policy
 * references the distribution.
 */
export class CdnStack extends Stack {
  readonly mediaBucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;
  readonly baseUrl: string;

  constructor(scope: Construct, id: string, props: CdnStackProps) {
    super(scope, id, props);
    const { config } = props;

    const bucketProps: s3.BucketProps = {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: config.removalPolicy,
    };
    const mediaBucket = (this.mediaBucket = new s3.Bucket(this, 'MediaBucket', bucketProps));
    const webBucket = new s3.Bucket(this, 'WebBucket', bucketProps);

    const stripApiPrefix = new cloudfront.Function(this, 'StripApiPrefix', {
      functionName: `${config.prefix}-strip-api-prefix`,
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        "function handler(event) { var r = event.request; r.uri = r.uri.replace(/^\\/api/, '') || '/'; return r; }",
      ),
    });

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      responseHeadersPolicyName: `${config.prefix}-security-headers`,
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'self'",
            `connect-src 'self' https://cognito-idp.${this.region}.amazonaws.com`,
            "img-src 'self' data:",
            "style-src 'self' 'unsafe-inline'",
            "script-src 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
          ].join('; '),
          override: true,
        },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(365), includeSubdomains: true, override: true },
      },
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `${config.prefix} media and web`,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(webBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
      },
      additionalBehaviors: {
        'images/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(mediaBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        'api/*': {
          // Read timeout covers gaps between streamed chunks; the chat Lambda sends keep-alives every 15 s.
          origin: new origins.RestApiOrigin(props.api, { readTimeout: Duration.seconds(60) }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          functionAssociations: [{ function: stripApiPrefix, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
        },
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });
    this.baseUrl = `https://${this.distribution.distributionDomainName}`;

    const webDir = path.join(REPO_ROOT, 'apps/web');
    new s3deploy.BucketDeployment(this, 'WebDeployment', {
      destinationBucket: webBucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      cacheControl: [s3deploy.CacheControl.setPublic(), s3deploy.CacheControl.maxAge(Duration.minutes(5))],
      memoryLimit: 512,
      sources: [
        s3deploy.Source.asset(webDir, {
          bundling: {
            image: DockerImage.fromRegistry('alpine'),
            local: {
              tryBundle(outputDir) {
                execFileSync('pnpm', ['exec', 'vite', 'build', '--outDir', outputDir, '--emptyOutDir'], { cwd: webDir, stdio: 'inherit' });
                return true;
              },
            },
          },
        }),
        s3deploy.Source.jsonData('config.json', {
          region: this.region,
          userPoolId: props.userPool.userPoolId,
          userPoolClientId: props.webClient.userPoolClientId,
        }),
      ],
    });

    new ssm.StringParameter(this, 'BaseUrlParam', {
      parameterName: `/${config.prefix}/cdn/base-url`,
      stringValue: this.baseUrl,
    });
    new CfnOutput(this, 'BaseUrl', { value: this.baseUrl });
  }
}
