/**
 * ElevenLabs Voice Services: Speech-to-Text (STT) & Text-to-Speech (TTS)
 *
 * Implements real ElevenLabs API integration for the PULSE AI Assistant:
 * - STT: Scribe v1 multilingual automatic speech recognition (`POST /v1/speech-to-text`)
 * - TTS: Eleven Multilingual v2 high-fidelity voice synthesis (`POST /v1/text-to-speech/{voice_id}`)
 * - Language support: English and Hindi
 * - Server-only API key handling, strict audio size/format validation, timeouts, and quota exhaustion detection
 */

export interface TranscriptionResult {
  text: string;
  language_code?: string;
  duration_secs?: number;
}

export interface SynthesisResult {
  audioBuffer: Buffer;
  contentType: string;
}

export interface VoiceConfigStatus {
  isConfigured: boolean;
  modelStt: string;
  modelTts: string;
  defaultVoiceId: string;
  supportedLanguages: Array<{ code: string; label: string }>;
}

const DEFAULT_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Rachel
const STT_MODEL_ID = 'scribe_v1';
const TTS_MODEL_ID = 'eleven_multilingual_v2';
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10MB max audio payload
const REQUEST_TIMEOUT_MS = 25000;

export class ElevenLabsVoiceService {
  private apiKey: string;
  private voiceId: string;

  constructor(apiKey?: string, voiceId?: string) {
    this.apiKey = (apiKey || process.env.ELEVENLABS_API_KEY || '').trim();
    this.voiceId = (voiceId || process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE_ID).trim();
  }

  public isConfigured(): boolean {
    return Boolean(this.apiKey && this.apiKey.length > 5);
  }

  public getConfigStatus(): VoiceConfigStatus {
    return {
      isConfigured: this.isConfigured(),
      modelStt: STT_MODEL_ID,
      modelTts: TTS_MODEL_ID,
      defaultVoiceId: this.voiceId,
      supportedLanguages: [
        { code: 'en', label: 'English' },
        { code: 'hi', label: 'Hindi' },
        { code: 'auto', label: 'Auto Detect' }
      ]
    };
  }

  /**
   * Transcribe speech audio buffer into text using ElevenLabs Scribe v1
   */
  public async transcribe(
    audioBuffer: Buffer,
    mimeType = 'audio/webm',
    languageCode?: string
  ): Promise<TranscriptionResult> {
    if (!this.isConfigured()) {
      throw new Error('ElevenLabs API key is not configured. Please set ELEVENLABS_API_KEY in your server environment.');
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error('Empty audio payload received for transcription.');
    }

    if (audioBuffer.length > MAX_AUDIO_BYTES) {
      throw new Error(`Audio payload exceeds maximum permitted size of ${MAX_AUDIO_BYTES / (1024 * 1024)}MB.`);
    }

    // Determine filename extension based on mimeType
    const ext = mimeType.includes('wav')
      ? 'wav'
      : mimeType.includes('mp3') || mimeType.includes('mpeg')
      ? 'mp3'
      : mimeType.includes('ogg')
      ? 'ogg'
      : mimeType.includes('mp4') || mimeType.includes('m4a')
      ? 'm4a'
      : 'webm';

    // Construct FormData with native Blob in Node 18+
    const formData = new FormData();
    const audioBlob = new Blob([audioBuffer], { type: mimeType });
    formData.append('file', audioBlob, `speech_input.${ext}`);
    formData.append('model_id', STT_MODEL_ID);

    if (languageCode && languageCode !== 'auto') {
      // Map ISO 639-1 to standard codes accepted by Scribe (hin for Hindi, eng for English)
      const normalizedLang = languageCode === 'hi' ? 'hin' : languageCode === 'en' ? 'eng' : languageCode;
      formData.append('language_code', normalizedLang);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey
        },
        body: formData,
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.handleApiError(response.status, errorText, 'speech-to-text');
      }

      const data = await response.json() as any;
      const transcript = (data.text || '').trim();

      if (!transcript) {
        return {
          text: '',
          language_code: data.language_code || languageCode
        };
      }

      return {
        text: transcript,
        language_code: data.language_code || languageCode,
        duration_secs: data.audio_duration
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('ElevenLabs transcription request timed out after 25 seconds.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Convert text into natural spoken audio using ElevenLabs Multilingual v2
   */
  public async synthesize(
    text: string,
    customVoiceId?: string
  ): Promise<SynthesisResult> {
    if (!this.isConfigured()) {
      throw new Error('ElevenLabs API key is not configured. Please set ELEVENLABS_API_KEY in your server environment.');
    }

    const cleanText = (text || '').trim();
    if (!cleanText) {
      throw new Error('Text to synthesize cannot be empty.');
    }

    // Limit text length to prevent unexpected character usage (max 4000 characters per TTS request)
    const truncatedText = cleanText.length > 4000 ? cleanText.slice(0, 4000) + '...' : cleanText;

    const targetVoiceId = (customVoiceId || this.voiceId).trim();
    const url = `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(targetVoiceId)}?output_format=mp3_44100_128`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'xi-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text: truncatedText,
          model_id: TTS_MODEL_ID,
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.0,
            use_speaker_boost: true
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.handleApiError(response.status, errorText, 'text-to-speech');
      }

      const arrayBuffer = await response.arrayBuffer();
      return {
        audioBuffer: Buffer.from(arrayBuffer),
        contentType: 'audio/mpeg'
      };
    } catch (err: any) {
      if (err.name === 'AbortError') {
        throw new Error('ElevenLabs text-to-speech request timed out after 25 seconds.');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Centralized ElevenLabs API error mapper
   */
  private handleApiError(status: number, rawError: string, operation: string): never {
    let message = `ElevenLabs ${operation} error (${status})`;
    try {
      const parsed = JSON.parse(rawError);
      if (parsed.detail?.message) {
        message = parsed.detail.message;
      } else if (parsed.detail?.status) {
        message = parsed.detail.status;
      } else if (typeof parsed.detail === 'string') {
        message = parsed.detail;
      } else if (parsed.message) {
        message = parsed.message;
      }
    } catch {
      if (rawError && rawError.length < 200) {
        message = rawError;
      }
    }

    if (status === 401) {
      throw new Error(`ElevenLabs authentication failed: Invalid or expired API key.`);
    }

    if (status === 402 || rawError.toLowerCase().includes('quota') || rawError.toLowerCase().includes('credit') || rawError.toLowerCase().includes('character')) {
      throw new Error(`ElevenLabs quota or tier limit exceeded. Free characters allowance exhausted.`);
    }

    if (status === 429) {
      throw new Error(`ElevenLabs rate limit reached. Please wait a moment and try again.`);
    }

    throw new Error(`ElevenLabs ${operation} failed (${status}): ${message}`);
  }
}

export const defaultVoiceService = new ElevenLabsVoiceService();
