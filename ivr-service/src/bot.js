/**
 * bot.js — Manages the IVR bot lifecycle for a single room.
 *
 * Flow:
 *  1. Call signal-service POST /api/bot/join → get PlainTransport params
 *  2. Open UDP recv socket → receives RTP (Opus) from mediasoup
 *  3. Parse RTP → extract Opus payload
 *  4. [Future] Decode Opus → PCM → feed to STT
 *  5. IVR logic processes STT transcript
 *  6. TTS speaks response (via system say command)
 *
 * Note: Opus decoding to PCM (for Vosk) requires @discordjs/opus native binding.
 * In phase 1, TTS plays locally via system speakers.
 * In phase 2, TTS audio will be encoded and sent back into the room via RTP.
 */
require('dotenv').config();
const dgram = require('dgram');
const axios = require('axios');
const { OpusEncoder } = require('@discordjs/opus');
const { parseRtp } = require('./rtp');
const STT = require('./stt');
const IVR = require('./ivr');

const SIGNAL_URL = process.env.SIGNAL_SERVICE_URL || 'http://localhost:3001';

class Bot {
  constructor(roomId, onLeaveCallback) {
    this.roomId = roomId;
    this.botId = null;
    this._onLeaveCallback = onLeaveCallback;
    this._recvSocket = null;
    this._stt = new STT();
    this._ivr = new IVR({
      onLeave: () => this.leave(),
    });
    // Mediasoup uses 48kHz 1-channel Opus
    this._decoder = new OpusEncoder(48000, 1);
    this._active = false;
  }

  async join() {
    console.log(`[Bot] Joining room ${this.roomId}...`);

    // 1. Ask signal-service to create PlainTransport pair
    const { data } = await axios.post(`${SIGNAL_URL}/api/bot/join`, {
      roomId: this.roomId,
    });

    this.botId = data.botId;
    const recvPort = data.recvTransport?.port;
    const recvIp = data.recvTransport?.ip || '127.0.0.1';

    console.log(`[Bot] Bot ID: ${this.botId}`);
    console.log(`[Bot] Recv transport: ${recvIp}:${recvPort}`);
    console.log(`[Bot] Consumers created: ${data.consumers?.length || 0}`);

    // 2. Init STT
    await this._stt.init();

    // 3. Listen for STT final results → pass to IVR
    this._stt.on('final', async ({ text }) => {
      try {
        await this._ivr.onTranscript(text);
      } catch (err) {
        console.error('[Bot] IVR error:', err.message);
      }
    });

    this._stt.on('garbage', async () => {
      try {
        await this._ivr.onGarbage();
      } catch (err) {
        console.error('[Bot] IVR error:', err.message);
      }
    });

    this._stt.on('partial', ({ text }) => {
      if (text) process.stdout.write(`\r[STT partial] ${text}   `);
    });

    // 4. Open UDP socket to receive RTP from mediasoup PlainTransport
    if (recvPort) {
      this._recvSocket = dgram.createSocket('udp4');
      // Bind to port 0 (OS will assign a random free port)
      this._recvSocket.bind(0, '127.0.0.1', async () => {
        const localPort = this._recvSocket.address().port;
        console.log(`[Bot] UDP recv socket bound on 127.0.0.1:${localPort}`);

        // Tell mediasoup to send RTP packets to our local port
        try {
          await axios.post(`${SIGNAL_URL}/api/bot/connect-recv`, {
            roomId: this.roomId,
            botId: this.botId,
            ip: '127.0.0.1',
            port: localPort
          });
        } catch (err) {
          console.error('[Bot] Failed to connect recv transport:', err.message);
        }
      });

      this._recvSocket.on('message', (msg) => {
        const rtp = parseRtp(msg);
        if (!rtp) return;

        try {
          // Decode Opus payload into raw 48kHz 16-bit PCM Buffer
          const pcm = this._decoder.decode(rtp.payload);
          // Feed to Whisper STT ONLY if the bot is listening
          if (this._ivr.isListening) {
            this._stt.feed(pcm);
          } else {
            // Clear buffer to prevent transcribing the bot's own echo
            this._stt.reset();
          }
        } catch (err) {
          // Log decoder errors periodically to avoid spam
          if (!this._errCount) this._errCount = 0;
          this._errCount++;
          if (this._errCount % 100 === 0) {
            console.error(`[Bot] Opus decode error: ${err.message}`);
          }
        }

        if (!this._pktCount) this._pktCount = 0;
        this._pktCount++;
        if (this._pktCount % 500 === 0) {
          console.log(`[Bot] Received ${this._pktCount} RTP packets`);
        }
      });

      this._recvSocket.on('error', (err) => {
        console.error('[Bot] UDP error:', err.message);
      });
    }

    this._active = true;

    // 5. IVR greets the room
    await this._ivr.onJoin();

    if (this._active) {
      console.log(`[Bot] ✅ Active in room ${this.roomId}`);
    }
  }

  async leave() {
    if (!this._active) return;
    this._active = false;
    console.log(`[Bot] Leaving room ${this.roomId}...`);

    this._recvSocket?.close();
    this._stt.close();

    try {
      await axios.post(`${SIGNAL_URL}/api/bot/leave`, {
        roomId: this.roomId,
        botId: this.botId,
      });
    } catch (err) {
      console.error('[Bot] Leave API error:', err.message);
    }

    console.log(`[Bot] Left room ${this.roomId}`);
    if (this._onLeaveCallback) this._onLeaveCallback();
  }

  get isActive() {
    return this._active;
  }
}

module.exports = Bot;
