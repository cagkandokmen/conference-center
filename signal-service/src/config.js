/**
 * Mediasoup SFU — Server Configuration
 */
const os = require('os');

module.exports = {
  // ─── HTTP / HTTPS ────────────────────────────────────────────────────────
  // Dev:  3001  (Vite proxies /socket.io here)
  // Prod: 443   (HTTPS, same port serves React + signaling)
  //       80    (HTTP, redirect to 443 — handled outside Node or via env)
  listenPort: process.env.PORT || (process.env.NODE_ENV === 'production' ? 443 : 3001),
  listenIp: '0.0.0.0',

  // ─── mediasoup Workers ───────────────────────────────────────────────────
  numWorkers: Object.keys(os.cpus()).length,

  // ─── mediasoup Router ────────────────────────────────────────────────────
  routerOptions: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
        preferredPayloadType: 101,
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video',
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters: {
          'profile-id': 2,
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video',
        mimeType: 'video/h264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '4d0032',
          'level-asymmetry-allowed': 1,
          'x-google-start-bitrate': 1000,
        },
      },
    ],
  },

  // ─── WebRTC Transport ────────────────────────────────────────────────────
  webRtcTransportOptions: {
    listenInfos: [
      {
        protocol: 'udp',
        ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
        announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
        portRange: { min: 40000, max: 49999 },
      },
      {
        protocol: 'tcp',
        ip: process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0',
        announcedAddress: process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1',
        portRange: { min: 40000, max: 49999 },
      },
    ],
    initialAvailableOutgoingBitrate: 1_000_000,
    minimumAvailableOutgoingBitrate: 600_000,
    maxSctpMessageSize: 262144,
    maxIncomingBitrate: 1_500_000,
  },
};
