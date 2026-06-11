# Architecture

## System Overview

This project implements an **event-driven sleep audio pipeline** using AWS CDK (TypeScript). The system ingests raw audio files or text prompts, orchestrates multi-step processing through AWS Step Functions, and delivers processed audio alongside structured metadata to downstream consumers.

The architecture follows a serverless, event-driven pattern where each component is decoupled and independently scalable. AWS Step Functions serves as the central orchestrator, coordinating validation, voice synthesis, audio processing, and metadata tracking. This design enables reliable, observable, and cost-efficient audio processing at any scale.

### Core Principles

- **Event-driven**: All processing is triggered by events, eliminating polling and reducing cost
- **Serverless-first**: No servers to manage; AWS handles scaling and availability
- **Least-privilege security**: Every component receives only the permissions it needs
- **Observable by default**: Structured logging, X-Ray tracing, metrics, and alarms
- **Multi-environment**: Dev, staging, and prod environments managed through CDK context

## Components

| Resource | Construct ID | Description |
|----------|-------------|-------------|
| **S3 Input Bucket** | `SleepAudioInputBucket` | Receives raw audio uploads. S3-managed encryption (AES256), versioning enabled, all public access blocked, EventBridge notifications enabled. |
| **S3 Output Bucket** | `SleepAudioOutputBucket` | Stores processed audio output. S3-managed encryption (AES256), versioning enabled, all public access blocked. |
| **EventBridge Rule** | `AudioUploadRule` | Triggers on `Object Created` events from the input bucket. Targets the Step Functions state machine. |
| **Step Functions State Machine** | `SleepAudioPipelineStateMachine` | Orchestrates the audio processing pipeline. Triggered by EventBridge on new audio uploads. CloudWatch logging enabled (level ALL). |
| **Polly Task State** | `Synthesize Speech` | Invokes Amazon Polly `StartSpeechSynthesisTask` to synthesize speech (voice: Joanna, format: MP3). Output written to the S3 Output Bucket. |
| **Validate Input (Choice)** | `Validate Input` | Choice state that fast-fails clearly invalid inputs. Checks: bucket name presence, object key presence, and file extension is a supported audio format (.wav, .mp3, .flac, .ogg). Invalid inputs route directly to the failure path. |
| **Lambda Function** | `SleepAudioProcessor` | Audio processing function (Node.js 22.x, 512MB memory, 120s timeout). Downloads input from S3, detects input type (text vs audio), synthesizes speech via Polly for text inputs or passes through audio files, uploads processed output to S3 Output Bucket, and updates DynamoDB metadata. Has S3 read access on input bucket, S3 write access on output bucket, polly:SynthesizeSpeech permission, and read/write access to the DynamoDB Metadata Table. Environment variables: TABLE_NAME, INPUT_BUCKET_NAME, OUTPUT_BUCKET_NAME. |
| **CDK Pipeline** | `PipelineStack` | Optional CDK Pipelines construct for CI/CD. Uses CodePipeline with a GitHub connection source and ShellStep synth. Deploys CdkBaseStack via a stage. Enabled via `--context enablePipeline=true`. |
| **DynamoDB Metadata Table** | `SleepAudioMetadataTable` | Stores audio pipeline metadata. Partition key: `audioId` (String). On-demand billing, AWS-managed encryption, point-in-time recovery enabled. |
| **SNS Completed Topic** | `PipelineCompletedTopic` | Publishes notification on successful pipeline completion. KMS-encrypted (aws/sns managed key). |
| **SNS Failed Topic** | `PipelineFailedTopic` | Publishes notification on pipeline failure. KMS-encrypted (aws/sns managed key). |
| **CloudWatch Alarms** | `StateMachineFailedAlarm`, `LambdaErrorsAlarm` | Monitor state machine failures and Lambda errors; fire to the SNS Failed Topic. |

## Architecture Diagram

