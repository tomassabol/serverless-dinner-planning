import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { StageConfig } from '../config';

export interface CdnStackProps extends StackProps {
  config: StageConfig;
}

/**
 * Media bucket (generated meal photos) and CloudFront in front of it. The bucket lives here rather
 * than in the Data stack because the OAC bucket policy references the distribution. Images live under `images/`, so when the web app is
 * added (Phase 6) it can take the default behavior and images keep their URLs via an `images/*` behavior.
 */
export class CdnStack extends Stack {
  readonly mediaBucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;
  readonly baseUrl: string;

  constructor(scope: Construct, id: string, props: CdnStackProps) {
    super(scope, id, props);
    const { config } = props;

    const mediaBucket = (this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: config.removalPolicy,
    }));

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `${config.prefix} media and web`,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(mediaBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });
    this.baseUrl = `https://${this.distribution.distributionDomainName}`;

    new ssm.StringParameter(this, 'BaseUrlParam', {
      parameterName: `/${config.prefix}/cdn/base-url`,
      stringValue: this.baseUrl,
    });
    new CfnOutput(this, 'BaseUrl', { value: this.baseUrl });
  }
}
