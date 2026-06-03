import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
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

    const outputBucket = new s3.Bucket(this, 'SleepAudioOutputBucket', {
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    });

    // CloudWatch Log Group for state machine
    const logGroup = new logs.LogGroup(this, 'AudioPipelineLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Define the Polly task using CallAwsService (SDK integration)
    const pollySynthesizeTask = new tasks.CallAwsService(this, 'Synthesize Speech', {
      service: 'polly',
      action: 'startSpeechSynthesisTask',
      parameters: {
        OutputFormat: 'mp3',
        OutputS3BucketName: outputBucket.bucketName,
        Text: sfn.JsonPath.stringAt('$.text'),
        VoiceId: 'Joanna',
      },
      iamResources: ['*'],
      iamAction: 'polly:StartSpeechSynthesisTask',
      resultPath: '$.pollyResult',
    });

    // Define the state machine
    const stateMachine = new sfn.StateMachine(this, 'SleepAudioPipelineStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(
        pollySynthesizeTask.next(new sfn.Succeed(this, 'Done'))
      ),
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ALL,
        includeExecutionData: true,
      },
    });

    // Grant the state machine permission to write to the output bucket
    outputBucket.grantPut(stateMachine);

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

    rule.addTarget(new targets.SfnStateMachine(stateMachine));
  }
}
