# Project Summary

## Overview

The CDK Sleep Audio Pipeline is an event-driven, serverless audio processing system built with AWS CDK (TypeScript). It was developed as an experiment in building a complete cloud-native pipeline following strict Test-Driven Development (TDD) practices, demonstrating how infrastructure-as-code and automated testing combine to produce a reliable, well-documented system.

The pipeline processes sleep-related audio content: users upload audio files for passthrough processing or text prompts that are converted to soothing speech via Amazon Polly. The system handles the full lifecycle from ingestion through processing to notification delivery.

## Key Architectural Decisions

### Serverless, Event-Driven Design

All components are serverless and pay-per-use. When no audio is being processed, the running cost is near zero. EventBridge decouples ingestion from processing, enabling independent scaling and extensibility.

### Step Functions Orchestration

AWS Step Functions was chosen as the central orchestrator rather than chaining Lambda functions directly. This provides:
- Visual workflow representation
- Built-in error handling and retry logic
- State tracking without custom code
- Timeout management at the workflow level

### Two-Layer Validation

Input validation is split across two layers:
1. **State Machine Choice State** - Fast-fail for clearly invalid inputs (missing fields, wrong extensions) without invoking compute resources
2. **Lambda Runtime Validation** - Detailed checks (bucket match, file size, text length) with descriptive error messages

This approach minimizes compute costs for obviously bad inputs while maintaining thorough validation for edge cases.

### SNS Notifications for Both Success and Failure

Both outcomes (COMPLETED and FAILED) publish to dedicated, KMS-encrypted SNS topics. This ensures downstream consumers always know the pipeline result without polling DynamoDB or Step Functions.

### Exponential Backoff Retry Policies

Every task in the state machine has retry policies with exponential backoff. Transient failures (SDK exceptions, throttling) are automatically recovered without manual intervention. Retries are attempted before Catch handlers fire, so only persistent failures route to the error path.

### X-Ray Tracing and CloudWatch Alarms

Observability was built in from the start. X-Ray provides distributed tracing across the Lambda and state machine. CloudWatch alarms on state machine failures and Lambda errors proactively notify operators via SNS.

### DynamoDB Metadata Tracking

A DynamoDB table provides a queryable audit trail of every pipeline execution. Records transition from PROCESSING to COMPLETED or FAILED, enabling status checks without polling the state machine.

## What Was Built

### Infrastructure Components

- **S3 Input Bucket** - Receives uploads with versioning, encryption, and EventBridge notifications
- **S3 Output Bucket** - Stores processed audio with versioning and encryption
- **EventBridge Rule** - Triggers the pipeline on Object Created events
- **Step Functions State Machine** - 10-state workflow with retry and error handling
- **Lambda Function** (SleepAudioProcessor) - Full audio processing with S3, Polly, and DynamoDB integration
- **DynamoDB Metadata Table** - On-demand billing, point-in-time recovery, AWS-managed encryption
- **SNS Completed Topic** - KMS-encrypted success notifications
- **SNS Failed Topic** - KMS-encrypted failure notifications
- **CloudWatch Alarms** - State machine failure alarm and Lambda error alarm
- **CloudWatch Log Group** - State machine execution logs at ALL level
- **CDK Pipeline Stack** - Optional CI/CD pipeline using CodePipeline

### Pipeline States

1. Write Metadata (DynamoDB PutItem)
2. Validate Input (Choice - fast-fail)
3. Set Validation Error (Pass - inject error info for invalid inputs)
4. Process Audio (Lambda Invoke)
5. Synthesize Speech (Polly StartSpeechSynthesisTask)
6. Update Status (DynamoDB UpdateItem)
7. Notify Success (SNS Publish)
8. Done (Succeed)
9. Mark Failed (DynamoDB UpdateItem)
10. Notify Failure (SNS Publish)
11. Pipeline Failed (Fail)

### Lambda Capabilities

- Downloads input files from S3
- Detects input type by file extension (.txt vs audio)
- Synthesizes speech via Polly (neural engine, Joanna voice, MP3)
- Passes through audio files directly
- Uploads processed output to S3 with timestamped naming
- Updates DynamoDB metadata with output location and file size
- Structured JSON logging with X-Ray trace correlation

### Test Suite (196 tests)

- CDK stack infrastructure assertions (Template.fromStack + Match helpers)
- Lambda unit tests with mocked AWS SDK clients
- Pipeline stack tests
- Snapshot test for full CloudFormation template drift detection
- End-to-end validation tests parsing the state machine definition

## TDD Approach

The entire project was built following strict TDD:

1. Every feature started with a failing test that defined the expected behavior
2. Only the minimal implementation needed to pass the test was written
3. Refactoring followed while keeping all tests green
4. ARCHITECTURE.md was kept in sync with every infrastructure change

This approach resulted in:
- 100% of infrastructure resources covered by assertions
- Confidence that changes do not introduce regressions
- Documentation that accurately reflects the implementation
- A clear audit trail of design decisions through test descriptions

## Potential Future Enhancements

- **Bedrock AI Enhancement** - Use Amazon Bedrock foundation models for AI-generated ambient sleep sounds, noise smoothing, and binaural beat generation
- **Audio DSP Processing** - Replace the passthrough path with actual audio processing (normalization, mixing, effects, volume adjustment)
- **Multi-Voice Polly Support** - Allow users to specify voice, engine, and language parameters per request
- **S3 Lifecycle Policies** - Transition old processed files to Glacier after a retention period, or delete automatically
- **API Gateway** - REST/HTTP API for generating pre-signed upload URLs and querying processing status
- **WebSocket Notifications** - Real-time status push to connected clients via API Gateway WebSocket
- **Content Delivery** - CloudFront distribution for low-latency global audio delivery
- **Multi-Region** - Cross-Region Replication and DynamoDB Global Tables for disaster recovery

## Experiment Notes

### Development Process

- The project was developed through 12 iterative issues, each building on the previous
- Strict TDD was maintained throughout, with tests always written before implementation
- ARCHITECTURE.md served as the living design document, updated with every feature
- Conventional commits provided a clear change history

### Technical Observations

- CDK L2/L3 constructs significantly reduce boilerplate while maintaining best practices
- Step Functions Choice states provide cost-effective input validation without Lambda invocations
- The two-layer validation pattern (Choice + Lambda) balances cost efficiency with error detail
- SNS KMS encryption using the aws/sns managed key eliminates key management overhead
- CDK Pipelines provides a minimal-setup CI/CD path with room to extend

### Testing Insights

- `Template.fromStack()` with `Match.objectLike()` enables flexible assertions that survive unrelated changes
- Snapshot testing catches unintended drift but requires intentional updates after legitimate changes
- Parsing the state machine definition (Fn::Join parts) enables verification of orchestration logic without deployment
- Mocking AWS SDK clients at the module level allows isolated Lambda unit testing

### Architecture Fitness

The serverless, event-driven architecture is well-suited for:
- Bursty, unpredictable workloads (pay-per-use)
- Multi-step processing with failure recovery needs
- Systems requiring audit trails and observability
- Rapid iteration with infrastructure-as-code
