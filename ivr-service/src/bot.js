/**
 * bot.js — Manages the IVR bot lifecycle for a single room.
 */
require('dotenv').config();
const dgram = require('dgram');
const https = require('https');
const axiosBase = require('axios');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { OpusEncoder } = require('@discordjs/opus');
const { parseRtp, buildRtp } = require('./rtp');
const STT = require('./stt');
const IVR = require('./ivr');

// Configure axios to ignore SSL errors for local signaling (since we are on the same server)
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
    this._recvSocket = null;
    this._sendSocket = null;
    this._stt = new STT();
    this._ivr = new IVR({
      onLeave: () => this.leave(),
      onSpeak: (text) => this.speakToRoom(text)
    });
    // Mediasoup uses 48kHz 1-channel Opus
    this._encoder = new OpusEncoder(48000, 1);
    this._active = false;
    
    // RTP state for sending
    this._ssrc = Math.floor(Math.random() * 0xFFFFFFFF);
    this._sequenceNumber = 0;
    this._timestamp = 0;
  }

  async join() {
    console.log(`[Bot] Joining room ${this.roomId}...`);

    try {
      // 1. Ask signal-service to create PlainTransport pair
      const { data } = await axios.post(`${SIGNAL_URL}/api/bot/join`, {
        roomId: this.roomId,
      });

      this.botId = data.botId;
      const recvPort = data.recvTransport?.port;
      const sendPort = data.sendTransport?.port;
      const remoteIp = data.sendTransport?.ip || '127.0.0.1';

      console.log(`[Bot] Bot ID: ${this.botId}`);
      console.log(`[Bot] Recv port: ${recvPort}, Send port: ${sendPort}`);

      // 2. Init STT
      await this._stt.init();

      // 3. Setup IVR events
      this._stt.on('final', async ({ text }) => {
        if (this._active) await this._ivr.onTranscript(text);
      });

      this._stt.on('partial', ({ text }) => {
        if (text) process.stdout.write(`\r[STT partial] ${text}   `);
      });

      // 4. Setup UDP sockets
      this._recvSocket = dgram.createSocket('udp4');
      this._sendSocket = dgram.createSocket('udp4');

      // Bind RECV socket
      this._recvSocket.bind(0, '127.0.0.1', async () => {
        const localRecvPort = this._recvSocket.address().port;
        console.log(`[Bot] UDP recv bound on 127.0.0.1:${localRecvPort}`);
        await axios.post(`${SIGNAL_URL}/api/bot/connect-recv`, {
          roomId: this.roomId, botId: this.botId, ip: '127.0.0.1', port: localRecvPort
        }).then(() => console.log(`[Bot] Recv transport connected successfully`));
      });

      // Bind SEND socket
      this._sendSocket.bind(0, '127.0.0.1', async () => {
        const localSendPort = this._sendSocket.address().port;
        console.log(`[Bot] UDP send bound on 127.0.0.1:${localSendPort}`);
        await axios.post(`${SIGNAL_URL}/api/bot/connect-send`, {
          roomId: this.roomId, botId: this.botId, ip: '127.0.0.1', port: localSendPort
        }).then(() => console.log(`[Bot] Send transport connected successfully`));
        
        // 5. Create audio producer so participants can hear the bot
        const { data: producerData } = await axios.post(`${SIGNAL_URL}/api/bot/produce`, {
          roomId: this.roomId,
          botId: this.botId,
          rtpParameters: {
            codecs: [{
              mimeType: 'audio/opus',
              payloadType: 111,
              clockRate: 48000,
              channels: 1,
            }],
            encodings: [{ ssrc: this._ssrc }]
          }
        });
        console.log(`[Bot] Audio producer created: ${producerData.producerId}`);
        
        // Store remote mediasoup target for our outgoing RTP
        this._remoteTarget = { ip: remoteIp, port: sendPort };
      });

      // Handle incoming audio
      this._recvSocket.on('message', (msg) => {
        const rtp = parseRtp(msg);
        if (!rtp) return;
        try {
          const pcm = this._encoder.decode(rtp.payload);
          if (this._ivr.isListening) this._stt.feed(pcm);
          else this._stt.reset();
        } catch (err) {}
      });

      this._active = true;
      await this._ivr.onJoin();

    } catch (err) {
      console.error('[Bot] Join error:', err.message);
      this.leave();
    }
  }

  /**
   * Encodes and sends PCM audio into the room as RTP packets.
   */
  async speakToRoom(text) {
    if (!this._active || !this._remoteTarget) return;

    const tmpWav = path.join(__dirname, `../temp_tts_${this.botId}.wav`);
    const { speakToFile } = require('./tts');

    try {
      await speakToFile(text, tmpWav);
      
      // Use ffmpeg to stream the WAV as raw PCM to stdout
      const ffmpeg = spawn('ffmpeg', [
        '-i', tmpWav,
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '1',
        'pipe:1'
      ]);

      const CHUNK_SIZE = 960 * 2; // 20ms of 48kHz 16-bit mono PCM (960 samples * 2 bytes)
      let buffer = Buffer.alloc(0);

      ffmpeg.stdout.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (buffer.length >= CHUNK_SIZE) {
          const pcm = buffer.subarray(0, CHUNK_SIZE);
          buffer = buffer.subarray(CHUNK_SIZE);
          
          // Encode PCM to Opus
          const opus = this._encoder.encode(pcm);
          
          // Build RTP packet
          const packet = buildRtp({
            payloadType: 111, // Opus
            sequenceNumber: this._sequenceNumber++,
            timestamp: this._timestamp,
            ssrc: this._ssrc,
            payload: opus
          });

          this._timestamp += 960; // 20ms at 48kHz
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
    this._recvSocket?.close();
    this._sendSocket?.close();
    this._stt.close();
    try {
      await axios.post(`${SIGNAL_URL}/api/bot/leave`, { roomId: this.roomId, botId: this.botId });
    } catch (err) {}
    if (this._onLeaveCallback) this._onLeaveCallback();
  }
}

module.exports = Bot;
