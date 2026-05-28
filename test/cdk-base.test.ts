import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
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

  test('has no application resources', () => {
    template.resourceCountIs('AWS::SQS::Queue', 0);
    template.resourceCountIs('AWS::Lambda::Function', 0);
  });

  test('matches snapshot', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