```mermaid
flowchart TD
    User([User / Client App]) --> S3Input[S3 Input Bucket]
    S3Input -->|Object Created event| EB[EventBridge Rule]
    EB -->|Start Execution| SFN[Step Functions State Machine]
    SFN --> WriteMetadata[DynamoDB: Write Metadata]
    WriteMetadata -->|Retry on failure| WriteMetadata
    WriteMetadata --> ValidateInput{Validate Input}
    ValidateInput -->|Valid| ProcessAudio[Lambda: Process Audio]
    ValidateInput -->|Invalid| MarkFailed[DynamoDB: Mark Failed]

    %% Lambda internal processing steps
    subgraph ProcessAudio[Lambda: Process Audio]
        direction TB
        DownloadS3[Download from S3 Input Bucket]
        DetectType{Detect Input Type}
        PollySynth[Polly: SynthesizeSpeech\nNeural engine, Joanna voice, MP3]
        AudioPassthrough[Audio Passthrough\nRead audio bytes directly]
        UploadS3[Upload to S3 Output Bucket\nprocessed/name-timestamp.mp3]
        UpdateDDB[Update DynamoDB Metadata\nstatus=COMPLETED, outputKey, fileSize]
        DownloadS3 --> DetectType
        DetectType -->|.txt file| PollySynth
        DetectType -->|.mp3/.wav/.flac/.ogg| AudioPassthrough
        PollySynth --> UploadS3
        AudioPassthrough --> UploadS3
        UploadS3 --> UpdateDDB
    end

    ProcessAudio -->|Retry on failure| ProcessAudio
    ProcessAudio -->|Success| PollyTask[Polly: StartSpeechSynthesisTask]
    ProcessAudio -->|Error| MarkFailed
    PollyTask -->|Retry on failure| PollyTask
    PollyTask -->|Success| UpdateStatus[DynamoDB: Update Status]
    PollyTask -->|Error| MarkFailed
    UpdateStatus -->|Retry on failure| UpdateStatus
    UpdateStatus --> NotifySuccess[SNS: Notify Success]
    NotifySuccess --> Done([Done])
    MarkFailed --> NotifyFailure[SNS: Notify Failure]
    NotifyFailure --> PipelineFailed([Pipeline Failed])
    WriteMetadata --> DDB[(DynamoDB Metadata Table)]
    UpdateStatus --> DDB
    MarkFailed --> DDB
    UpdateDDB --> DDB
    NotifySuccess --> SNSCompleted[SNS Completed Topic]
    NotifyFailure --> SNSFailed[SNS Failed Topic]
    SNSCompleted --> Subscribers([Subscribers])
    SNSFailed --> Subscribers
    PollyTask --> S3Output[S3 Output Bucket]
    UploadS3 --> S3Output
    DownloadS3 -.-> S3Input
    XRay[AWS X-Ray] -.->|Traces| SFN
    XRay -.->|Traces| ProcessAudio
    CWAlarms[CloudWatch Alarms] -.->|Monitors| SFN
    CWAlarms -.->|Monitors| ProcessAudio
```

## Orchestration Layer

The **Step Functions state machine** (`SleepAudioPipelineStateMachine`) serves as the central orchestrator for the audio processing pipeline. It is triggered by EventBridge whenever a new audio file is uploaded to the S3 Input Bucket.

**Pipeline states:**

