# CDK Sleep Audio Pipeline

This is an AWS CDK TypeScript project for building an event-driven sleep audio processing pipeline. The planned target architecture is for raw sleep audio recordings to be uploaded to S3, which would trigger an EventBridge rule that invokes a Lambda function for audio analysis and transcoding. Processed results would then be stored in a separate S3 bucket and DynamoDB table, with SNS notifications sent upon completion once those resources are added.

## TDD Rules

This project follows strict Test-Driven Development:

1. **Always write a failing test first** before any implementation code.
2. **Write the minimal code** to make the failing test pass.
3. **Keep ARCHITECTURE.md in sync** with every infrastructure change, including the Mermaid diagram.

Never push code that does not have a corresponding test written before the implementation.

## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template
