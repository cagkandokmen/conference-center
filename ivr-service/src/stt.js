/**
 * stt.js — Pure JavaScript Speech-to-Text using Transformers.js (Whisper)
 *
 * Runs locally on CPU without native C++ compilation.
 */
const { EventEmitter } = require('events');

// Load Transformers.js dynamically (it's ESM/CJS compatible but sometimes prefers dynamic import)
let pipeline = null;
let env = null;

class STT extends EventEmitter {
  constructor() {
    super();
    this._transcriber = null;
    this._ready = false;
    
    // Audio buffering state
    this._audioBuffer = []; // Array of Float32Arrays
    this._bufferLength = 0;
    
    // Simple VAD state
    this._isSpeaking = false;
    this._silenceFrames = 0;
    this._speechFrames = 0;
    
    // Config
    this.SILENCE_THRESHOLD = 0.01; // RMS volume threshold
    this.MAX_SILENCE_FRAMES = 50;  // Flush after ~1 second of silence
    this.MIN_SPEECH_FRAMES = 10;   // Ignore tiny blips
    
    this._isTranscribing = false;
  }

  async init() {
    try {
      // Import transformers
      const transformers = await import('@xenova/transformers');
      pipeline = transformers.pipeline;
      env = transformers.env;

      // Configure caching to app directory so it doesn't pollute user directory
      env.cacheDir = './.cache';

      console.log(`[STT] Downloading/loading Whisper Tiny model... (This takes a moment)`);
      
      this._transcriber = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
        quantized: true // Use quantized weights for smaller size & faster CPU inference
      });

      this._ready = true;
      console.log(`[STT] ✅ Transformers.js Whisper loaded & ready.`);
    } catch (err) {
      console.error(`[STT] ❌ Failed to load Transformers.js:`, err);
    }
  }

  /**
   * Resamples 48kHz 16-bit PCM to 16kHz 32-bit Float
   * @param {Buffer} pcmBuffer 
   * @returns {Float32Array}
   */
  _downsample(pcmBuffer) {
    const samples = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
    const out = new Float32Array(Math.floor(samples.length / 3));
    
    let sumSquares = 0;
    
    for (let i = 0, j = 0; i < samples.length - 2; i += 3, j++) {
      const floatVal = samples[i] / 32768.0;
      out[j] = floatVal;
      sumSquares += floatVal * floatVal;
    }
    
    const rms = Math.sqrt(sumSquares / out.length);
    return { audio: out, rms };
  }

  /**
   * Feed a chunk of 48kHz 16-bit mono PCM.
   * @param {Buffer} pcmChunk
   */
  feed(pcmChunk) {
    if (!this._ready || this._isTranscribing) return;

    const { audio, rms } = this._downsample(pcmChunk);
    
    // Debug logging every 100 frames
    if (!this._feedCount) this._feedCount = 0;
    this._feedCount++;
    if (this._feedCount % 100 === 0) {
      console.log(`[STT DEBUG] Audio volume (RMS): ${rms.toFixed(5)} | Threshold: ${this.SILENCE_THRESHOLD}`);
    }
    
    const hasVoice = rms > this.SILENCE_THRESHOLD;

    if (hasVoice) {
      if (!this._isSpeaking) console.log('[STT] 🗣️ Voice detected, buffering...');
      this._isSpeaking = true;
      this._speechFrames++;
      this._silenceFrames = 0;
      this._audioBuffer.push(audio);
      this._bufferLength += audio.length;
    } else if (this._isSpeaking) {
      this._silenceFrames++;
      this._audioBuffer.push(audio);
      this._bufferLength += audio.length;

      // If we've had enough silence, flush the buffer to Whisper
      if (this._silenceFrames > this.MAX_SILENCE_FRAMES) {
        if (this._speechFrames > this.MIN_SPEECH_FRAMES) {
          console.log(`[STT] 🤫 Silence detected after speech. Flushing to Whisper...`);
          this._flushBuffer();
        } else {
          // False alarm (e.g. mic bump)
          console.log(`[STT] 🗑️ False alarm (too short). Discarding buffer.`);
          this.reset();
        }
      }
    }
  }

  async _flushBuffer() {
    this._isTranscribing = true;
    
    // Concatenate all buffered audio chunks into one contiguous array
    const mergedAudio = new Float32Array(this._bufferLength);
    let offset = 0;
    for (const chunk of this._audioBuffer) {
      mergedAudio.set(chunk, offset);
      offset += chunk.length;
    }
    
    this.reset();

    try {
      console.log(`[STT] Transcribing ${Math.round(mergedAudio.length / 16000)} seconds of audio...`);
      const output = await this._transcriber(mergedAudio);
      
      let text = output?.text?.trim();
      if (text) {
        // Whisper sometimes hallucinates these tokens for background noise
        text = text.replace(/\[BLANK_AUDIO\]/gi, '')
                   .replace(/\[SILENCE\]/gi, '')
                   .trim();

        // Ignore if the text is just random punctuation or very short noise (e.g. "kiss.", "-", ".")
        const alphanumeric = text.replace(/[^a-zA-Z0-9]/g, '');
        if (alphanumeric.length < 2) {
          console.log(`[STT] 🗑️ Ignoring garbage/blank transcript: "${output.text.trim()}"`);
          this.emit('garbage');
          return;
        }

        console.log(`[STT] Final: "${text}"`);
        this.emit('final', { text });
      }
    } catch (err) {
      console.error(`[STT] Transcription error:`, err.message);
    } finally {
      this._isTranscribing = false;
    }
  }

  reset() {
    this._audioBuffer = [];
    this._bufferLength = 0;
    this._isSpeaking = false;
    this._silenceFrames = 0;
    this._speechFrames = 0;
  }

  close() {
    this._ready = false;
    this._transcriber = null;
  }
}

module.exports = STT;
