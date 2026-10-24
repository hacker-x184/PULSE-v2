import test from 'node:test';
import assert from 'node:assert/strict';
import { ElevenLabsVoiceService } from '../src/ai/elevenlabsVoice.ts';

test('ElevenLabs Voice: Service detects unconfigured API key safely', () => {
  const service = new ElevenLabsVoiceService('');
  assert.equal(service.isConfigured(), false);
  const status = service.getConfigStatus();
  assert.equal(status.isConfigured, false);
  assert.equal(status.modelStt, 'scribe_v1');
  assert.equal(status.modelTts, 'eleven_multilingual_v2');
  assert.ok(status.supportedLanguages.some(l => l.code === 'hi'), 'Hindi must be supported');
  assert.ok(status.supportedLanguages.some(l => l.code === 'en'), 'English must be supported');
});

test('ElevenLabs Voice: Transcription throws clear error when key is missing', async () => {
  const service = new ElevenLabsVoiceService('');
  const dummyBuffer = Buffer.from('RIFF....WAVEfmt ');

  await assert.rejects(
    async () => {
      await service.transcribe(dummyBuffer, 'audio/wav');
    },
    {
      name: 'Error',
      message: /ElevenLabs API key is not configured/
    }
  );
});

test('ElevenLabs Voice: Speech synthesis throws clear error when key is missing', async () => {
  const service = new ElevenLabsVoiceService('');

  await assert.rejects(
    async () => {
      await service.synthesize('Hello from PULSE project management');
    },
    {
      name: 'Error',
      message: /ElevenLabs API key is not configured/
    }
  );
});

test('ElevenLabs Voice: Validation rejects empty audio buffer', async () => {
  const service = new ElevenLabsVoiceService('sk_mock_key_for_validation_test_123');
  const emptyBuffer = Buffer.alloc(0);

  await assert.rejects(
    async () => {
      await service.transcribe(emptyBuffer, 'audio/webm');
    },
    {
      name: 'Error',
      message: /Empty audio payload/
    }
  );
});

test('ElevenLabs Voice: Validation rejects oversized audio buffer (>10MB)', async () => {
  const service = new ElevenLabsVoiceService('sk_mock_key_for_validation_test_123');
  // 11MB buffer
  const oversizedBuffer = Buffer.alloc(11 * 1024 * 1024);

  await assert.rejects(
    async () => {
      await service.transcribe(oversizedBuffer, 'audio/webm');
    },
    {
      name: 'Error',
      message: /exceeds maximum permitted size/
    }
  );
});

test('ElevenLabs Voice: Validation rejects empty text for synthesis', async () => {
  const service = new ElevenLabsVoiceService('sk_mock_key_for_validation_test_123');

  await assert.rejects(
    async () => {
      await service.synthesize('   ');
    },
    {
      name: 'Error',
      message: /Text to synthesize cannot be empty/
    }
  );
});

test('ElevenLabs Voice: Error mapper correctly maps 401, 402, and 429 status codes', () => {
  const service = new ElevenLabsVoiceService('sk_mock');

  // Test 401
  assert.throws(
    () => {
      (service as any).handleApiError(401, 'Unauthorized', 'transcription');
    },
    {
      name: 'Error',
      message: /Invalid or expired API key/
    }
  );

  // Test 402 / Quota
  assert.throws(
    () => {
      (service as any).handleApiError(402, '{"detail":{"status":"quota_exceeded"}}', 'text-to-speech');
    },
    {
      name: 'Error',
      message: /quota or tier limit exceeded/
    }
  );

  // Test 429 Rate limit
  assert.throws(
    () => {
      (service as any).handleApiError(429, 'Rate limit exceeded', 'transcription');
    },
    {
      name: 'Error',
      message: /rate limit reached/
    }
  );
});
