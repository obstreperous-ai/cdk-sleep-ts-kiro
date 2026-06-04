import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
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

    const metadataTable = new dynamodb.Table(this, 'SleepAudioMetadataTable', {
      partitionKey: { name: 'audioId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecovery: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // CloudWatch Log Group for state machine
    const logGroup = new logs.LogGroup(this, 'AudioPipelineLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Define the DynamoDB Write Metadata task
    const writeMetadataTask = new tasks.DynamoPutItem(this, 'Write Metadata', {
      table: metadataTable,
      item: {
        audioId: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.detail.object.key')),
        status: tasks.DynamoAttributeValue.fromString('PROCESSING'),
        inputBucket: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.detail.bucket.name')),
        inputKey: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.detail.object.key')),
        createdAt: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.State.EnteredTime')),
      },
      resultPath: '$.dynamoResult',
    });

    // Define the Mark Failed task for error handling
    const markFailedTask = new tasks.DynamoUpdateItem(this, 'Mark Failed', {
      table: metadataTable,
      key: {
        audioId: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.detail.object.key')),
      },
      updateExpression: 'SET #s = :status, #u = :updatedAt',
      expressionAttributeNames: {
        '#s': 'status',
        '#u': 'updatedAt',
      },
      expressionAttributeValues: {
        ':status': tasks.DynamoAttributeValue.fromString('FAILED'),
        ':updatedAt': tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.State.EnteredTime')),
      },
      resultPath: '$.failResult',
    });

    markFailedTask.next(new sfn.Fail(this, 'Pipeline Failed', {
      cause: 'Polly synthesis failed',
      error: 'SynthesisError',
    }));

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

    // Add error handling: if Polly fails, mark metadata as FAILED
    pollySynthesizeTask.addCatch(markFailedTask, {
      resultPath: '$.errorInfo',
    });

    // Define the DynamoDB Update Status task
    const updateStatusTask = new tasks.DynamoUpdateItem(this, 'Update Status', {
      table: metadataTable,
      key: {
        audioId: tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$.detail.object.key')),
      },
      updateExpression: 'SET #s = :status, #u = :updatedAt',
      expressionAttributeNames: {
        '#s': 'status',
        '#u': 'updatedAt',
      },
      expressionAttributeValues: {
        ':status': tasks.DynamoAttributeValue.fromString('COMPLETED'),
        ':updatedAt': tasks.DynamoAttributeValue.fromString(sfn.JsonPath.stringAt('$$.State.EnteredTime')),
      },
      resultPath: '$.updateResult',
    });

    // Define the state machine
    const stateMachine = new sfn.StateMachine(this, 'SleepAudioPipelineStateMachine', {
      definitionBody: sfn.DefinitionBody.fromChainable(
        writeMetadataTask.next(pollySynthesizeTask).next(updateStatusTask).next(new sfn.Succeed(this, 'Done'))
      ),
      logs: {
        destination: logGroup,
        level: sfn.LogLevel.ALL,
        includeExecutionData: true,
      },
    });

    // Grant scoped DynamoDB permissions (PutItem, UpdateItem only) to the state machine role.
    metadataTable.grant(stateMachine, 'dynamodb:PutItem', 'dynamodb:UpdateItem');

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
