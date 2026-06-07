import { Handler } from 'aws-lambda';

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

export const handler: Handler<ProcessAudioEvent, ProcessAudioResponse> = async (event) => {
  console.log('SleepAudioProcessor invoked with event:', JSON.stringify(event, null, 2));

  const tableName = process.env.TABLE_NAME;
  const inputBucket = process.env.INPUT_BUCKET_NAME;
  const outputBucket = process.env.OUTPUT_BUCKET_NAME;

  // Validate required input fields
  const bucketName = event.detail?.bucket?.name;
  if (!bucketName) {
    throw new Error('Validation failed: missing detail.bucket.name in event');
  }

  const objectKey = event.detail?.object?.key;
  if (!objectKey) {
    throw new Error('Validation failed: missing detail.object.key in event');
  }

  // Validate file extension
  const extension = objectKey.substring(objectKey.lastIndexOf('.')).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    throw new Error(
      `Validation failed: unsupported file extension '${extension}'. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
    );
  }

  const audioId = objectKey;

  try {
    console.log(`Processing audio: ${audioId}`);
    console.log(`DynamoDB table: ${tableName}`);
    console.log(`Input bucket: ${inputBucket}`);
    console.log(`Output bucket: ${outputBucket}`);

    // Placeholder for future audio processing logic:
    // - Validate Polly output
    // - Enrich metadata with audio duration, format details
    // - Perform additional transformations

    return {
      statusCode: 200,
      audioId,
      processed: true,
      message: 'Audio processing completed successfully',
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Error processing audio:', error);
    throw error;
  }
};
