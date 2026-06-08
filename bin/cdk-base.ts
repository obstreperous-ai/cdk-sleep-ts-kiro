#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { CdkBaseStack } from '../lib/cdk-base-stack';
import { PipelineStack } from '../lib/pipeline-stack';

const app = new cdk.App();

const environment = app.node.tryGetContext('environment') || 'dev';

const stack = new CdkBaseStack(app, 'CdkBaseStack');
cdk.Tags.of(stack).add('environment', environment);

const enablePipeline = app.node.tryGetContext('enablePipeline');
if (enablePipeline === 'true') {
  new PipelineStack(app, 'PipelineStack');
}
