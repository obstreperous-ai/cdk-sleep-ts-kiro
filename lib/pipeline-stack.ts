import * as cdk from 'aws-cdk-lib/core';
import { CodePipeline, CodePipelineSource, ShellStep } from 'aws-cdk-lib/pipelines';
import { Construct } from 'constructs';
import { CdkBaseStack } from './cdk-base-stack';

class SleepAudioStage extends cdk.Stage {
  constructor(scope: Construct, id: string, props?: cdk.StageProps) {
    super(scope, id, props);
    new CdkBaseStack(this, 'CdkBaseStack');
  }
}

export class PipelineStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const pipeline = new CodePipeline(this, 'SleepAudioPipeline', {
      pipelineName: 'SleepAudioPipeline',
      synth: new ShellStep('Synth', {
        input: CodePipelineSource.connection('owner/cdk-sleep-ts-kiro', 'main', {
          connectionArn: 'arn:aws:codeconnections:us-east-1:123456789012:connection/placeholder',
        }),
        commands: ['npm ci', 'npx cdk synth'],
      }),
    });

    pipeline.addStage(new SleepAudioStage(this, 'Deploy'));
  }
}
