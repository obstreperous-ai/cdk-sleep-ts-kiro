import { Handler, Context } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { PollyClient, SynthesizeSpeechCommand } from '@aws-sdk/client-polly';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const ALLOWED_EXTENSIONS = ['.wav', '.mp3', '.flac', '.ogg', '.txt'];

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

function getExtension(key: string): string {
  const dotIndex = key.lastIndexOf('.');
  if (dotIndex === -1) return '';
  return key.substring(dotIndex).toLowerCase();
}

function generateOutputKey(objectKey: string, timestamp: string): string {
  const dotIndex = objectKey.lastIndexOf('.');
  const baseName = dotIndex !== -1 ? objectKey.substring(0, dotIndex) : objectKey;
  return `processed/${baseName}-${timestamp}.mp3`;
}

async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export const handler: Handler<ProcessAudioEvent, ProcessAudioResponse> = async (event, context) => {
  logStructured('INFO', 'SleepAudioProcessor invoked', context, { event });

  const tableName = process.env.TABLE_NAME;
  const inputBucketName = process.env.INPUT_BUCKET_NAME;
  const outputBucketName = process.env.OUTPUT_BUCKET_NAME;

  // Validate required input fields
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
    const inputBody = await streamToBuffer(getObjectResponse.Body);

    // Step 2: Determine processing path based on file extension
    let outputBuffer: Buffer;

    if (extension === '.txt') {
      // Text input: synthesize speech using Polly
      logStructured('INFO', 'Text file detected, synthesizing speech with Polly', context, { objectKey });
      const textContent = inputBody.toString('utf-8');

      const pollyResponse = await pollyClient.send(new SynthesizeSpeechCommand({
        Engine: 'neural',
        VoiceId: 'Joanna',
        OutputFormat: 'mp3',
        Text: textContent,
      }));

      outputBuffer = await streamToBuffer(pollyResponse.AudioStream);
    } else {
      // Audio input: passthrough (audio DSP processing out of scope)
      logStructured('INFO', 'Audio file detected, processing passthrough', context, { objectKey, extension });
      outputBuffer = inputBody;
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
