import { Handler, Context } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ALLOWED_EXTENSIONS = ['.wav', '.mp3', '.flac', '.ogg', '.txt'];
const MAX_POLLY_TEXT_LENGTH = 3000;
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

const s3Client = new S3Client({});
const pollyClient = new PollyClient({});
const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));

interface ProcessAudioEvent {
  detail?: {
    object?: { key?: string };
    bucket?: { name?: string };
  };
  pollyResult?: Record<string, unknown>;
  dynamoResult?: Record<string, unknown>;
}

interface ProcessAudioResponse {
  statusCode: number;
  audioId: string;
  processed: boolean;
  message: string;
  timestamp: string;
  outputKey?: string;
  outputBucket?: string;
  fileSize?: number;
}

/**
 * Emits a structured JSON log entry with standard fields for observability.
 *
 * @param level - Log severity level (e.g. 'INFO', 'ERROR')
 * @param message - Human-readable log message
 * @param context - Lambda invocation context (provides requestId, functionName)
 * @param extra - Additional key-value pairs to include in the log entry
 */
function logStructured(level: string, message: string, context: Context, extra?: Record<string, unknown>): void {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    requestId: context.awsRequestId,
    functionName: context.functionName,
    ...extra,
  };
  if (level === 'ERROR') {
    console.error(JSON.stringify(logEntry));
  } else {
    console.log(JSON.stringify(logEntry));
  }
}

/**
 * Extracts the file extension (including the leading dot) from an S3 object key.
 * Returns an empty string if the key has no dot.
 */
function getExtension(key: string): string {
  const dotIndex = key.lastIndexOf('.');
  if (dotIndex === -1) return '';
  return key.substring(dotIndex).toLowerCase();
}

/**
 * Generates a unique output key in the format: processed/<baseName>-<timestamp>.mp3
 *
 * @param objectKey - The original S3 object key
 * @param timestamp - A unique timestamp string for deduplication
 * @returns The constructed output key path
 */
function generateOutputKey(objectKey: string, timestamp: string): string {
  const dotIndex = objectKey.lastIndexOf('.');
  const baseName = dotIndex !== -1 ? objectKey.substring(0, dotIndex) : objectKey;
  return `processed/${baseName}-${timestamp}.mp3`;
}

/**
 * Converts an async iterable stream (from S3 or Polly responses) into a Buffer.
 * Handles both Buffer/Uint8Array chunks and string chunks.
 *
 * @param stream - An async iterable that yields binary or string chunks
 * @returns A single concatenated Buffer containing all stream data
 */
async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Validates the incoming S3 event, ensuring all required fields are present and valid.
 * Throws descriptive errors for invalid input, enabling fast-fail before processing.
 *
 * @param event - The Lambda event payload from EventBridge
 * @param inputBucketName - Expected S3 input bucket name from environment
 * @param context - Lambda invocation context for structured logging
 * @returns Validated event data: bucketName, objectKey, and file extension
 * @throws Error if any validation check fails
 */