1. **Write Metadata** - Writes initial metadata record to DynamoDB (audioId, status=PROCESSING, inputBucket, inputKey, createdAt).
2. **Validate Input** (Choice) - Fast-fail validation that checks: (a) `detail.bucket.name` is present, (b) `detail.object.key` is present, (c) file extension matches a supported audio format (.wav, .mp3, .flac, .ogg). If any check fails, routes directly to the Mark Failed state.
3. **Process Audio** - Invokes the `SleepAudioProcessor` Lambda function via `LambdaInvoke`. Performs full audio processing: downloads input from S3, detects input type, synthesizes speech via Polly (for text) or passes through audio data, uploads processed output to S3 Output Bucket, and updates DynamoDB metadata with output location and status. On failure, catches the error and transitions to the Mark Failed state.
4. **Synthesize Speech** - Invokes Amazon Polly `StartSpeechSynthesisTask` with configurable parameters (text from event input, voice: Joanna, format: MP3). The synthesized audio is written to the S3 Output Bucket. On failure, catches the error and transitions to the Mark Failed state.
5. **Update Status** - Updates the DynamoDB record status to COMPLETED with updatedAt timestamp.
6. **Notify Success** - Publishes a success notification to the SNS Completed topic (includes audioId and completion timestamp).
7. **Done** - Terminal success state.
8. **Mark Failed** (error path) - Updates the DynamoDB record status to FAILED with updatedAt timestamp.
9. **Notify Failure** (error path) - Publishes a failure notification to the SNS Failed topic (includes audioId and failure timestamp).
10. **Pipeline Failed** (error path) - Terminal failure state reached after marking the metadata record as FAILED.

### Error Handling

- The Validate Input Choice state provides fast-fail for clearly invalid inputs (missing bucket/key or unsupported file extension), routing them directly to Mark Failed without invoking Lambda or Polly.
- The Process Audio Lambda has a Catch clause that routes errors to the Mark Failed state, handling runtime validation failures and unexpected exceptions. Uses catch-all (`States.ALL`) to ensure no error type can bypass the failure path.
- The Polly task has a Catch clause that routes all errors to the Mark Failed state, ensuring the DynamoDB metadata record accurately reflects pipeline failures instead of remaining stuck in PROCESSING status indefinitely. Uses catch-all (`States.ALL`) while retry remains scoped to `States.TaskFailed`.
- The Write Metadata task has a Catch clause routing errors to the Mark Failed state, handling DynamoDB write failures.
- The Update Status task has a Catch clause routing errors to the Mark Failed state, handling DynamoDB update failures.
- All failure paths converge on Mark Failed -> Notify Failure -> Pipeline Failed, ensuring consistent error reporting regardless of where the failure occurs.

### Retry Policies

| Task | Error Types | Interval | Max Attempts | Backoff Rate |
|------|-------------|----------|--------------|--------------|
| Process Audio (Lambda) | States.TaskFailed, Lambda.ServiceException, Lambda.SdkClientException | 2s | 3 | 2.0 |
| Synthesize Speech (Polly) | States.TaskFailed | 3s | 2 | 2.0 |
| Write Metadata (DynamoDB) | States.ALL | 1s | 3 | 2.0 |
| Update Status (DynamoDB) | States.ALL | 1s | 3 | 2.0 |

All retries use exponential backoff. Retries are attempted before falling through to the Catch handler, so transient failures are automatically recovered without triggering the error path. The CDK LambdaInvoke default retry policy is disabled (`retryOnServiceExceptions: false`) to prevent duplicate retry entries.

### Input Validation

The pipeline employs a two-layer validation strategy:

**Layer 1: State Machine Choice State (fast-fail)**
- Checks `$.detail.bucket.name` is present (IsPresent)
- Checks `$.detail.object.key` is present (IsPresent)
- Validates file extension matches supported audio formats using StringMatches (`*.wav`, `*.mp3`, `*.flac`, `*.ogg`)
- Rejects clearly invalid inputs before invoking any compute resources

**Layer 2: Lambda Runtime Validation (detailed checks)**
- Validates that `detail.bucket.name` and `detail.object.key` exist and are non-empty
- Validates file extension is in the supported list (.wav, .mp3, .flac, .ogg, .txt)
- Validates event bucket matches the expected input bucket
- Validates file size does not exceed 100 MB
- Validates text length does not exceed Polly SynthesizeSpeech character limit (3000 chars)
- Throws descriptive error messages for each failure case

