import { Context } from 'aws-lambda';

// Mock AWS SDK clients before importing the handler
const mockS3Send = jest.fn();
const mockPollySend = jest.fn();
const mockDynamoSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'GetObjectCommand' })),
  PutObjectCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'PutObjectCommand' })),
}));

jest.mock('@aws-sdk/client-polly', () => ({
  PollyClient: jest.fn().mockImplementation(() => ({ send: mockPollySend })),
  SynthesizeSpeechCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'SynthesizeSpeechCommand' })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn().mockImplementation(() => ({ send: mockDynamoSend })),
  },
  UpdateCommand: jest.fn().mockImplementation((params) => ({ ...params, _type: 'UpdateCommand' })),
}));

import { handler } from '../lambda/audio-processor/index';

// Helper to create a readable stream-like async iterable from a buffer
function createMockStream(data: Buffer) {
  return {
    async *[Symbol.asyncIterator]() {
      yield data;
    },
  };
}

const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'test-function',
  functionVersion: '1',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:test-function',
  memoryLimitInMB: '512',
  awsRequestId: 'test-request-id',
  logGroupName: '/aws/lambda/test-function',
  logStreamName: 'test-stream',
  getRemainingTimeInMillis: () => 120000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
};

describe('Audio Processor Lambda Handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TABLE_NAME = 'test-metadata-table';
    process.env.INPUT_BUCKET_NAME = 'test-input-bucket';
    process.env.OUTPUT_BUCKET_NAME = 'test-output-bucket';
  });

  afterEach(() => {
    delete process.env.TABLE_NAME;
    delete process.env.INPUT_BUCKET_NAME;
    delete process.env.OUTPUT_BUCKET_NAME;
  });

  describe('Input Validation', () => {
    test('throws error when detail.bucket.name is missing', async () => {
      const event = {
        detail: {
          object: { key: 'audio/test.mp3' },
        },
      };

      await expect(handler(event, mockContext, () => {})).rejects.toThrow(
        'Validation failed: missing detail.bucket.name in event'
      );
    });

    test('throws error when detail.object.key is missing', async () => {
      const event = {
        detail: {
          bucket: { name: 'test-bucket' },
        },
      };

      await expect(handler(event, mockContext, () => {})).rejects.toThrow(
        'Validation failed: missing detail.object.key in event'
      );
    });

    test('throws error when file has no extension', async () => {
      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'audio/noextension' },
        },
      };

      await expect(handler(event, mockContext, () => {})).rejects.toThrow(
        'Validation failed: file has no extension'
      );
    });

    test('throws error for unsupported file extension', async () => {
      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'audio/test.pdf' },
        },
      };

      await expect(handler(event, mockContext, () => {})).rejects.toThrow(
        "Validation failed: unsupported file extension '.pdf'"
      );
    });

    test('throws error when event bucket does not match INPUT_BUCKET_NAME', async () => {
      const event = {
        detail: {
          bucket: { name: 'wrong-bucket' },
          object: { key: 'audio/test.mp3' },
        },
      };

      await expect(handler(event, mockContext, () => {})).rejects.toThrow(
        "Validation failed: event bucket 'wrong-bucket' does not match expected input bucket 'test-input-bucket'"
      );
    });

    test('throws error when file size exceeds MAX_FILE_SIZE', async () => {
      const contentLength = 150 * 1024 * 1024; // 150 MB, exceeds 100 MB limit

      mockS3Send.mockResolvedValueOnce({
        ContentLength: contentLength,
        Body: createMockStream(Buffer.from('small-mock-data')),
      });

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'audio/huge-file.mp3' },
        },
      };

      await expect(handler(event, mockContext, () => {})).rejects.toThrow(
        `Validation failed: file size ${contentLength} bytes exceeds maximum allowed size of ${100 * 1024 * 1024} bytes (100 MB)`
      );
    });

    test('throws error when text exceeds Polly 3000 character limit', async () => {
      const longText = 'a'.repeat(3001);

      mockS3Send.mockResolvedValueOnce({
        ContentLength: longText.length,
        Body: createMockStream(Buffer.from(longText)),
      });

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'prompts/long-story.txt' },
        },
      };

      await expect(handler(event, mockContext, () => {})).rejects.toThrow(
        'Validation failed: text length 3001 characters exceeds Polly SynthesizeSpeech limit of 3000 characters'
      );
    });

    test('allows text exactly at 3000 character limit', async () => {
      const exactText = 'a'.repeat(3000);
      const audioBuffer = Buffer.from('mock-audio-data');

      mockS3Send.mockResolvedValueOnce({
        ContentLength: exactText.length,
        Body: createMockStream(Buffer.from(exactText)),
      });
      mockPollySend.mockResolvedValueOnce({
        AudioStream: createMockStream(audioBuffer),
      });
      mockS3Send.mockResolvedValueOnce({}); // PutObject
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'prompts/exact-limit.txt' },
        },
      };

      const result = await handler(event, mockContext, () => {});
      expect(result!.statusCode).toBe(200);
      expect(result!.processed).toBe(true);
    });

    test('allows file size exactly at MAX_FILE_SIZE boundary', async () => {
      const audioBuffer = Buffer.from('audio-data');

      mockS3Send.mockResolvedValueOnce({
        ContentLength: 100 * 1024 * 1024, // exactly 100 MB
        Body: createMockStream(audioBuffer),
      });
      mockS3Send.mockResolvedValueOnce({}); // PutObject
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'audio/big-but-ok.mp3' },
        },
      };

      const result = await handler(event, mockContext, () => {});
      expect(result!.statusCode).toBe(200);
      expect(result!.processed).toBe(true);
    });
  });

  describe('Input Type Detection', () => {
    test('text files (.txt) trigger Polly synthesis path', async () => {
      const textContent = 'Sleep well tonight with calm waves';
      const audioBuffer = Buffer.from('mock-audio-data');

      mockS3Send.mockResolvedValueOnce({
        Body: createMockStream(Buffer.from(textContent)),
      });
      mockPollySend.mockResolvedValueOnce({
        AudioStream: createMockStream(audioBuffer),
      });
      mockS3Send.mockResolvedValueOnce({}); // PutObject
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'prompts/sleep-story.txt' },
        },
      };

      const result = await handler(event, mockContext, () => {});

      // Verify Polly was called
      expect(mockPollySend).toHaveBeenCalledTimes(1);
      const { SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
      expect(SynthesizeSpeechCommand).toHaveBeenCalledWith({
        Engine: 'neural',
        VoiceId: 'Joanna',
        OutputFormat: 'mp3',
        Text: textContent,
      });

      expect(result!.statusCode).toBe(200);
      expect(result!.processed).toBe(true);
    });

    test('audio files (.mp3) trigger audio processing passthrough path', async () => {
      const audioBuffer = Buffer.from('mock-mp3-audio-data');

      mockS3Send.mockResolvedValueOnce({
        Body: createMockStream(audioBuffer),
      });
      mockS3Send.mockResolvedValueOnce({}); // PutObject
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'audio/relaxing-music.mp3' },
        },
      };

      const result = await handler(event, mockContext, () => {});

      // Polly should NOT be called for audio files
      expect(mockPollySend).not.toHaveBeenCalled();
      expect(result!.statusCode).toBe(200);
      expect(result!.processed).toBe(true);
    });

    test('audio files (.wav) trigger audio processing passthrough path', async () => {
      const audioBuffer = Buffer.from('mock-wav-audio-data');

      mockS3Send.mockResolvedValueOnce({
        Body: createMockStream(audioBuffer),
      });
      mockS3Send.mockResolvedValueOnce({}); // PutObject
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'audio/ocean-waves.wav' },
        },
      };

      const result = await handler(event, mockContext, () => {});

      expect(mockPollySend).not.toHaveBeenCalled();
      expect(result!.statusCode).toBe(200);
    });

    test('audio files (.flac) trigger audio processing passthrough path', async () => {
      const audioBuffer = Buffer.from('mock-flac-audio-data');

      mockS3Send.mockResolvedValueOnce({
        Body: createMockStream(audioBuffer),
      });
      mockS3Send.mockResolvedValueOnce({}); // PutObject
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'audio/rain-sound.flac' },
        },
      };

      const result = await handler(event, mockContext, () => {});

      expect(mockPollySend).not.toHaveBeenCalled();
      expect(result!.statusCode).toBe(200);
    });

    test('audio files (.ogg) trigger audio processing passthrough path', async () => {
      const audioBuffer = Buffer.from('mock-ogg-audio-data');

      mockS3Send.mockResolvedValueOnce({
        Body: createMockStream(audioBuffer),
      });
      mockS3Send.mockResolvedValueOnce({}); // PutObject
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'audio/forest-ambient.ogg' },
        },
      };

      const result = await handler(event, mockContext, () => {});

      expect(mockPollySend).not.toHaveBeenCalled();
      expect(result!.statusCode).toBe(200);
    });
  });

  describe('Happy Path - Full Processing Pipeline', () => {
    test('downloads from S3, processes audio file, uploads to output, updates DynamoDB', async () => {
      const audioBuffer = Buffer.from('mock-audio-content-bytes');

      mockS3Send.mockResolvedValueOnce({
        Body: createMockStream(audioBuffer),
      });
      mockS3Send.mockResolvedValueOnce({}); // PutObject
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'audio/sleep-sounds.mp3' },
        },
      };

      const result = await handler(event, mockContext, () => {});

      // Verify S3 GetObject was called with correct params
      const { GetObjectCommand } = require('@aws-sdk/client-s3');
      expect(GetObjectCommand).toHaveBeenCalledWith({
        Bucket: 'test-input-bucket',
        Key: 'audio/sleep-sounds.mp3',
      });

      // Verify S3 PutObject was called with output bucket
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-output-bucket',
          ContentType: 'audio/mpeg',
        })
      );

      // Verify DynamoDB update was called
      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          TableName: 'test-metadata-table',
          Key: { audioId: 'audio/sleep-sounds.mp3' },
          ExpressionAttributeValues: expect.objectContaining({
            ':status': 'COMPLETED',
            ':outputBucket': 'test-output-bucket',
            ':fileSize': audioBuffer.length,
          }),
        })
      );

      // Verify response
      expect(result!.statusCode).toBe(200);
      expect(result!.audioId).toBe('audio/sleep-sounds.mp3');
      expect(result!.processed).toBe(true);
      expect(result!.outputBucket).toBe('test-output-bucket');
      expect(result!.fileSize).toBe(audioBuffer.length);
      expect(result!.outputKey).toMatch(/^processed\/audio\/sleep-sounds-\d+\.mp3$/);
    });

    test('downloads text from S3, synthesizes with Polly, uploads to output, updates DynamoDB', async () => {
      const textContent = 'Once upon a time, in a peaceful meadow...';
      const synthesizedAudio = Buffer.from('synthesized-audio-bytes-from-polly');

      mockS3Send.mockResolvedValueOnce({
        Body: createMockStream(Buffer.from(textContent)),
      });
      mockPollySend.mockResolvedValueOnce({
        AudioStream: createMockStream(synthesizedAudio),
      });
      mockS3Send.mockResolvedValueOnce({}); // PutObject
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'stories/bedtime-story.txt' },
        },
      };

      const result = await handler(event, mockContext, () => {});

      // Verify Polly was called with correct params
      const { SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
      expect(SynthesizeSpeechCommand).toHaveBeenCalledWith({
        Engine: 'neural',
        VoiceId: 'Joanna',
        OutputFormat: 'mp3',
        Text: textContent,
      });

      // Verify output was uploaded
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      expect(PutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-output-bucket',
          Body: synthesizedAudio,
          ContentType: 'audio/mpeg',
        })
      );

      // Verify response
      expect(result!.statusCode).toBe(200);
      expect(result!.audioId).toBe('stories/bedtime-story.txt');
      expect(result!.processed).toBe(true);
      expect(result!.fileSize).toBe(synthesizedAudio.length);
      expect(result!.outputKey).toMatch(/^processed\/stories\/bedtime-story-\d+\.mp3$/);
    });

    test('output key follows naming convention: processed/<base-key>-<timestamp>.mp3', async () => {
      const audioBuffer = Buffer.from('audio-data');

      mockS3Send.mockResolvedValueOnce({
        Body: createMockStream(audioBuffer),
      });
      mockS3Send.mockResolvedValueOnce({}); // PutObject
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'uploads/deep-sleep.wav' },
        },
      };

      const result = await handler(event, mockContext, () => {});

      expect(result!.outputKey).toMatch(/^processed\/uploads\/deep-sleep-\d+\.mp3$/);
    });

    test('DynamoDB metadata update includes outputKey as S3 URI', async () => {
      const audioBuffer = Buffer.from('audio-data');

      mockS3Send.mockResolvedValueOnce({
        Body: createMockStream(audioBuffer),
      });
      mockS3Send.mockResolvedValueOnce({}); // PutObject
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'audio/calm.mp3' },
        },
      };

      const result = await handler(event, mockContext, () => {});

      const { UpdateCommand } = require('@aws-sdk/lib-dynamodb');
      expect(UpdateCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ExpressionAttributeValues: expect.objectContaining({
            ':outputKey': expect.stringMatching(/^s3:\/\/test-output-bucket\/processed\/audio\/calm-\d+\.mp3$/),
          }),
        })
      );
    });
  });

  describe('Error Paths', () => {
    test('S3 download failure is propagated as error', async () => {
      mockS3Send.mockRejectedValueOnce(new Error('S3 GetObject failed: Access Denied'));

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'audio/missing-file.mp3' },
        },
      };

      await expect(handler(event, mockContext, () => {})).rejects.toThrow(
        'S3 GetObject failed: Access Denied'
      );
    });

    test('Polly synthesis failure is propagated as error', async () => {
      const textContent = 'Some text to synthesize';

      mockS3Send.mockResolvedValueOnce({
        Body: createMockStream(Buffer.from(textContent)),
      });
      mockPollySend.mockRejectedValueOnce(new Error('Polly SynthesizeSpeech failed: ThrottlingException'));

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'prompts/story.txt' },
        },
      };

      await expect(handler(event, mockContext, () => {})).rejects.toThrow(
        'Polly SynthesizeSpeech failed: ThrottlingException'
      );
    });

    test('S3 upload failure is propagated as error', async () => {
      const audioBuffer = Buffer.from('audio-data');

      mockS3Send.mockResolvedValueOnce({
        Body: createMockStream(audioBuffer),
      });
      mockS3Send.mockRejectedValueOnce(new Error('S3 PutObject failed: Bucket not found'));

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'audio/test.mp3' },
        },
      };

      await expect(handler(event, mockContext, () => {})).rejects.toThrow(
        'S3 PutObject failed: Bucket not found'
      );
    });

    test('DynamoDB update failure is propagated as error', async () => {
      const audioBuffer = Buffer.from('audio-data');

      mockS3Send.mockResolvedValueOnce({
        Body: createMockStream(audioBuffer),
      });
      mockS3Send.mockResolvedValueOnce({}); // PutObject succeeds
      mockDynamoSend.mockRejectedValueOnce(new Error('DynamoDB UpdateItem failed: ConditionalCheckFailedException'));

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'audio/test.mp3' },
        },
      };

      await expect(handler(event, mockContext, () => {})).rejects.toThrow(
        'DynamoDB UpdateItem failed: ConditionalCheckFailedException'
      );
    });
  });

  describe('Response Structure', () => {
    test('returns structured response with all required fields', async () => {
      const audioBuffer = Buffer.from('audio-response-test');

      mockS3Send.mockResolvedValueOnce({
        Body: createMockStream(audioBuffer),
      });
      mockS3Send.mockResolvedValueOnce({}); // PutObject
      mockDynamoSend.mockResolvedValueOnce({}); // UpdateCommand

      const event = {
        detail: {
          bucket: { name: 'test-input-bucket' },
          object: { key: 'audio/response-test.mp3' },
        },
      };

      const result = await handler(event, mockContext, () => {});

      expect(result).toEqual(
        expect.objectContaining({
          statusCode: 200,
          audioId: 'audio/response-test.mp3',
          processed: true,
          message: 'Audio processing completed successfully',
          outputBucket: 'test-output-bucket',
          fileSize: audioBuffer.length,
        })
      );
      expect(result!.timestamp).toBeDefined();
      expect(result!.outputKey).toBeDefined();
    });
  });
});
