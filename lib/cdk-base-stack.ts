import * as cdk from 'aws-cdk-lib/core';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Construct } from 'constructs';

export class CdkBaseStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const environment = this.node.tryGetContext('environment') || 'dev';
    cdk.Tags.of(this).add('environment', environment);

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
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // CloudWatch Log Group for state machine
    const logGroup = new logs.LogGroup(this, 'AudioPipelineLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // SNS notification topics with KMS encryption
    const snsKey = kms.Alias.fromAliasName(this, 'SnsKey', 'alias/aws/sns');

    const completedTopic = new sns.Topic(this, 'PipelineCompletedTopic', {
      topicName: 'SleepAudioPipelineCompleted',
      masterKey: snsKey,
    });

    const failedTopic = new sns.Topic(this, 'PipelineFailedTopic', {
      topicName: 'SleepAudioPipelineFailed',
      masterKey: snsKey,
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

    // Retry policy for Write Metadata
    writeMetadataTask.addRetry({
      errors: ['States.ALL'],
      interval: cdk.Duration.seconds(1),
      maxAttempts: 3,
      backoffRate: 2.0,
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

    // SNS Publish task for failure notification
    const notifyFailureTask = new tasks.SnsPublish(this, 'Notify Failure', {
      topic: failedTopic,
      message: sfn.TaskInput.fromObject({
        pipelineStatus: 'FAILED',
        audioId: sfn.JsonPath.stringAt('$.detail.object.key'),
        failedAt: sfn.JsonPath.stringAt('$$.State.EnteredTime'),
        error: sfn.JsonPath.stringAt('$.errorInfo.Error'),
        cause: sfn.JsonPath.stringAt('$.errorInfo.Cause'),
      }),
      resultPath: '$.notifyFailResult',
    });

    markFailedTask.next(notifyFailureTask).next(new sfn.Fail(this, 'Pipeline Failed', {
      cause: 'Polly synthesis failed',
      error: 'SynthesisError',
    }));

    // Add Catch on Write Metadata after markFailedTask is defined
    writeMetadataTask.addCatch(markFailedTask, {
      resultPath: '$.errorInfo',
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

    // Retry policy for Polly task
    pollySynthesizeTask.addRetry({
      errors: ['States.TaskFailed'],
      interval: cdk.Duration.seconds(3),
      maxAttempts: 2,
      backoffRate: 2.0,
    });

    // Add error handling: if Polly fails, mark metadata as FAILED
    pollySynthesizeTask.addCatch(markFailedTask, {
      resultPath: '$.errorInfo',
    });

    // Lambda function for audio processing
    const audioProcessorFunction = new lambda.Function(this, 'SleepAudioProcessor', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda/audio-processor'),
      memorySize: 512,
      timeout: cdk.Duration.seconds(120),
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        TABLE_NAME: metadataTable.tableName,
        INPUT_BUCKET_NAME: inputBucket.bucketName,
        OUTPUT_BUCKET_NAME: outputBucket.bucketName,
      },
    });

    // Grant the Lambda read/write access to the DynamoDB metadata table
    metadataTable.grantReadWriteData(audioProcessorFunction);

    // Grant the Lambda read access to the input bucket
    inputBucket.grantRead(audioProcessorFunction);

    // Grant the Lambda write access to the output bucket
    outputBucket.grantWrite(audioProcessorFunction);

    // Grant the Lambda permission to synthesize speech with Polly
    audioProcessorFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['polly:SynthesizeSpeech'],
      resources: ['*'],
    }));

    // Define the Process Audio task using LambdaInvoke
    const processAudioTask = new tasks.LambdaInvoke(this, 'Process Audio', {
      lambdaFunction: audioProcessorFunction,
      resultPath: '$.processAudioResult',
      retryOnServiceExceptions: false,
    });

    // Retry policy for Process Audio (Lambda)
    processAudioTask.addRetry({
      errors: ['States.TaskFailed', 'Lambda.ServiceException', 'Lambda.SdkClientException'],
      interval: cdk.Duration.seconds(2),
      maxAttempts: 3,
      backoffRate: 2.0,
    });

    // Add error handling: if Lambda fails, mark metadata as FAILED
    processAudioTask.addCatch(markFailedTask, {
      resultPath: '$.errorInfo',
    });

    // Pass state to inject synthetic errorInfo for the validation failure path.
    // When the Choice state rejects input, there is no Catch/resultPath to populate
    // $.errorInfo, so this Pass state provides the fields that Notify Failure expects.
    const setValidationError = new sfn.Pass(this, 'Set Validation Error', {
      result: sfn.Result.fromObject({
        Error: 'ValidationError',
        Cause: 'Input failed validation checks: missing required fields or unsupported file extension',
      }),
      resultPath: '$.errorInfo',
    });

    setValidationError.next(markFailedTask);

    // Define the Validate Input Choice state
    const validateInputChoice = new sfn.Choice(this, 'Validate Input')
      .when(
        sfn.Condition.and(
          sfn.Condition.isPresent('$.detail.bucket.name'),
          sfn.Condition.isPresent('$.detail.object.key'),
          sfn.Condition.or(
            sfn.Condition.stringMatches('$.detail.object.key', '*.wav'),
            sfn.Condition.stringMatches('$.detail.object.key', '*.mp3'),
            sfn.Condition.stringMatches('$.detail.object.key', '*.flac'),
            sfn.Condition.stringMatches('$.detail.object.key', '*.ogg'),
          ),
        ),
        processAudioTask,
      )
      .otherwise(setValidationError);

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

    // Retry policy for Update Status
    updateStatusTask.addRetry({
      errors: ['States.ALL'],
      interval: cdk.Duration.seconds(1),
      maxAttempts: 3,
      backoffRate: 2.0,
    });

    // Catch errors on Update Status
    updateStatusTask.addCatch(markFailedTask, {
      resultPath: '$.errorInfo',
    });

    // SNS Publish task for success notification
    const notifySuccessTask = new tasks.SnsPublish(this, 'Notify Success', {
      topic: completedTopic,
      message: sfn.TaskInput.fromObject({
        pipelineStatus: 'COMPLETED',
        audioId: sfn.JsonPath.stringAt('$.detail.object.key'),
        completedAt: sfn.JsonPath.stringAt('$$.State.EnteredTime'),
      }),
      resultPath: '$.notifyResult',
    });

    const doneState = new sfn.Succeed(this, 'Done');

    // Add Catch on notifySuccessTask so SNS errors don't fail the execution
    // after DynamoDB already shows COMPLETED (best-effort notification)
    notifySuccessTask.addCatch(doneState, {
      resultPath: '$.notifyError',
    });

    // Define the state machine
    // Pipeline flow: WriteMetadata -> Validate Input -> Process Audio -> Polly -> UpdateStatus -> NotifySuccess -> Done
    // Validation failure path: Validate Input -> Mark Failed -> Notify Failure -> Pipeline Failed
    processAudioTask.next(pollySynthesizeTask).next(updateStatusTask).next(notifySuccessTask).next(doneState);

    const stateMachine = new sfn.StateMachine(this, 'SleepAudioPipelineStateMachine', {
      stateMachineName: `SleepAudioPipeline-${environment}`,
      definitionBody: sfn.DefinitionBody.fromChainable(
        writeMetadataTask.next(validateInputChoice)
      ),
      timeout: cdk.Duration.minutes(15),
      tracingEnabled: true,
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

    // CloudWatch Alarms for observability
    const stateMachineFailedAlarm = new cloudwatch.Alarm(this, 'StateMachineFailedAlarm', {
      metric: stateMachine.metricFailed({
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm when state machine executions fail',
    });
    stateMachineFailedAlarm.addAlarmAction(new cw_actions.SnsAction(failedTopic));

    const lambdaErrorsAlarm = new cloudwatch.Alarm(this, 'LambdaErrorsAlarm', {
      metric: audioProcessorFunction.metricErrors({
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 5,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      alarmDescription: 'Alarm when Lambda function errors occur',
    });
    lambdaErrorsAlarm.addAlarmAction(new cw_actions.SnsAction(failedTopic));
  }
}