**Supported file extensions:** `.wav`, `.mp3`, `.flac`, `.ogg` (state machine); additionally `.txt` (Lambda)

**Required fields:** `detail.bucket.name`, `detail.object.key`

**Error behavior:** Validation failures at either layer route to FAILED status in DynamoDB and publish a failure notification to the SNS Failed topic, ensuring callers are always informed of rejected inputs.

### Security

- The state machine execution role follows least-privilege principles with permissions scoped to `polly:StartSpeechSynthesisTask`, `s3:PutObject` on the output bucket, `lambda:InvokeFunction` on the SleepAudioProcessor, and DynamoDB operations on the metadata table only.
- The Lambda execution role has S3 read access on the input bucket, S3 write access on the output bucket, polly:SynthesizeSpeech permission, read/write access to the DynamoDB Metadata Table, CloudWatch Logs permissions for observability, and X-Ray tracing permissions.
- CloudWatch logging is enabled at level ALL with execution data included for full observability.

## Observability

The pipeline implements comprehensive observability through multiple layers:

### X-Ray Tracing

- The Lambda function (`SleepAudioProcessor`) has active X-Ray tracing enabled, providing end-to-end request tracing and performance insights.
- The Step Functions state machine has tracing enabled, allowing distributed trace correlation across all pipeline states.

### Structured Logging

- The Lambda handler uses structured JSON logging with fields: `timestamp`, `level`, `message`, `requestId`, `functionName`, and contextual data.
- All log entries include the AWS request ID for correlation with X-Ray traces.
- Log levels: INFO for normal operations, ERROR for validation failures and exceptions.

### CloudWatch Alarms

| Alarm | Metric | Namespace | Threshold | Period | Evaluation Periods |
|-------|--------|-----------|-----------|--------|-------------------|
| State Machine Failures | ExecutionsFailed | AWS/States | >= 1 | 60s | 5 |
| Lambda Errors | Errors | AWS/Lambda | >= 1 | 60s | 5 |

Both alarms use Sum statistic with GreaterThanOrEqualToThreshold comparison, triggering when at least one failure occurs within a 5-minute evaluation window. Both alarms are wired to the `PipelineFailedTopic` SNS topic via alarm actions, ensuring operators are notified when alarms fire.

## Audio Processing Logic

The `SleepAudioProcessor` Lambda function performs the core audio processing within the pipeline. It handles the full lifecycle from downloading input to storing processed output and updating metadata.

### Processing Steps

1. **S3 Download** - Downloads the input file from the S3 Input Bucket using the bucket name and object key provided in the event payload.
2. **Input Type Detection** - The file extension determines the processing path:
   - `.txt` files are treated as text prompts for speech synthesis
   - `.mp3`, `.wav`, `.flac`, `.ogg` files are treated as audio for passthrough processing
3. **Processing**:
   - **Text input (Polly synthesis)** - For `.txt` files, calls Amazon Polly `SynthesizeSpeech` with the neural engine, Joanna voice, and MP3 output format.
   - **Audio input (passthrough)** - For audio files, reads the raw audio bytes directly. This path serves as a placeholder for future audio DSP enhancements.
4. **S3 Upload** - Uploads the processed audio to the S3 Output Bucket with the naming convention: `processed/<original-key-without-extension>-<timestamp>.mp3`
5. **DynamoDB Metadata Update** - Updates the metadata record with: `status=COMPLETED`, `outputBucket`, `outputKey` (S3 URI), `fileSize`, `processedAt` (ISO 8601 timestamp).

### Lambda Configuration

| Setting | Value | Rationale |
|---------|-------|-----------|
| Runtime | Node.js 22.x | Latest LTS with built-in AWS SDK v3 |
| Memory | 512MB | Sufficient for audio file buffering and Polly responses |
| Timeout | 120s | Allows time for S3 transfers and Polly synthesis of longer texts |
| Tracing | AWS X-Ray (active) | End-to-end performance visibility |

