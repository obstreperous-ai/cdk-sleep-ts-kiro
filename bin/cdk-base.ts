#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { CdkBaseStack } from '../lib/cdk-base-stack';
import { PipelineStack } from '../lib/pipeline-stack';

const app = new cdk.App();

new CdkBaseStack(app, 'CdkBaseStack');

const enablePipeline = app.node.tryGetContext('enablePipeline');
if (enablePipeline === 'true') {
  new PipelineStack(app, 'PipelineStack');
}
