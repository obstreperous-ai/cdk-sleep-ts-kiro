import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
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
        OutputS3KeyPrefix: sfn.JsonPath.stringAt('$.detail.object.key'),
        Text: 'Placeholder text for sleep audio synthesis',
        VoiceId: 'Joanna',
      },
      // Polly APIs do not support resource-level IAM restrictions, so a wildcard is required.
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

    // Allow the Polly service to write synthesized audio to the output bucket.
    // Polly writes to S3 using its own service credentials, not the caller's role.
    outputBucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:PutObject'],
      resources: [outputBucket.arnForObjects('*')],
      principals: [new iam.ServicePrincipal('polly.amazonaws.com')],
    }));

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
