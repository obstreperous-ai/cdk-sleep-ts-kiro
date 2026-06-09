import * as cdk from 'aws-cdk-lib/core';
import { Template, Match } from 'aws-cdk-lib/assertions';
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

  test('pipeline includes a Deploy stage', () => {
    template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
      Stages: Match.arrayWith([
        Match.objectLike({ Name: 'Deploy' }),
      ]),
    });
  });
});
