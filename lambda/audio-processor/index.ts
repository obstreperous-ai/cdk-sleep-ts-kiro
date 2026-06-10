import { Handler, Context } from 'aws-lambda';

const ALLOWED_EXTENSIONS = ['.wav', '.mp3', '.flac', '.ogg'];

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

export const handler: Handler<ProcessAudioEvent, ProcessAudioResponse> = async (event, context) => {
  logStructured('INFO', 'SleepAudioProcessor invoked', context, { event });

  const tableName = process.env.TABLE_NAME;
  // INPUT_BUCKET_NAME and OUTPUT_BUCKET_NAME are placeholders for future audio processing
  // logic (e.g., reading source audio, writing processed output). They are wired from the
  // CDK stack but not yet consumed by handler logic.
  const inputBucket = process.env.INPUT_BUCKET_NAME;
  const outputBucket = process.env.OUTPUT_BUCKET_NAME;

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
  const dotIndex = objectKey.lastIndexOf('.');
  if (dotIndex === -1) {
    logStructured('ERROR', 'Validation failed: file has no extension', context, { objectKey });
    throw new Error('Validation failed: file has no extension');
  }
  const extension = objectKey.substring(dotIndex).toLowerCase();
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

  try {
    logStructured('INFO', 'Processing audio', context, {
      audioId,
      status: 'processing',
      tableName,
      inputBucket,
      outputBucket,
    });

    // Placeholder for future audio processing logic:
    // - Validate Polly output
    // - Enrich metadata with audio duration, format details
    // - Perform additional transformations

    logStructured('INFO', 'Audio processing completed successfully', context, {
      audioId,
      status: 'completed',
    });

    return {
      statusCode: 200,
      audioId,
      processed: true,
      message: 'Audio processing completed successfully',
      timestamp: new Date().toISOString(),
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
