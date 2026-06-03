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

    test('state machine role has S3 output bucket permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: Match.objectLike({
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: Match.arrayWith(['s3:PutObject']),
              Effect: 'Allow',
            }),
          ]),
        }),
      });
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

  test('matches snapshot', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
