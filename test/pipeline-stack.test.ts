import * as cdk from 'aws-cdk-lib/core';
import { Template } from 'aws-cdk-lib/assertions';
import { PipelineStack } from '../lib/pipeline-stack';

describe('PipelineStack', () => {
  let template: Template;

  beforeAll(() => {
    const app = new cdk.App();
    const stack = new PipelineStack(app, 'TestPipelineStack');
    template = Template.fromStack(stack);
  });

  test('creates a CodePipeline resource', () => {
    template.resourceCountIs('AWS::CodePipeline::Pipeline', 1);
  });
});
