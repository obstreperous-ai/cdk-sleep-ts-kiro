import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export class CdkBaseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const inputBucket = new s3.Bucket(this, 'SleepAudioInputBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      eventBridgeEnabled: true,
    });

    new s3.Bucket(this, 'SleepAudioOutputBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    const placeholderFn = new lambda.Function(this, 'PlaceholderProcessingFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline('exports.handler = async () => { return { statusCode: 200 }; }'),
    });

    const rule = new events.Rule(this, 'AudioUploadRule', {
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['Object Created'],
        detail: {
          bucket: {
            name: [inputBucket.bucketName],
          },
        },
      },
    });

    rule.addTarget(new targets.LambdaFunction(placeholderFn));
  }
}
