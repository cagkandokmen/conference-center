/**
 * bot.js — Lightweight IVR bot (TTS only, no AI/STT).
 */
require('dotenv').config();
const dgram = require('dgram');
const https = require('https');
const axiosBase = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { OpusEncoder } = require('@discordjs/opus');
const { buildRtp } = require('./rtp');
const IVR = require('./ivr');

const axios = axiosBase.create({
  httpsAgent: new https.Agent({  
    rejectUnauthorized: false
  })
});

const SIGNAL_URL = process.env.SIGNAL_SERVICE_URL || 'http://localhost:3001';

class Bot {
  constructor(roomId, onLeaveCallback) {
    this.roomId = roomId;
    this.botId = null;
    this._onLeaveCallback = onLeaveCallback;
    this._sendSocket = null;
    this._ivr = new IVR({
      onLeave: () => this.leave(),
      onSpeak: (text) => this.speakToRoom(text)
    });
    
    // For sending audio (48kHz mono Opus)
    this._encoder = new OpusEncoder(48000, 1);
    this._active = false;
    this._ssrc = Math.floor(Math.random() * 0xFFFFFFFF);
    this._sequenceNumber = 0;
    this._timestamp = 0;
    this._payloadType = 111;
  }

  async join() {
    console.log(`[Bot] Joining room ${this.roomId} (Lightweight mode)...`);

    try {
      const { data } = await axios.post(`${SIGNAL_URL}/api/bot/join`, {
        roomId: this.roomId,
      });

      this.botId = data.botId;
      const sendPort = data.sendTransport?.port;
      const remoteIp = data.sendTransport?.ip || '127.0.0.1';

      const opusCodec = data.rtpCapabilities.codecs.find(c => c.mimeType.toLowerCase() === 'audio/opus');
      this._payloadType = opusCodec ? opusCodec.preferredPayloadType : 111;
      const channels = opusCodec ? opusCodec.channels : 2;

      this._sendSocket = dgram.createSocket('udp4');
      this._sendSocket.bind(0, '127.0.0.1', async () => {
        const localSendPort = this._sendSocket.address().port;
        console.log(`[Bot] UDP send bound on 127.0.0.1:${localSendPort}`);
        await axios.post(`${SIGNAL_URL}/api/bot/connect-send`, {
          roomId: this.roomId, botId: this.botId, ip: '127.0.0.1', port: localSendPort
        });
        
        const { data: producerData } = await axios.post(`${SIGNAL_URL}/api/bot/produce`, {
          roomId: this.roomId,
          botId: this.botId,
          rtpParameters: {
            codecs: [{
              mimeType: 'audio/opus',
              payloadType: this._payloadType,
              clockRate: 48000,
              channels: channels,
            }],
            encodings: [{ ssrc: this._ssrc }]
          }
        });
        console.log(`[Bot] Audio producer created: ${producerData.producerId}`);
        this._remoteTarget = { ip: remoteIp, port: sendPort };
      });

      this._active = true;
      await this._ivr.onJoin();

    } catch (err) {
      console.error('[Bot] Join error:', err.message);
      this.leave();
    }
  }

  async speakToRoom(text) {
    if (!this._active || !this._remoteTarget) return;
    const tmpWav = path.join(__dirname, `../temp_tts_${this.botId}.wav`);
    const { speakToFile } = require('./tts');

    try {
      await speakToFile(text, tmpWav);
      const ffmpeg = spawn('ffmpeg', [
        '-i', tmpWav, '-f', 's16le', '-ar', '48000', '-ac', '1', 'pipe:1'
      ]);

      const CHUNK_SIZE = 960 * 2;
      let buffer = Buffer.alloc(0);

      ffmpeg.stdout.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= CHUNK_SIZE) {
          const pcm = buffer.subarray(0, CHUNK_SIZE);
          buffer = buffer.subarray(CHUNK_SIZE);
          const opus = this._encoder.encode(pcm);
          const packet = buildRtp({
            payloadType: this._payloadType,
            sequenceNumber: this._sequenceNumber++,
            timestamp: this._timestamp,
            ssrc: this._ssrc,
            payload: opus
          });
          this._timestamp += 960;
          this._sendSocket.send(packet, this._remoteTarget.port, this._remoteTarget.ip);
        }
      });

      await new Promise(resolve => ffmpeg.on('close', resolve));
      if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav);
    } catch (err) {
      console.error('[Bot] speakToRoom error:', err.message);
    }
  }

  async leave() {
    if (!this._active) return;
    this._active = false;
    console.log(`[Bot] Leaving room ${this.roomId}...`);
    this._sendSocket?.close();
    try {
      await axios.post(`${SIGNAL_URL}/api/bot/leave`, { roomId: this.roomId, botId: this.botId });
    } catch (err) {}
    if (this._onLeaveCallback) this._onLeaveCallback();
  }
}

module.exports = Bot;