### IAM Permissions

| Permission | Scope | Purpose |
|------------|-------|---------|
| S3 read | Input Bucket | Download input files for processing |
| S3 write | Output Bucket | Upload processed audio output |
| polly:SynthesizeSpeech | All resources | Synthesize speech from text prompts |
| DynamoDB read/write | Metadata Table | Update processing status and output metadata |
| CloudWatch Logs | Log group | Emit structured logs |
| X-Ray | Tracing | Publish trace segments |

## Notification Layer

The pipeline uses **Amazon SNS** to notify downstream consumers of pipeline outcomes.

| Topic | Construct ID | Purpose |
|-------|-------------|---------|
| `SleepAudioPipelineCompleted` | `PipelineCompletedTopic` | Published on successful pipeline completion. Message includes audioId and completion timestamp. |
| `SleepAudioPipelineFailed` | `PipelineFailedTopic` | Published on pipeline failure. Message includes audioId, failure timestamp, error, and cause. |

Both topics are encrypted at rest using the AWS-managed SNS KMS key (`alias/aws/sns`), ensuring notification payloads are protected without the overhead of managing custom KMS keys.

Subscribers (mobile apps, dashboards, alerting systems) can subscribe to one or both topics to receive real-time pipeline status updates.

## Metadata Layer

The **DynamoDB Metadata Table** (`SleepAudioMetadataTable`) tracks the execution state of each audio processing pipeline run.

**Initial record** (written at pipeline start):
- `audioId` (partition key) - the S3 object key
- `status` = PROCESSING
- `inputBucket`, `inputKey`, `createdAt`

**On success** (updated by Lambda and state machine):
- `status` = COMPLETED
- `outputBucket`, `outputKey` (S3 URI), `fileSize`, `processedAt`, `updatedAt`

**On failure** (updated by Mark Failed state):
- `status` = FAILED
- `updatedAt`

This provides a queryable audit trail of all pipeline executions, enabling downstream consumers to check processing status without polling the state machine directly.

## Deployment and Environments

The pipeline supports multi-environment deployment through CDK context values. The environment is read from the `environment` context variable and defaults to `dev` if not specified.

```bash
# Deploy to dev (default)
npx cdk deploy

# Deploy to staging
npx cdk deploy --context environment=staging

# Deploy to production
npx cdk deploy --context environment=prod
```

The environment value is applied as a tag (`environment`) on all resources in the stack, enabling cost allocation and resource identification.

### CDK Pipelines Construct

The project includes an optional `PipelineStack` (`lib/pipeline-stack.ts`) that implements a CI/CD pipeline using CDK Pipelines. It is enabled by setting the `enablePipeline` context flag:

```bash
npx cdk deploy --context enablePipeline=true
```

The pipeline construct:
- Sources code from a GitHub connection (placeholder ARN, to be configured per account)
- Runs `npm ci` and `npx cdk synth` in a ShellStep for synthesis
- Deploys the `CdkBaseStack` via a deployment stage

## Future Enhancements

The event-driven, modular architecture supports several natural extension points:

- **Bedrock Enhancement Lambda** - Leverage Amazon Bedrock for AI-generated ambient sleep sounds and audio enhancement techniques (noise smoothing, binaural beats). This step can be added as an additional state in the Step Functions workflow.
- **Audio DSP Processing** - Replace the current audio passthrough with normalization, mixing, and effects processing.
- **Multi-Voice Polly Support** - Allow users to select different Polly voices and engines per request.
- **S3 Lifecycle Policies** - Transition old processed files to Glacier or delete after a retention period.
- **API Gateway Integration** - Expose endpoints for pre-signed upload URLs and processing status queries.
- **Content Delivery** - CloudFront distribution for low-latency global audio delivery.
- **Multi-Region** - S3 Cross-Region Replication and DynamoDB Global Tables for disaster recovery.
