import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { CdkBaseStack } from '../lib/cdk-base-stack';

/**
 * End-to-end validation test suite for the Sleep Audio Pipeline.
 *
 * These tests validate the complete pipeline flow by parsing the synthesized
 * Step Functions state machine definition and verifying correct wiring,
 * error handling, retry configuration, input validation, DynamoDB metadata,
 * and SNS notification payloads.
 */
describe('E2E Pipeline Validation', () => {
  let template: Template;
  let definitionText: string;
  let definitionJson: Record<string, any>;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new CdkBaseStack(app, 'E2ETestStack');
    template = Template.fromStack(stack);

    // Extract the state machine definition from Fn::Join parts
    const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
    const smLogicalId = Object.keys(stateMachines)[0];
    const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
    const joinParts = definitionString['Fn::Join'][1];

    // Filter to string parts and join to get the definition text
    definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

    // Parse into JSON for structured assertions
    // Dynamic refs (Ref, Fn::GetAtt) appear in positions where a string value
    // is expected. The surrounding string parts already include the quotes,
    // so we replace dynamic objects with a simple placeholder string.
    const fullDefinition = joinParts
      .map((p: any) => (typeof p === 'string' ? p : 'DYNAMIC_REF'))
      .join('');
    definitionJson = JSON.parse(fullDefinition);
  });

  describe('Full Happy Path Validation', () => {
    describe('State presence and sequencing', () => {
      test('all expected states are present in the state machine definition', () => {
        const expectedStates = [
          'Write Metadata',
          'Validate Input',
          'Process Audio',
          'Synthesize Speech',
          'Update Status',
          'Notify Success',
          'Mark Failed',
          'Notify Failure',
          'Pipeline Failed',
          'Set Validation Error',
          'Done',
        ];

        for (const state of expectedStates) {
          expect(definitionJson.States).toHaveProperty(state);
        }
      });

      test('happy path flows in correct sequence: Write Metadata -> Validate Input -> Process Audio -> Synthesize Speech -> Update Status -> Notify Success -> Done', () => {
        // Write Metadata -> Validate Input (Next)
        expect(definitionJson.States['Write Metadata'].Next).toBe('Validate Input');

        // Validate Input is a Choice state; when valid, routes to Process Audio
        expect(definitionJson.States['Validate Input'].Type).toBe('Choice');
        const rules = definitionJson.States['Validate Input'].Choices;
        expect(rules.length).toBeGreaterThan(0);
        expect(rules[0].Next).toBe('Process Audio');

        // Process Audio -> Synthesize Speech
        expect(definitionJson.States['Process Audio'].Next).toBe('Synthesize Speech');

        // Synthesize Speech -> Update Status
        expect(definitionJson.States['Synthesize Speech'].Next).toBe('Update Status');

        // Update Status -> Notify Success
        expect(definitionJson.States['Update Status'].Next).toBe('Notify Success');

        // Notify Success -> Done
        expect(definitionJson.States['Notify Success'].Next).toBe('Done');

        // Done is a Succeed state
        expect(definitionJson.States['Done'].Type).toBe('Succeed');
      });

      test('StartAt is Write Metadata', () => {
        expect(definitionJson.StartAt).toBe('Write Metadata');
      });
    });

    describe('Task input/output paths', () => {
      test('Write Metadata has resultPath $.dynamoResult', () => {
        expect(definitionJson.States['Write Metadata'].ResultPath).toBe('$.dynamoResult');
      });

      test('Process Audio has resultPath $.processAudioResult', () => {
        expect(definitionJson.States['Process Audio'].ResultPath).toBe('$.processAudioResult');
      });

      test('Synthesize Speech has resultPath $.pollyResult', () => {
        expect(definitionJson.States['Synthesize Speech'].ResultPath).toBe('$.pollyResult');
      });

      test('Update Status has resultPath $.updateResult', () => {
        expect(definitionJson.States['Update Status'].ResultPath).toBe('$.updateResult');
      });

      test('Notify Success has resultPath $.notifyResult', () => {
        expect(definitionJson.States['Notify Success'].ResultPath).toBe('$.notifyResult');
      });
    });

    describe('DynamoDB metadata fields in Write Metadata', () => {
      test('Write Metadata uses DynamoDB PutItem action', () => {
        const writeState = definitionJson.States['Write Metadata'];
        expect(writeState.Resource).toContain('dynamodb:putItem');
      });

      test('Write Metadata includes audioId field from $.detail.object.key', () => {
        expect(definitionText).toMatch(/Write Metadata/);
        expect(definitionText).toContain('audioId');
        expect(definitionText).toContain('$.detail.object.key');
      });

      test('Write Metadata includes status=PROCESSING', () => {
        expect(definitionText).toContain('PROCESSING');
      });

      test('Write Metadata includes inputBucket field from $.detail.bucket.name', () => {
        expect(definitionText).toContain('inputBucket');
        expect(definitionText).toContain('$.detail.bucket.name');
      });

      test('Write Metadata includes inputKey field from $.detail.object.key', () => {
        expect(definitionText).toContain('inputKey');
      });

      test('Write Metadata includes createdAt field from context entry time', () => {
        expect(definitionText).toContain('createdAt');
        expect(definitionText).toContain('$$.State.EnteredTime');
      });
    });

    describe('DynamoDB metadata fields in Update Status', () => {
      test('Update Status uses DynamoDB UpdateItem action', () => {
        const updateState = definitionJson.States['Update Status'];
        expect(updateState.Resource).toContain('dynamodb:updateItem');
      });

      test('Update Status sets status to COMPLETED', () => {
        const updateState = definitionJson.States['Update Status'];
        const params = updateState.Parameters;
        expect(JSON.stringify(params)).toContain('COMPLETED');
      });

      test('Update Status includes updatedAt from context entry time', () => {
        const updateState = definitionJson.States['Update Status'];
        const params = updateState.Parameters;
        expect(JSON.stringify(params)).toContain('$$.State.EnteredTime');
      });
    });

    describe('SNS notifications on success path', () => {
      test('Notify Success publishes to SNS topic', () => {
        const notifyState = definitionJson.States['Notify Success'];
        expect(notifyState.Resource).toContain('sns:publish');
      });

      test('Notify Success message contains pipelineStatus=COMPLETED', () => {
        const notifyState = definitionJson.States['Notify Success'];
        const messageStr = JSON.stringify(notifyState.Parameters);
        expect(messageStr).toContain('COMPLETED');
      });

      test('Notify Success message contains audioId reference', () => {
        const notifyState = definitionJson.States['Notify Success'];
        const messageStr = JSON.stringify(notifyState.Parameters);
        expect(messageStr).toContain('$.detail.object.key');
      });

      test('Notify Success message contains completedAt reference', () => {
        const notifyState = definitionJson.States['Notify Success'];
        const messageStr = JSON.stringify(notifyState.Parameters);
        expect(messageStr).toContain('completedAt');
        expect(messageStr).toContain('$$.State.EnteredTime');
      });
    });

    describe('SNS notifications on failure path', () => {
      test('Notify Failure publishes to SNS topic', () => {
        const notifyState = definitionJson.States['Notify Failure'];
        expect(notifyState.Resource).toContain('sns:publish');
      });

      test('Notify Failure message contains pipelineStatus=FAILED', () => {
        const notifyState = definitionJson.States['Notify Failure'];
        const messageStr = JSON.stringify(notifyState.Parameters);
        expect(messageStr).toContain('FAILED');
      });

      test('Notify Failure message contains audioId reference', () => {
        const notifyState = definitionJson.States['Notify Failure'];
        const messageStr = JSON.stringify(notifyState.Parameters);
        expect(messageStr).toContain('$.detail.object.key');
      });

      test('Notify Failure message contains failedAt reference', () => {
        const notifyState = definitionJson.States['Notify Failure'];
        const messageStr = JSON.stringify(notifyState.Parameters);
        expect(messageStr).toContain('failedAt');
        expect(messageStr).toContain('$$.State.EnteredTime');
      });

      test('Notify Failure message contains error from $.errorInfo.Error', () => {
        const notifyState = definitionJson.States['Notify Failure'];
        const messageStr = JSON.stringify(notifyState.Parameters);
        expect(messageStr).toContain('$.errorInfo.Error');
      });

      test('Notify Failure message contains cause from $.errorInfo.Cause', () => {
        const notifyState = definitionJson.States['Notify Failure'];
        const messageStr = JSON.stringify(notifyState.Parameters);
        expect(messageStr).toContain('$.errorInfo.Cause');
      });
    });
  });

  describe('Error Handling Validation', () => {
    test('Process Audio errors route to Mark Failed via Catch', () => {
      const processState = definitionJson.States['Process Audio'];
      expect(processState.Catch).toBeDefined();
      expect(processState.Catch.length).toBeGreaterThan(0);
      const catchConfig = processState.Catch.find(
        (c: any) => c.Next === 'Mark Failed'
      );
      expect(catchConfig).toBeDefined();
    });

    test('Process Audio catch injects $.errorInfo', () => {
      const processState = definitionJson.States['Process Audio'];
      const catchConfig = processState.Catch.find(
        (c: any) => c.Next === 'Mark Failed'
      );
      expect(catchConfig.ResultPath).toBe('$.errorInfo');
    });

    test('Synthesize Speech errors route to Mark Failed via Catch', () => {
      const pollyState = definitionJson.States['Synthesize Speech'];
      expect(pollyState.Catch).toBeDefined();
      expect(pollyState.Catch.length).toBeGreaterThan(0);
      const catchConfig = pollyState.Catch.find(
        (c: any) => c.Next === 'Mark Failed'
      );
      expect(catchConfig).toBeDefined();
    });

    test('Synthesize Speech catch injects $.errorInfo', () => {
      const pollyState = definitionJson.States['Synthesize Speech'];
      const catchConfig = pollyState.Catch.find(
        (c: any) => c.Next === 'Mark Failed'
      );
      expect(catchConfig.ResultPath).toBe('$.errorInfo');
    });

    test('Write Metadata errors route to Mark Failed via Catch', () => {
      const writeState = definitionJson.States['Write Metadata'];
      expect(writeState.Catch).toBeDefined();
      expect(writeState.Catch.length).toBeGreaterThan(0);
      const catchConfig = writeState.Catch.find(
        (c: any) => c.Next === 'Mark Failed'
      );
      expect(catchConfig).toBeDefined();
    });

    test('Write Metadata catch injects $.errorInfo', () => {
      const writeState = definitionJson.States['Write Metadata'];
      const catchConfig = writeState.Catch.find(
        (c: any) => c.Next === 'Mark Failed'
      );
      expect(catchConfig.ResultPath).toBe('$.errorInfo');
    });

    test('Update Status errors route to Mark Failed via Catch', () => {
      const updateState = definitionJson.States['Update Status'];
      expect(updateState.Catch).toBeDefined();
      expect(updateState.Catch.length).toBeGreaterThan(0);
      const catchConfig = updateState.Catch.find(
        (c: any) => c.Next === 'Mark Failed'
      );
      expect(catchConfig).toBeDefined();
    });

    test('Update Status catch injects $.errorInfo', () => {
      const updateState = definitionJson.States['Update Status'];
      const catchConfig = updateState.Catch.find(
        (c: any) => c.Next === 'Mark Failed'
      );
      expect(catchConfig.ResultPath).toBe('$.errorInfo');
    });

    test('Mark Failed routes to Notify Failure', () => {
      expect(definitionJson.States['Mark Failed'].Next).toBe('Notify Failure');
    });

    test('Notify Failure routes to Pipeline Failed', () => {
      expect(definitionJson.States['Notify Failure'].Next).toBe('Pipeline Failed');
    });

    test('Pipeline Failed is a Fail state', () => {
      expect(definitionJson.States['Pipeline Failed'].Type).toBe('Fail');
    });

    test('all error paths inject $.errorInfo with Error and Cause fields', () => {
      // All Catch blocks that route to Mark Failed must use resultPath $.errorInfo
      const tasksWithCatch = ['Write Metadata', 'Process Audio', 'Synthesize Speech', 'Update Status'];
      for (const taskName of tasksWithCatch) {
        const state = definitionJson.States[taskName];
        const catchToMarkFailed = state.Catch.find(
          (c: any) => c.Next === 'Mark Failed'
        );
        expect(catchToMarkFailed).toBeDefined();
        expect(catchToMarkFailed.ResultPath).toBe('$.errorInfo');
      }

      // Set Validation Error also injects $.errorInfo
      const validationError = definitionJson.States['Set Validation Error'];
      expect(validationError.ResultPath).toBe('$.errorInfo');
      expect(validationError.Result).toHaveProperty('Error');
      expect(validationError.Result).toHaveProperty('Cause');
    });
  });

  describe('Retry Behavior Validation', () => {
    test('Process Audio retries on States.TaskFailed, Lambda.ServiceException, Lambda.SdkClientException', () => {
      const processState = definitionJson.States['Process Audio'];
      expect(processState.Retry).toBeDefined();
      expect(processState.Retry.length).toBeGreaterThan(0);
      const retryConfig = processState.Retry[0];
      expect(retryConfig.ErrorEquals).toContain('States.TaskFailed');
      expect(retryConfig.ErrorEquals).toContain('Lambda.ServiceException');
      expect(retryConfig.ErrorEquals).toContain('Lambda.SdkClientException');
    });

    test('Process Audio has MaxAttempts 3', () => {
      const retryConfig = definitionJson.States['Process Audio'].Retry[0];
      expect(retryConfig.MaxAttempts).toBe(3);
    });

    test('Process Audio has IntervalSeconds 2', () => {
      const retryConfig = definitionJson.States['Process Audio'].Retry[0];
      expect(retryConfig.IntervalSeconds).toBe(2);
    });

    test('Process Audio has BackoffRate 2', () => {
      const retryConfig = definitionJson.States['Process Audio'].Retry[0];
      expect(retryConfig.BackoffRate).toBe(2);
    });

    test('Synthesize Speech retries on States.TaskFailed', () => {
      const pollyState = definitionJson.States['Synthesize Speech'];
      expect(pollyState.Retry).toBeDefined();
      expect(pollyState.Retry.length).toBeGreaterThan(0);
      const retryConfig = pollyState.Retry[0];
      expect(retryConfig.ErrorEquals).toContain('States.TaskFailed');
    });

    test('Synthesize Speech has MaxAttempts 2', () => {
      const retryConfig = definitionJson.States['Synthesize Speech'].Retry[0];
      expect(retryConfig.MaxAttempts).toBe(2);
    });

    test('Synthesize Speech has IntervalSeconds 3', () => {
      const retryConfig = definitionJson.States['Synthesize Speech'].Retry[0];
      expect(retryConfig.IntervalSeconds).toBe(3);
    });

    test('Synthesize Speech has BackoffRate 2', () => {
      const retryConfig = definitionJson.States['Synthesize Speech'].Retry[0];
      expect(retryConfig.BackoffRate).toBe(2);
    });

    test('Write Metadata retries on States.ALL', () => {
      const writeState = definitionJson.States['Write Metadata'];
      expect(writeState.Retry).toBeDefined();
      expect(writeState.Retry.length).toBeGreaterThan(0);
      const retryConfig = writeState.Retry[0];
      expect(retryConfig.ErrorEquals).toContain('States.ALL');
    });

    test('Write Metadata has MaxAttempts 3', () => {
      const retryConfig = definitionJson.States['Write Metadata'].Retry[0];
      expect(retryConfig.MaxAttempts).toBe(3);
    });

    test('Write Metadata has IntervalSeconds 1', () => {
      const retryConfig = definitionJson.States['Write Metadata'].Retry[0];
      expect(retryConfig.IntervalSeconds).toBe(1);
    });

    test('Write Metadata has BackoffRate 2', () => {
      const retryConfig = definitionJson.States['Write Metadata'].Retry[0];
      expect(retryConfig.BackoffRate).toBe(2);
    });

    test('Update Status retries on States.ALL', () => {
      const updateState = definitionJson.States['Update Status'];
      expect(updateState.Retry).toBeDefined();
      expect(updateState.Retry.length).toBeGreaterThan(0);
      const retryConfig = updateState.Retry[0];
      expect(retryConfig.ErrorEquals).toContain('States.ALL');
    });

    test('Update Status has MaxAttempts 3', () => {
      const retryConfig = definitionJson.States['Update Status'].Retry[0];
      expect(retryConfig.MaxAttempts).toBe(3);
    });

    test('Update Status has IntervalSeconds 1', () => {
      const retryConfig = definitionJson.States['Update Status'].Retry[0];
      expect(retryConfig.IntervalSeconds).toBe(1);
    });

    test('Update Status has BackoffRate 2', () => {
      const retryConfig = definitionJson.States['Update Status'].Retry[0];
      expect(retryConfig.BackoffRate).toBe(2);
    });

    test('all retries use exponential backoff (BackoffRate > 1)', () => {
      const tasksWithRetry = ['Write Metadata', 'Process Audio', 'Synthesize Speech', 'Update Status'];
      for (const taskName of tasksWithRetry) {
        const state = definitionJson.States[taskName];
        expect(state.Retry).toBeDefined();
        for (const retry of state.Retry) {
          expect(retry.BackoffRate).toBeGreaterThan(1);
        }
      }
    });
  });

  describe('Input Validation', () => {
    test('Validate Input is a Choice state', () => {
      expect(definitionJson.States['Validate Input'].Type).toBe('Choice');
    });

    test('Validate Input checks for bucket.name presence (IsPresent)', () => {
      const choiceState = definitionJson.States['Validate Input'];
      const choicesStr = JSON.stringify(choiceState.Choices);
      expect(choicesStr).toContain('$.detail.bucket.name');
      expect(choicesStr).toContain('IsPresent');
    });

    test('Validate Input checks for object.key presence (IsPresent)', () => {
      const choiceState = definitionJson.States['Validate Input'];
      const choicesStr = JSON.stringify(choiceState.Choices);
      expect(choicesStr).toContain('$.detail.object.key');
      expect(choicesStr).toContain('IsPresent');
    });

    test('Validate Input rejects missing bucket.name by routing to failure path via Default', () => {
      const choiceState = definitionJson.States['Validate Input'];
      // Default routes to Set Validation Error (which then goes to Mark Failed)
      expect(choiceState.Default).toBe('Set Validation Error');
    });

    test('Validate Input rejects missing object.key by routing to failure path via Default', () => {
      // Same as above - if the conditions are not met (including object.key presence),
      // the Default path fires
      const choiceState = definitionJson.States['Validate Input'];
      expect(choiceState.Default).toBe('Set Validation Error');
    });

    test('Validate Input rejects unsupported extensions by routing to failure path', () => {
      // The Choice rule requires StringMatches for supported extensions;
      // unsupported files fail the rule and hit Default -> Set Validation Error
      const choiceState = definitionJson.States['Validate Input'];
      const choicesStr = JSON.stringify(choiceState.Choices);
      expect(choicesStr).toContain('StringMatches');
      expect(choiceState.Default).toBe('Set Validation Error');
    });

    test('valid extension .wav is accepted', () => {
      const choiceState = definitionJson.States['Validate Input'];
      const choicesStr = JSON.stringify(choiceState.Choices);
      expect(choicesStr).toContain('*.wav');
    });

    test('valid extension .mp3 is accepted', () => {
      const choiceState = definitionJson.States['Validate Input'];
      const choicesStr = JSON.stringify(choiceState.Choices);
      expect(choicesStr).toContain('*.mp3');
    });

    test('valid extension .flac is accepted', () => {
      const choiceState = definitionJson.States['Validate Input'];
      const choicesStr = JSON.stringify(choiceState.Choices);
      expect(choicesStr).toContain('*.flac');
    });

    test('valid extension .ogg is accepted', () => {
      const choiceState = definitionJson.States['Validate Input'];
      const choicesStr = JSON.stringify(choiceState.Choices);
      expect(choicesStr).toContain('*.ogg');
    });

    test('valid inputs proceed to Process Audio', () => {
      const choiceState = definitionJson.States['Validate Input'];
      const rules = choiceState.Choices;
      expect(rules[0].Next).toBe('Process Audio');
    });

    test('Set Validation Error injects errorInfo and routes to Mark Failed', () => {
      const passState = definitionJson.States['Set Validation Error'];
      expect(passState.Type).toBe('Pass');
      expect(passState.ResultPath).toBe('$.errorInfo');
      expect(passState.Result.Error).toBe('ValidationError');
      expect(passState.Result.Cause).toContain('Input failed validation checks');
      expect(passState.Next).toBe('Mark Failed');
    });
  });

  describe('DynamoDB Metadata Validation', () => {
    test('Write Metadata stores audioId from $.detail.object.key', () => {
      const writeState = definitionJson.States['Write Metadata'];
      const params = writeState.Parameters;
      const item = params.Item;
      expect(item.audioId['S.$']).toBe('$.detail.object.key');
    });

    test('Write Metadata stores status=PROCESSING', () => {
      const writeState = definitionJson.States['Write Metadata'];
      const params = writeState.Parameters;
      const item = params.Item;
      expect(item.status.S).toBe('PROCESSING');
    });

    test('Write Metadata stores inputBucket from $.detail.bucket.name', () => {
      const writeState = definitionJson.States['Write Metadata'];
      const params = writeState.Parameters;
      const item = params.Item;
      expect(item.inputBucket['S.$']).toBe('$.detail.bucket.name');
    });

    test('Write Metadata stores inputKey from $.detail.object.key', () => {
      const writeState = definitionJson.States['Write Metadata'];
      const params = writeState.Parameters;
      const item = params.Item;
      expect(item.inputKey['S.$']).toBe('$.detail.object.key');
    });

    test('Write Metadata stores createdAt from $$.State.EnteredTime', () => {
      const writeState = definitionJson.States['Write Metadata'];
      const params = writeState.Parameters;
      const item = params.Item;
      expect(item.createdAt['S.$']).toBe('$$.State.EnteredTime');
    });

    test('Update Status sets status to COMPLETED', () => {
      const updateState = definitionJson.States['Update Status'];
      const params = updateState.Parameters;
      expect(JSON.stringify(params.ExpressionAttributeValues)).toContain('COMPLETED');
    });

    test('Update Status sets updatedAt from $$.State.EnteredTime', () => {
      const updateState = definitionJson.States['Update Status'];
      const params = updateState.Parameters;
      expect(JSON.stringify(params.ExpressionAttributeValues)).toContain('$$.State.EnteredTime');
    });

    test('Mark Failed sets status to FAILED via DynamoDB UpdateItem', () => {
      const markState = definitionJson.States['Mark Failed'];
      expect(markState.Resource).toContain('dynamodb:updateItem');
      const params = markState.Parameters;
      expect(JSON.stringify(params.ExpressionAttributeValues)).toContain('FAILED');
    });

    test('Mark Failed sets updatedAt from $$.State.EnteredTime', () => {
      const markState = definitionJson.States['Mark Failed'];
      const params = markState.Parameters;
      expect(JSON.stringify(params.ExpressionAttributeValues)).toContain('$$.State.EnteredTime');
    });
  });

  describe('SNS Notification Payload Validation', () => {
    test('success notification contains pipelineStatus=COMPLETED', () => {
      const notifyState = definitionJson.States['Notify Success'];
      const message = notifyState.Parameters.Message;
      expect(message.pipelineStatus).toBe('COMPLETED');
    });

    test('success notification contains audioId referencing $.detail.object.key', () => {
      const notifyState = definitionJson.States['Notify Success'];
      const message = notifyState.Parameters.Message;
      expect(message['audioId.$']).toBe('$.detail.object.key');
    });

    test('success notification contains completedAt referencing $$.State.EnteredTime', () => {
      const notifyState = definitionJson.States['Notify Success'];
      const message = notifyState.Parameters.Message;
      expect(message['completedAt.$']).toBe('$$.State.EnteredTime');
    });

    test('failure notification contains pipelineStatus=FAILED', () => {
      const notifyState = definitionJson.States['Notify Failure'];
      const message = notifyState.Parameters.Message;
      expect(message.pipelineStatus).toBe('FAILED');
    });

    test('failure notification contains audioId referencing $.detail.object.key', () => {
      const notifyState = definitionJson.States['Notify Failure'];
      const message = notifyState.Parameters.Message;
      expect(message['audioId.$']).toBe('$.detail.object.key');
    });

    test('failure notification contains failedAt referencing $$.State.EnteredTime', () => {
      const notifyState = definitionJson.States['Notify Failure'];
      const message = notifyState.Parameters.Message;
      expect(message['failedAt.$']).toBe('$$.State.EnteredTime');
    });

    test('failure notification contains error from $.errorInfo.Error', () => {
      const notifyState = definitionJson.States['Notify Failure'];
      const message = notifyState.Parameters.Message;
      expect(message['error.$']).toBe('$.errorInfo.Error');
    });

    test('failure notification contains cause from $.errorInfo.Cause', () => {
      const notifyState = definitionJson.States['Notify Failure'];
      const message = notifyState.Parameters.Message;
      expect(message['cause.$']).toBe('$.errorInfo.Cause');
    });
  });

  describe('Lambda Processing Cycle Validation', () => {
    // These tests validate the Lambda function's complete processing cycle
    // using the same mock pattern as audio-processor.test.ts
    const mockS3Send = jest.fn();
    const mockPollySend = jest.fn();
    const mockDynamoSend = jest.fn();

    beforeAll(() => {
      jest.resetModules();
    });

    beforeEach(() => {
      jest.clearAllMocks();
      process.env.TABLE_NAME = 'test-metadata-table';
      process.env.INPUT_BUCKET_NAME = 'test-input-bucket';
      process.env.OUTPUT_BUCKET_NAME = 'test-output-bucket';
    });

    afterEach(() => {
      delete process.env.TABLE_NAME;
      delete process.env.INPUT_BUCKET_NAME;
      delete process.env.OUTPUT_BUCKET_NAME;
    });

    function createMockStream(data: Buffer) {
      return {
        async *[Symbol.asyncIterator]() {
          yield data;
        },
      };
    }

    const mockContext = {
      callbackWaitsForEmptyEventLoop: false,
      functionName: 'test-function',
      functionVersion: '1',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
      memoryLimitInMB: '512',
      awsRequestId: 'test-request-id',
      logGroupName: '/aws/lambda/test-function',
      logStreamName: 'test-stream',
      getRemainingTimeInMillis: () => 120000,
      done: () => {},
      fail: () => {},
      succeed: () => {},
    };

    test('text input (.txt) processes through Polly and outputs with correct naming convention', async () => {
      // Use isolated mocking via jest.mock at module level
      jest.mock('@aws-sdk/client-s3', () => ({
        S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
        GetObjectCommand: jest.fn().mockImplementation((params) => ({ ...params })),
        PutObjectCommand: jest.fn().mockImplementation((params) => ({ ...params })),
      }));
      jest.mock('@aws-sdk/client-polly', () => ({
        PollyClient: jest.fn().mockImplementation(() => ({ send: mockPollySend })),
        SynthesizeSpeechCommand: jest.fn().mockImplementation((params) => ({ ...params })),
      }));
      jest.mock('@aws-sdk/client-dynamodb', () => ({
        DynamoDBClient: jest.fn().mockImplementation(() => ({})),
      }));
      jest.mock('@aws-sdk/lib-dynamodb', () => ({
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({ send: mockDynamoSend })),
        },
        UpdateCommand: jest.fn().mockImplementation((params) => ({ ...params })),
      }));

      const { handler } = require('../lambda/audio-processor/index');

      const textContent = 'Gentle waves and soft rain for deep sleep';
      const synthesizedAudio = Buffer.from('mock-polly-audio');

      mockS3Send.mockResolvedValueOnce({
        Body: createMockStream(Buffer.from(textContent)),
      });
      mockPollySend.mockResolvedValueOnce({
        AudioStream: createMockStream(synthesizedAudio),
      });
      mockS3Send.mockResolvedValueOnce({}); // PutObject
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'scripts/sleep-story.txt' },
        },
      };

      const result = await handler(event, mockContext, () => {});

      expect(result.statusCode).toBe(200);
      expect(result.processed).toBe(true);
      expect(result.outputKey).toMatch(/^processed\/scripts\/sleep-story-\d+\.mp3$/);
      expect(mockPollySend).toHaveBeenCalledTimes(1);
    });

    test('audio input (.mp3) processes through passthrough and outputs with correct naming convention', async () => {
      jest.resetModules();

      jest.mock('@aws-sdk/client-s3', () => ({
        S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
        GetObjectCommand: jest.fn().mockImplementation((params) => ({ ...params })),
        PutObjectCommand: jest.fn().mockImplementation((params) => ({ ...params })),
      }));
      jest.mock('@aws-sdk/client-polly', () => ({
        PollyClient: jest.fn().mockImplementation(() => ({ send: mockPollySend })),
        SynthesizeSpeechCommand: jest.fn().mockImplementation((params) => ({ ...params })),
      }));
      jest.mock('@aws-sdk/client-dynamodb', () => ({
        DynamoDBClient: jest.fn().mockImplementation(() => ({})),
      }));
      jest.mock('@aws-sdk/lib-dynamodb', () => ({
        DynamoDBDocumentClient: {
          from: jest.fn().mockImplementation(() => ({ send: mockDynamoSend })),
        },
        UpdateCommand: jest.fn().mockImplementation((params) => ({ ...params })),
      }));

      const { handler } = require('../lambda/audio-processor/index');

      const audioBuffer = Buffer.from('mock-audio-content');

      mockS3Send.mockResolvedValueOnce({
        Body: createMockStream(audioBuffer),
      });
      mockS3Send.mockResolvedValueOnce({}); // PutObject
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'music/calm-waves.mp3' },
        },
      };

      const result = await handler(event, mockContext, () => {});

      expect(result.statusCode).toBe(200);
      expect(result.processed).toBe(true);
      expect(result.outputKey).toMatch(/^processed\/music\/calm-waves-\d+\.mp3$/);
      // Polly should NOT be called for audio inputs
      expect(mockPollySend).not.toHaveBeenCalled();
    });
  });
});
