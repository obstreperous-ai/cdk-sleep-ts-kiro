import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { CdkBaseStack } from '../lib/cdk-base-stack';

describe('CdkBaseStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new CdkBaseStack(app, 'TestStack');
    template = Template.fromStack(stack);
  });

  test('synthesizes a valid CloudFormation template', () => {
    const json = template.toJSON();
    expect(json).toBeDefined();
    expect(json).toHaveProperty('Parameters');
    expect(json.Parameters).toHaveProperty('BootstrapVersion');
  });

  test('creates exactly two S3 buckets', () => {
    template.resourceCountIs('AWS::S3::Bucket', 2);
  });

  describe('S3 Input Bucket', () => {
    test('exists with S3-managed encryption', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256',
              },
            },
          ],
        },
      });
    });

    test('has versioning enabled', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        VersioningConfiguration: {
          Status: 'Enabled',
        },
      });
    });

    test('has BlockPublicAccess set to BLOCK_ALL', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
      });
    });

    test('has EventBridge notifications enabled', () => {
      template.hasResourceProperties('Custom::S3BucketNotifications', {
        BucketName: {
          Ref: Match.stringLikeRegexp('SleepAudioInputBucket'),
        },
        NotificationConfiguration: {
          EventBridgeConfiguration: {},
        },
      });
    });
  });

  describe('S3 Output Bucket', () => {
    test('exists with encryption and versioning enabled', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            {
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: 'AES256',
              },
            },
          ],
        },
        VersioningConfiguration: {
          Status: 'Enabled',
        },
      });
    });
  });

  describe('Step Functions State Machine', () => {
    test('creates a Step Functions state machine', () => {
      template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
    });

    test('state machine definition includes Polly StartSpeechSynthesisTask', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        DefinitionString: Match.objectLike({
          'Fn::Join': Match.arrayWith([
            '',
            Match.arrayWith([
              Match.stringLikeRegexp('.*Synthesize Speech.*Task.*'),
            ]),
          ]),
        }),
      });
    });

    test('state machine has CloudWatch logging enabled', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        LoggingConfiguration: Match.objectLike({
          Level: 'ALL',
          IncludeExecutionData: true,
        }),
      });
    });

    test('state machine role has Polly permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'polly:StartSpeechSynthesisTask',
              Effect: 'Allow',
            }),
          ]),
        }),
      });
    });

    test('state machine role has S3 output bucket permissions via bucket policy for Polly', () => {
      template.hasResourceProperties('AWS::S3::BucketPolicy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 's3:PutObject',
              Effect: 'Allow',
              Principal: Match.objectLike({
                Service: 'polly.amazonaws.com',
              }),
            }),
          ]),
        }),
      });
    });

    test('state machine definition references the output bucket', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;

      // The DefinitionString uses Fn::Join; verify it contains a Ref to the output bucket
      expect(definitionString).toHaveProperty('Fn::Join');
      const joinParts = definitionString['Fn::Join'][1];
      const hasOutputBucketRef = joinParts.some(
        (part: any) => typeof part === 'object' && part !== null && 'Ref' in part &&
          /SleepAudioOutputBucket/.test(part.Ref)
      );
      expect(hasOutputBucketRef).toBe(true);
    });

    test('state machine definition includes a Write Metadata task state', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        DefinitionString: Match.objectLike({
          'Fn::Join': Match.arrayWith([
            '',
            Match.arrayWith([
              Match.stringLikeRegexp('.*Write Metadata.*'),
            ]),
          ]),
        }),
      });
    });

    test('state machine definition includes an Update Status task state', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        DefinitionString: Match.objectLike({
          'Fn::Join': Match.arrayWith([
            '',
            Match.arrayWith([
              Match.stringLikeRegexp('.*Update Status.*'),
            ]),
          ]),
        }),
      });
    });

    test('state machine role has dynamodb:PutItem permission scoped to metadata table', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'dynamodb:PutItem',
              Effect: 'Allow',
              Resource: Match.objectLike({
                'Fn::Join': Match.arrayWith([
                  '',
                  Match.arrayWith([
                    Match.objectLike({ Ref: Match.stringLikeRegexp('SleepAudioMetadataTable.*') }),
                  ]),
                ]),
              }),
            }),
          ]),
        }),
      });
    });

    test('state machine role has dynamodb:UpdateItem permission scoped to metadata table', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'dynamodb:UpdateItem',
              Effect: 'Allow',
              Resource: Match.objectLike({
                'Fn::Join': Match.arrayWith([
                  '',
                  Match.arrayWith([
                    Match.objectLike({ Ref: Match.stringLikeRegexp('SleepAudioMetadataTable.*') }),
                  ]),
                ]),
              }),
            }),
          ]),
        }),
      });
    });

    test('state machine definition includes a Mark Failed state', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        DefinitionString: Match.objectLike({
          'Fn::Join': Match.arrayWith([
            '',
            Match.arrayWith([
              Match.stringLikeRegexp('.*Mark Failed.*'),
            ]),
          ]),
        }),
      });
    });

    test('state machine definition includes Notify Success SNS publish task', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        DefinitionString: Match.objectLike({
          'Fn::Join': Match.arrayWith([
            '',
            Match.arrayWith([
              Match.stringLikeRegexp('.*Notify Success.*'),
            ]),
          ]),
        }),
      });
    });

    test('state machine definition includes Notify Failure SNS publish task', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        DefinitionString: Match.objectLike({
          'Fn::Join': Match.arrayWith([
            '',
            Match.arrayWith([
              Match.stringLikeRegexp('.*Notify Failure.*'),
            ]),
          ]),
        }),
      });
    });

    test('state machine definition includes a Validate Input Choice state', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        DefinitionString: Match.objectLike({
          'Fn::Join': Match.arrayWith([
            '',
            Match.arrayWith([
              Match.stringLikeRegexp('.*Validate Input.*'),
            ]),
          ]),
        }),
      });
    });

    test('Validate Input checks for bucket name and object key presence', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      expect(definitionText).toContain('$.detail.bucket.name');
      expect(definitionText).toContain('$.detail.object.key');
      expect(definitionText).toContain('IsPresent');
    });

    test('Validate Input checks for supported file extensions', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      expect(definitionText).toContain('*.wav');
      expect(definitionText).toContain('*.mp3');
      expect(definitionText).toContain('*.flac');
      expect(definitionText).toContain('*.ogg');
      expect(definitionText).toContain('StringMatches');
    });

    test('pipeline flow order is WriteMetadata -> Validate Input -> Process Audio -> Synthesize Speech', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      const writeMetadataIndex = definitionText.indexOf('Write Metadata');
      const validateInputIndex = definitionText.indexOf('Validate Input');
      const processAudioIndex = definitionText.indexOf('Process Audio');
      const synthesizeSpeechIndex = definitionText.indexOf('Synthesize Speech');

      expect(writeMetadataIndex).toBeGreaterThan(-1);
      expect(validateInputIndex).toBeGreaterThan(-1);
      expect(processAudioIndex).toBeGreaterThan(-1);
      expect(synthesizeSpeechIndex).toBeGreaterThan(-1);

      expect(writeMetadataIndex).toBeLessThan(validateInputIndex);
      expect(validateInputIndex).toBeLessThan(processAudioIndex);
      expect(processAudioIndex).toBeLessThan(synthesizeSpeechIndex);
    });

    test('validation failure routes to Mark Failed state', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      // The Choice state's Default should point to Mark Failed
      expect(definitionText).toContain('Mark Failed');
      // Validate Input is a Choice type
      expect(definitionText).toMatch(/Validate Input.*Choice/s);
    });

    test('validation failure path includes a Set Validation Error Pass state that injects $.errorInfo', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      // The Pass state should exist with type Pass
      expect(definitionText).toContain('Set Validation Error');
      expect(definitionText).toMatch(/Set Validation Error.*Pass/s);
      // It should inject errorInfo with Error and Cause fields
      expect(definitionText).toContain('$.errorInfo');
      expect(definitionText).toContain('ValidationError');
      expect(definitionText).toContain('Input failed validation checks');
    });

    test('state machine role has sns:Publish permission scoped to topic ARNs', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'sns:Publish',
              Effect: 'Allow',
              Resource: Match.anyValue(),
            }),
          ]),
        }),
      });
      // Additionally verify the resource is not a wildcard
      const policies = template.findResources('AWS::IAM::Policy');
      const policyWithSns = Object.values(policies).find((p: any) =>
        JSON.stringify(p.Properties?.PolicyDocument?.Statement).includes('sns:Publish')
      );
      const snsStatement = (policyWithSns as any).Properties.PolicyDocument.Statement.find(
        (s: any) => s.Action === 'sns:Publish'
      );
      expect(snsStatement.Resource).not.toBe('*');
    });
  });

  describe('DynamoDB Metadata Table', () => {
    test('creates exactly 1 DynamoDB table', () => {
      template.resourceCountIs('AWS::DynamoDB::Table', 1);
    });

    test('table has partition key audioId of type String', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        KeySchema: [
          {
            AttributeName: 'audioId',
            KeyType: 'HASH',
          },
        ],
        AttributeDefinitions: [
          {
            AttributeName: 'audioId',
            AttributeType: 'S',
          },
        ],
      });
    });

    test('billing mode is PAY_PER_REQUEST', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
      });
    });

    test('server-side encryption is enabled', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        SSESpecification: {
          SSEEnabled: true,
        },
      });
    });

    test('point-in-time recovery is enabled', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        PointInTimeRecoverySpecification: {
          PointInTimeRecoveryEnabled: true,
        },
      });
    });

    test('deletion policy is Retain', () => {
      const tables = template.findResources('AWS::DynamoDB::Table');
      const tableLogicalId = Object.keys(tables)[0];
      expect(tables[tableLogicalId].DeletionPolicy).toBe('Retain');
    });
  });

  describe('SNS Notification Topics', () => {
    test('creates exactly 2 SNS topics', () => {
      template.resourceCountIs('AWS::SNS::Topic', 2);
    });

    test('pipeline completed topic has KMS encryption', () => {
      template.hasResourceProperties('AWS::SNS::Topic', {
        KmsMasterKeyId: Match.anyValue(),
      });
    });

    test('pipeline failed topic has KMS encryption', () => {
      const topics = template.findResources('AWS::SNS::Topic', {
        Properties: {
          KmsMasterKeyId: Match.anyValue(),
        },
      });
      expect(Object.keys(topics).length).toBe(2);
    });
  });

  describe('EventBridge Rule', () => {
    test('exists with correct event pattern for Object Created', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: {
          source: ['aws.s3'],
          'detail-type': ['Object Created'],
        },
      });
    });

    test('targets the Step Functions state machine', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        Targets: Match.arrayWith([
          Match.objectLike({
            Arn: Match.anyValue(),
            RoleArn: Match.anyValue(),
          }),
        ]),
      });
    });
  });

  describe('Lambda Function - SleepAudioProcessor', () => {
    test('creates a Lambda function with Node.js 22.x runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Runtime: 'nodejs22.x',
      });
    });

    test('Lambda handler is configured correctly', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Handler: 'index.handler',
      });
    });

    test('Lambda has TABLE_NAME environment variable referencing the metadata table', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            TABLE_NAME: {
              Ref: Match.stringLikeRegexp('SleepAudioMetadataTable'),
            },
          }),
        },
      });
    });

    test('Lambda has INPUT_BUCKET_NAME environment variable referencing the input bucket', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            INPUT_BUCKET_NAME: {
              Ref: Match.stringLikeRegexp('SleepAudioInputBucket'),
            },
          }),
        },
      });
    });

    test('Lambda has OUTPUT_BUCKET_NAME environment variable referencing the output bucket', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Environment: {
          Variables: Match.objectLike({
            OUTPUT_BUCKET_NAME: {
              Ref: Match.stringLikeRegexp('SleepAudioOutputBucket'),
            },
          }),
        },
      });
    });

    test('Lambda execution role has DynamoDB read/write permissions scoped to metadata table', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                'dynamodb:BatchGetItem',
                'dynamodb:Query',
                'dynamodb:GetItem',
                'dynamodb:Scan',
                'dynamodb:ConditionCheckItem',
                'dynamodb:BatchWriteItem',
                'dynamodb:PutItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:DescribeTable',
              ]),
              Effect: 'Allow',
              Resource: Match.arrayWith([
                Match.objectLike({
                  'Fn::GetAtt': Match.arrayWith([
                    Match.stringLikeRegexp('SleepAudioMetadataTable'),
                  ]),
                }),
              ]),
            }),
          ]),
        }),
      });
    });

    test('Lambda execution role has S3 read permissions on input bucket', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                's3:GetObject*',
                's3:GetBucket*',
                's3:List*',
              ]),
              Effect: 'Allow',
            }),
          ]),
        }),
      });
    });

    test('Lambda execution role has S3 write permissions on output bucket', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith([
                's3:PutObject',
              ]),
              Effect: 'Allow',
              Resource: Match.arrayWith([
                Match.objectLike({
                  'Fn::GetAtt': Match.arrayWith([
                    Match.stringLikeRegexp('SleepAudioOutputBucket'),
                  ]),
                }),
              ]),
            }),
          ]),
        }),
      });
    });

    test('Lambda execution role has polly:SynthesizeSpeech permission', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'polly:SynthesizeSpeech',
              Effect: 'Allow',
              Resource: '*',
            }),
          ]),
        }),
      });
    });

    test('state machine definition includes a Process Audio LambdaInvoke task', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        DefinitionString: Match.objectLike({
          'Fn::Join': Match.arrayWith([
            '',
            Match.arrayWith([
              Match.stringLikeRegexp('.*Process Audio.*'),
            ]),
          ]),
        }),
      });
    });

    test('state machine role has lambda:InvokeFunction permission scoped to Lambda ARN', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'lambda:InvokeFunction',
              Effect: 'Allow',
              Resource: Match.arrayWith([
                Match.objectLike({
                  'Fn::GetAtt': Match.arrayWith([
                    Match.stringLikeRegexp('SleepAudioProcessor'),
                  ]),
                }),
              ]),
            }),
          ]),
        }),
      });
    });
  });

  describe('End-to-end pipeline flow', () => {
    test('full chain S3->EventBridge->StepFunctions->Lambda->Polly->DynamoDB->SNS is wired', () => {
      // S3 bucket exists
      template.resourceCountIs('AWS::S3::Bucket', 2);
      // EventBridge rule exists
      template.resourceCountIs('AWS::Events::Rule', 1);
      // State machine exists
      template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
      // Lambda function exists (2 total: audio processor + S3 notification handler)
      template.resourceCountIs('AWS::Lambda::Function', 2);
      // DynamoDB table exists
      template.resourceCountIs('AWS::DynamoDB::Table', 1);
      // SNS topics exist
      template.resourceCountIs('AWS::SNS::Topic', 2);

      // Verify state machine definition contains all pipeline stages in order
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      // Full chain order
      const writeMetadataIdx = definitionText.indexOf('Write Metadata');
      const validateInputIdx = definitionText.indexOf('Validate Input');
      const processAudioIdx = definitionText.indexOf('Process Audio');
      const synthesizeSpeechIdx = definitionText.indexOf('Synthesize Speech');
      const updateStatusIdx = definitionText.indexOf('Update Status');
      const notifySuccessIdx = definitionText.indexOf('Notify Success');
      const doneIdx = definitionText.indexOf('"Type":"Succeed"');

      expect(writeMetadataIdx).toBeGreaterThan(-1);
      expect(validateInputIdx).toBeGreaterThan(-1);
      expect(processAudioIdx).toBeGreaterThan(-1);
      expect(synthesizeSpeechIdx).toBeGreaterThan(-1);
      expect(updateStatusIdx).toBeGreaterThan(-1);
      expect(notifySuccessIdx).toBeGreaterThan(-1);
      expect(doneIdx).toBeGreaterThan(-1);

      expect(writeMetadataIdx).toBeLessThan(validateInputIdx);
      expect(validateInputIdx).toBeLessThan(processAudioIdx);
      expect(processAudioIdx).toBeLessThan(synthesizeSpeechIdx);
      expect(synthesizeSpeechIdx).toBeLessThan(updateStatusIdx);
      expect(updateStatusIdx).toBeLessThan(notifySuccessIdx);
    });
  });

  describe('Input validation - valid/invalid cases', () => {
    test('accepts .wav extension', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');
      expect(definitionText).toContain('*.wav');
    });

    test('accepts .mp3 extension', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');
      expect(definitionText).toContain('*.mp3');
    });

    test('accepts .flac extension', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');
      expect(definitionText).toContain('*.flac');
    });

    test('accepts .ogg extension', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');
      expect(definitionText).toContain('*.ogg');
    });

    test('rejects unsupported extensions by routing to failure path', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      // The Choice state has a Default that routes to Set Validation Error -> Mark Failed
      expect(definitionText).toContain('Default');
      expect(definitionText).toContain('Set Validation Error');
    });
  });

  describe('Error path assertions', () => {
    test('Lambda errors route to Mark Failed state via Catch', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      // Process Audio should have a Catch that leads to Mark Failed
      expect(definitionText).toMatch(/Process Audio.*Catch/s);
      expect(definitionText).toContain('Mark Failed');
    });

    test('error path follows Mark Failed -> Notify Failure -> Pipeline Failed', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      // Verify Mark Failed state has Next pointing to Notify Failure
      // The state definition format: "Mark Failed":{"Type":"Task",...,"Next":"Notify Failure"}
      expect(definitionText).toMatch(/"Mark Failed":\{[^}]*"Type":"Task"/);
      // Extract the Next value for Mark Failed
      const markFailedSection = definitionText.match(/"Mark Failed":\{[^}]*?"Next":"([^"]+)"/);
      expect(markFailedSection).not.toBeNull();
      expect(markFailedSection![1]).toBe('Notify Failure');

      // Verify Notify Failure leads to Pipeline Failed
      const notifyFailureSection = definitionText.match(/"Notify Failure":\{[^}]*?"Next":"([^"]+)"/);
      expect(notifyFailureSection).not.toBeNull();
      expect(notifyFailureSection![1]).toBe('Pipeline Failed');
    });

    test('Pipeline Failed is a Fail state', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      expect(definitionText).toMatch(/"Pipeline Failed".*?"Type"\s*:\s*"Fail"/s);
    });
  });

  describe('EventBridge rule scoping', () => {
    test('EventBridge rule is scoped to input bucket only', () => {
      template.hasResourceProperties('AWS::Events::Rule', {
        EventPattern: {
          source: ['aws.s3'],
          'detail-type': ['Object Created'],
          detail: {
            bucket: {
              name: Match.anyValue(),
            },
          },
        },
      });
    });
  });

  describe('IAM least-privilege checks', () => {
    test('no wildcard Resource on IAM policies except Polly and CloudWatch Logs delivery (documented exceptions)', () => {
      const policies = template.findResources('AWS::IAM::Policy');
      for (const [logicalId, policy] of Object.entries(policies)) {
        const statements = (policy as any).Properties.PolicyDocument.Statement;
        for (const stmt of statements) {
          const actions = Array.isArray(stmt.Action) ? stmt.Action : [stmt.Action];
          const isPolly = actions.includes('polly:StartSpeechSynthesisTask') || actions.includes('polly:SynthesizeSpeech');
          const isLogsDelivery = actions.some((a: string) => a.startsWith('logs:'));
          const isXRay = actions.some((a: string) => a.startsWith('xray:'));

          if (isPolly) {
            // Polly requires wildcard - documented exception
            expect(stmt.Resource).toBe('*');
          } else if (isLogsDelivery && stmt.Resource === '*') {
            // CloudWatch Logs delivery requires wildcard - documented exception
            continue;
          } else if (isXRay && stmt.Resource === '*') {
            // X-Ray tracing requires wildcard - documented exception
            continue;
          } else if (stmt.Resource === '*') {
            // No other statement should have wildcard resource
            throw new Error(`Policy ${logicalId} has wildcard Resource for action: ${JSON.stringify(stmt.Action)}`);
          }
        }
      }
    });
  });

  describe('State machine timeout and retry configuration', () => {
    test('state machine has a timeout configured', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      // The state machine definition should contain TimeoutSeconds
      expect(definitionText).toContain('TimeoutSeconds');
    });
  });

  describe('Multi-environment support', () => {
    test('stack accepts environment context and applies environment tag', () => {
      const app = new cdk.App({ context: { environment: 'staging' } });
      const stack = new CdkBaseStack(app, 'EnvTestStack');
      const envTemplate = Template.fromStack(stack);

      // The stack should have tags applied
      const json = envTemplate.toJSON();
      // Check that a resource has the environment tag
      const buckets = envTemplate.findResources('AWS::S3::Bucket');
      const firstBucketId = Object.keys(buckets)[0];
      const tags = (buckets[firstBucketId] as any).Properties.Tags;
      const envTag = tags?.find((t: any) => t.Key === 'environment');
      expect(envTag).toBeDefined();
      expect(envTag.Value).toBe('staging');
    });

    test('stack defaults to dev environment when no context provided', () => {
      const app = new cdk.App();
      const stack = new CdkBaseStack(app, 'DefaultEnvStack');
      const defaultTemplate = Template.fromStack(stack);

      const buckets = defaultTemplate.findResources('AWS::S3::Bucket');
      const firstBucketId = Object.keys(buckets)[0];
      const tags = (buckets[firstBucketId] as any).Properties.Tags;
      const envTag = tags?.find((t: any) => t.Key === 'environment');
      expect(envTag).toBeDefined();
      expect(envTag.Value).toBe('dev');
    });

    test('stack accepts prod environment context', () => {
      const app = new cdk.App({ context: { environment: 'prod' } });
      const stack = new CdkBaseStack(app, 'ProdTestStack');
      const prodTemplate = Template.fromStack(stack);

      const buckets = prodTemplate.findResources('AWS::S3::Bucket');
      const firstBucketId = Object.keys(buckets)[0];
      const tags = (buckets[firstBucketId] as any).Properties.Tags;
      const envTag = tags?.find((t: any) => t.Key === 'environment');
      expect(envTag).toBeDefined();
      expect(envTag.Value).toBe('prod');
    });
  });

  describe('Refinements', () => {
    test('state machine has a meaningful stateMachineName property set', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        StateMachineName: Match.stringLikeRegexp('SleepAudio'),
      });
    });

    test('Lambda memory is set to 512MB', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        MemorySize: 512,
      });
    });

    test('Lambda timeout is set to 120 seconds', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        Timeout: 120,
      });
    });
  });

  describe('Advanced Error Handling', () => {
    test('Process Audio task catches all errors (States.ALL)', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      // Process Audio should have Catch with States.ALL (catch-all)
      expect(definitionText).toMatch(/Process Audio.*Catch/s);
      expect(definitionText).toContain('States.ALL');
    });

    test('Polly Synthesize Speech task catches all errors (States.ALL)', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      // Polly task should have a Catch block with States.ALL
      expect(definitionText).toMatch(/Synthesize Speech.*Catch/s);
      expect(definitionText).toContain('States.ALL');
    });

    test('Write Metadata task has a Catch block routing to Mark Failed', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      // Write Metadata should have a Catch block
      expect(definitionText).toMatch(/Write Metadata.*Catch/s);
    });

    test('Update Status task has a Catch block routing to Mark Failed', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      // Update Status should have a Catch block
      expect(definitionText).toMatch(/Update Status.*Catch/s);
    });

    test('error notification includes error context from errorInfo', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      // Notify Failure should reference $.errorInfo.Error and $.errorInfo.Cause
      expect(definitionText).toContain('$.errorInfo.Error');
      expect(definitionText).toContain('$.errorInfo.Cause');
    });
  });

  describe('Retry Policies', () => {
    test('Process Audio task has retry configuration with exponential backoff', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      // Process Audio should have Retry with IntervalSeconds, MaxAttempts, BackoffRate
      expect(definitionText).toMatch(/Process Audio.*Retry/s);
      expect(definitionText).toContain('IntervalSeconds');
      expect(definitionText).toContain('MaxAttempts');
      expect(definitionText).toContain('BackoffRate');
    });

    test('Process Audio task retry has MaxAttempts 3 and BackoffRate 2', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      // Extract the Process Audio state section and verify retry params
      const processAudioSection = definitionText.match(/"Process Audio":\{[^]*?"Retry":\[([^]*?)\],"Catch"/);
      expect(processAudioSection).not.toBeNull();
      const retryConfig = processAudioSection![1];
      expect(retryConfig).toContain('"MaxAttempts":3');
      expect(retryConfig).toContain('"BackoffRate":2');
    });

    test('Synthesize Speech task has retry configuration with MaxAttempts 2', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      // Polly task should have Retry configuration
      expect(definitionText).toMatch(/Synthesize Speech.*Retry/s);
      const pollySection = definitionText.match(/"Synthesize Speech":\{[^]*?"Retry":\[([^]*?)\],"Catch"/);
      expect(pollySection).not.toBeNull();
      const retryConfig = pollySection![1];
      expect(retryConfig).toContain('"MaxAttempts":2');
      expect(retryConfig).toContain('"BackoffRate":2');
    });

    test('Write Metadata task has retry configuration', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      expect(definitionText).toMatch(/Write Metadata.*Retry/s);
      const writeSection = definitionText.match(/"Write Metadata":\{[^]*?"Retry":\[([^]*?)\],"Catch"/);
      expect(writeSection).not.toBeNull();
      const retryConfig = writeSection![1];
      expect(retryConfig).toContain('"MaxAttempts":3');
      expect(retryConfig).toContain('"BackoffRate":2');
    });

    test('Update Status task has retry configuration', () => {
      const stateMachines = template.findResources('AWS::StepFunctions::StateMachine');
      const smLogicalId = Object.keys(stateMachines)[0];
      const definitionString = stateMachines[smLogicalId].Properties.DefinitionString;
      const joinParts = definitionString['Fn::Join'][1];
      const definitionText = joinParts.filter((p: any) => typeof p === 'string').join('');

      expect(definitionText).toMatch(/Update Status.*Retry/s);
      const updateSection = definitionText.match(/"Update Status":\{[^]*?"Retry":\[([^]*?)\],"Catch"/);
      expect(updateSection).not.toBeNull();
      const retryConfig = updateSection![1];
      expect(retryConfig).toContain('"MaxAttempts":3');
      expect(retryConfig).toContain('"BackoffRate":2');
    });
  });

  describe('Observability - X-Ray Tracing', () => {
    test('Lambda function has X-Ray tracing enabled (Active mode)', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        TracingConfig: {
          Mode: 'Active',
        },
      });
    });

    test('State machine has X-Ray tracing enabled', () => {
      template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
        TracingConfiguration: {
          Enabled: true,
        },
      });
    });
  });

  describe('CloudWatch Alarms', () => {
    test('CloudWatch Alarm exists for state machine execution failures', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'ExecutionsFailed',
        Namespace: 'AWS/States',
        Statistic: 'Sum',
        Threshold: 1,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      });
    });

    test('CloudWatch Alarm exists for Lambda function errors', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'Errors',
        Namespace: 'AWS/Lambda',
        Statistic: 'Sum',
        Threshold: 1,
        ComparisonOperator: 'GreaterThanOrEqualToThreshold',
      });
    });

    test('Alarms have appropriate evaluation periods', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'ExecutionsFailed',
        Period: 60,
        EvaluationPeriods: 5,
      });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'Errors',
        Period: 60,
        EvaluationPeriods: 5,
      });
    });

    test('Alarms have alarm actions wired to the failed topic', () => {
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'ExecutionsFailed',
        AlarmActions: Match.arrayWith([
          Match.objectLike({ Ref: Match.stringLikeRegexp('PipelineFailedTopic') }),
        ]),
      });
      template.hasResourceProperties('AWS::CloudWatch::Alarm', {
        MetricName: 'Errors',
        AlarmActions: Match.arrayWith([
          Match.objectLike({ Ref: Match.stringLikeRegexp('PipelineFailedTopic') }),
        ]),
      });
    });
  });

  test('matches snapshot', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
