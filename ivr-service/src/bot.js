/**
 * bot.js — Robust & Simple IVR bot.
 */
require('dotenv').config();
const dgram = require('dgram');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const OpusScript = require('opusscript');
const { parseRtp, buildRtp } = require('./rtp');
const STT = require('./stt');
const IVR = require('./ivr');

// Internal signaling always uses localhost to avoid SSL/Public IP loops
const SIGNAL_URL = process.env.INTERNAL_SIGNAL_URL || 'http://localhost:3001';

class Bot {
  constructor(roomId, onLeaveCallback) {
    this.roomId = roomId;
    this.botId = null;
    this._onLeaveCallback = onLeaveCallback;
    this._active = false;
    this._leaving = false;

    // Sockets
    this._sendSocket = null;
    this._recvSocket = null;

    // Audio State
    this._encoder = new OpusScript(48000, 1, OpusScript.Application.AUDIO);
    this._ssrc = Math.floor(Math.random() * 0xFFFFFFFF);
    this._sequenceNumber = 0;
    this._timestamp = 0;
    this._payloadType = 101;

    // Components
    this._stt = new STT();
    this._ivr = new IVR({
      onLeave: () => this.leave(),
      onSpeak: (text) => this.speakToRoom(text)
    });
  }

  async join() {
    console.log(`[Bot] Joining room ${this.roomId}...`);

    try {
      // 1. Join Signaling
      const { data } = await axios.post(`${SIGNAL_URL}/api/bot/join`, { roomId: this.roomId });
      this.botId = data.botId;
      
      const remoteIp = '127.0.0.1';
      const sendPort = data.sendTransport.port;
      const recvPort = data.recvTransport.port;

      // 2. Match Codec
      const opusCodec = data.rtpCapabilities.codecs.find(c => c.mimeType.toLowerCase() === 'audio/opus');
      this._payloadType = opusCodec ? opusCodec.preferredPayloadType : 111;
      const channels = opusCodec ? opusCodec.channels : 2;

      // 3. Setup Sockets
      this._sendSocket = dgram.createSocket('udp4');
      this._recvSocket = dgram.createSocket('udp4');

      // 4. Connect Transports
      await new Promise(resolve => this._sendSocket.bind(0, '127.0.0.1', resolve));
      await axios.post(`${SIGNAL_URL}/api/bot/connect-send`, {
        roomId: this.roomId, botId: this.botId, ip: '127.0.0.1', port: this._sendSocket.address().port
      });

      await new Promise(resolve => this._recvSocket.bind(0, '127.0.0.1', resolve));
      await axios.post(`${SIGNAL_URL}/api/bot/connect-recv`, {
        roomId: this.roomId, botId: this.botId, ip: '127.0.0.1', port: this._recvSocket.address().port
      });

      // 5. Create Producer
      const { data: producerData } = await axios.post(`${SIGNAL_URL}/api/bot/produce`, {
        roomId: this.roomId,
        botId: this.botId,
        rtpParameters: {
          codecs: [{ mimeType: 'audio/opus', payloadType: this._payloadType, clockRate: 48000, channels }],
          encodings: [{ ssrc: this._ssrc }]
        }
      });
      console.log(`[Bot] Audio producer created: ${producerData.producerId}`);

      // 6. Start Receiving
      this._recvSocket.on('message', (buf) => {
        const rtp = parseRtp(buf);
        if (rtp && this._active) {
          try {
            const pcm = this._encoder.decode(rtp.payload);
            this._stt.feed(pcm);
          } catch (e) {}
        }
      });

      // 7. Setup STT
      await this._stt.init();
      this._stt.on('final', ({ text }) => this._ivr.onTranscript(text));

      this._remoteTarget = { ip: remoteIp, port: sendPort };
      this._active = true;
      
      await this._ivr.onJoin();
      console.log(`[Bot] ✅ Bot ${this.botId} ready in room ${this.roomId}`);

    } catch (err) {
      console.error('[Bot] Join failed:', err.message);
      this.leave();
    }
  }

  async speakToRoom(text) {
    if (!this._active || !this._remoteTarget) return;

    const tmpDir = path.resolve(__dirname, '../temp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const tmpWav = path.join(tmpDir, `tts_${this.botId}.wav`);
    
    const { speakToFile } = require('./tts');

    try {
      await speakToFile(text, tmpWav);
      // Use ffmpeg to convert to raw 48kHz PCM and pipe to our script
      const ffmpeg = spawn('ffmpeg', [
        '-i', tmpWav,
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '1',
        'pipe:1'
      ]);
      ffmpeg.on('error', err => console.error('[Bot] ffmpeg spawn error:', err));

      const CHUNK_SIZE = 960 * 2; // 20ms
      let buffer = Buffer.alloc(0);
      let lastSendTime = Date.now();

      try {
        // Use async iterator to properly throttle the stream
        for await (const chunk of ffmpeg.stdout) {
          if (!this._active) break;
          
          buffer = Buffer.concat([buffer, chunk]);
          while (buffer.length >= CHUNK_SIZE) {
            if (!this._active) break;

            const pcm = buffer.subarray(0, CHUNK_SIZE);
            buffer = buffer.subarray(CHUNK_SIZE);
            
            try {
              const pcmCopy = Buffer.from(pcm);
              const opus = this._encoder.encode(pcmCopy, 960);
              const packet = buildRtp({
                payloadType: this._payloadType,
                sequenceNumber: this._sequenceNumber++,
                timestamp: this._timestamp,
                ssrc: this._ssrc,
                payload: opus
              });
              this._timestamp += 960;
              if (this._sendSocket) {
                this._sendSocket.send(packet, this._remoteTarget.port, this._remoteTarget.ip);
              }
            } catch (e) {
              console.error('[Bot] Encode/Send error:', e.message);
            }

            // PACE THE AUDIO: Wait 20ms before sending the next 20ms chunk
            const now = Date.now();
            const delta = now - lastSendTime;
            if (delta > 30) {
              console.warn(`[Bot] ⚠️ Timing Jitter: ${delta}ms (Expected 20ms)`);
            }
            lastSendTime = now;

            await new Promise(resolve => setTimeout(resolve, 20));
          }
        }
      } catch (streamErr) {
        console.error('[Bot] Stream error:', streamErr.message);
      }

      await new Promise(resolve => {
        if (ffmpeg.killed || ffmpeg.exitCode !== null) resolve();
        else ffmpeg.on('close', resolve);
      });
      if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav);

    } catch (err) {
      console.error('[Bot] speakToRoom error:', err.message);
    }
  }

  async leave() {
    if (this._leaving) return;
    this._leaving = true;
    this._active = false;
    
    console.log(`[Bot] Leaving room ${this.roomId}...`);

    try {
      this._sendSocket?.close();
      this._recvSocket?.close();
      this._stt.close();
      await axios.post(`${SIGNAL_URL}/api/bot/leave`, { roomId: this.roomId, botId: this.botId });
    } catch (err) {}

    if (this._onLeaveCallback) this._onLeaveCallback();
  }
}

module.exports = Bot;