function validateEvent(
  event: ProcessAudioEvent,
  inputBucketName: string | undefined,
  context: Context
): { bucketName: string; objectKey: string; extension: string } {
  const bucketName = event.detail?.bucket?.name;
  if (!bucketName) {
    logStructured('ERROR', 'Validation failed: missing detail.bucket.name in event', context);
    throw new Error('Validation failed: missing detail.bucket.name in event');
  }

  const objectKey = event.detail?.object?.key;
  if (!objectKey) {
    logStructured('ERROR', 'Validation failed: missing detail.object.key in event', context);
    throw new Error('Validation failed: missing detail.object.key in event');
  }

  // Validate event bucket matches expected input bucket
  if (bucketName !== inputBucketName) {
    logStructured('ERROR', 'Validation failed: event bucket does not match expected input bucket', context, {
      eventBucket: bucketName,
      expectedBucket: inputBucketName,
    });
    throw new Error(
      `Validation failed: event bucket '${bucketName}' does not match expected input bucket '${inputBucketName}'`
    );
  }

  // Validate file extension
  const extension = getExtension(objectKey);
  if (!extension) {
    logStructured('ERROR', 'Validation failed: file has no extension', context, { objectKey });
    throw new Error('Validation failed: file has no extension');
  }
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    logStructured('ERROR', `Validation failed: unsupported file extension '${extension}'`, context, {
      objectKey,
      extension,
      allowedExtensions: ALLOWED_EXTENSIONS,
    });
    throw new Error(
      `Validation failed: unsupported file extension '${extension}'. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
    );
  }

  return { bucketName, objectKey, extension };
}

/**
 * Processes a text file by synthesizing speech using AWS Polly.
 * Validates the text length against the Polly SynthesizeSpeech character limit,
 * then invokes Polly with neural voice synthesis.
 *
 * @param inputBody - The raw text file content as a Buffer
 * @param context - Lambda invocation context for structured logging
 * @returns The synthesized audio as a Buffer (MP3 format)
 * @throws Error if text exceeds the Polly character limit
 */
async function processTextFile(inputBody: Buffer, context: Context): Promise<Buffer> {
  const textContent = inputBody.toString('utf-8');

  // Validate text length against Polly SynthesizeSpeech limit
  if (textContent.length > MAX_POLLY_TEXT_LENGTH) {
    logStructured('ERROR', 'Validation failed: text exceeds Polly SynthesizeSpeech character limit', context, {
      textLength: textContent.length,
      maxLength: MAX_POLLY_TEXT_LENGTH,
    });
    throw new Error(
      `Validation failed: text length ${textContent.length} characters exceeds Polly SynthesizeSpeech limit of ${MAX_POLLY_TEXT_LENGTH} characters`
    );
  }

  const pollyResponse = await pollyClient.send(new SynthesizeSpeechCommand({
    Engine: 'neural',
    VoiceId: 'Joanna',
    OutputFormat: 'mp3',
    Text: textContent,
  }));

  return streamToBuffer(pollyResponse.AudioStream);
}

/**
 * Processes an audio file via passthrough. Currently returns the input unchanged;
 * future DSP processing (normalization, noise reduction, etc.) would be added here.
 *
 * @param inputBody - The raw audio file content as a Buffer
 * @returns The audio Buffer unchanged (passthrough)
 */
async function processAudioFile(inputBody: Buffer): Promise<Buffer> {
  return inputBody;
}

/**
 * Main Lambda handler for the sleep audio processing pipeline.
 * Orchestrates the full processing flow: event validation, S3 download,
 * content processing (text-to-speech or audio passthrough), S3 upload,
 * and DynamoDB metadata update.
 *
 * Triggered by EventBridge when a new object is uploaded to the input S3 bucket.
 */
export const handler: Handler<ProcessAudioEvent, ProcessAudioResponse> = async (event, context) => {
  logStructured('INFO', 'SleepAudioProcessor invoked', context, { event });

  const tableName = process.env.TABLE_NAME;
  const inputBucketName = process.env.INPUT_BUCKET_NAME;
  const outputBucketName = process.env.OUTPUT_BUCKET_NAME;

  // Validate required input fields
  const { bucketName, objectKey, extension } = validateEvent(event, inputBucketName, context);

  const audioId = objectKey;
  const timestamp = Date.now().toString();

  try {
    logStructured('INFO', 'Processing audio', context, {
      audioId,
      status: 'processing',
      tableName,
      inputBucketName,
      outputBucketName,
    });

    // Step 1: Download input file from S3
    logStructured('INFO', 'Downloading input file from S3', context, { bucketName, objectKey });
    const getObjectResponse = await s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
    }));

    // Check file size before downloading body into memory
    const contentLength = getObjectResponse.ContentLength;
    if (contentLength !== undefined && contentLength > MAX_FILE_SIZE) {
      logStructured('ERROR', 'Validation failed: file size exceeds maximum allowed', context, {
        objectKey,
        contentLength,
        maxFileSize: MAX_FILE_SIZE,
      });
      throw new Error(
        `Validation failed: file size ${contentLength} bytes exceeds maximum allowed size of ${MAX_FILE_SIZE} bytes (${MAX_FILE_SIZE / (1024 * 1024)} MB)`
      );
    }

    const inputBody = await streamToBuffer(getObjectResponse.Body);

    // Step 2: Determine processing path based on file extension
    let outputBuffer: Buffer;

    if (extension === '.txt') {
      // Text input: synthesize speech using Polly
      logStructured('INFO', 'Text file detected, synthesizing speech with Polly', context, { objectKey });
      outputBuffer = await processTextFile(inputBody, context);
    } else {
      // Audio input: passthrough (audio DSP processing out of scope)
      logStructured('INFO', 'Audio file detected, processing passthrough', context, { objectKey, extension });
      outputBuffer = await processAudioFile(inputBody);
    }

    // Step 3: Upload processed output to S3 output bucket
    const outputKey = generateOutputKey(objectKey, timestamp);
    logStructured('INFO', 'Uploading processed file to output bucket', context, { outputBucketName, outputKey });

    await s3Client.send(new PutObjectCommand({
      Bucket: outputBucketName,
      Key: outputKey,
      Body: outputBuffer,
      ContentType: 'audio/mpeg',
    }));

    const fileSize = outputBuffer.length;

    // Step 4: Update DynamoDB metadata
    logStructured('INFO', 'Updating DynamoDB metadata', context, { audioId, tableName });

    await dynamoClient.send(new UpdateCommand({
      TableName: tableName,
      Key: { audioId },
      UpdateExpression: 'SET #s = :status, #ob = :outputBucket, #ok = :outputKey, #fs = :fileSize, #pa = :processedAt',
      ExpressionAttributeNames: {
        '#s': 'status',
        '#ob': 'outputBucket',
        '#ok': 'outputKey',
        '#fs': 'fileSize',
        '#pa': 'processedAt',
      },
      ExpressionAttributeValues: {
        ':status': 'COMPLETED',
        ':outputBucket': outputBucketName,
        ':outputKey': `s3://${outputBucketName}/${outputKey}`,
        ':fileSize': fileSize,
        ':processedAt': new Date().toISOString(),
      },
    }));

    logStructured('INFO', 'Audio processing completed successfully', context, {
      audioId,
      status: 'completed',
      outputKey,
      fileSize,
    });

    return {
      statusCode: 200,
      audioId,
      processed: true,
      message: 'Audio processing completed successfully',
      timestamp: new Date().toISOString(),
      outputKey,
      outputBucket: outputBucketName,
      fileSize,
    };
  } catch (error) {
    logStructured('ERROR', 'Error processing audio', context, {
      audioId,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
};
