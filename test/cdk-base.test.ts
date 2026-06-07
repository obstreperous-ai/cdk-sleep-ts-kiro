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

  test('matches snapshot', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
