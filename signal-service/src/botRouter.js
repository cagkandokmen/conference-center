/**
 * botRouter.js — Internal HTTP API for the IVR bot.
 *
 * Exposes:
 *   POST /api/bot/join  { roomId } → creates PlainTransport pair for the bot
 *   POST /api/bot/leave { roomId, botId } → cleans up bot resources
 *
 * PlainTransport sends/receives raw RTP (no ICE/DTLS) on localhost only.
 * The IVR service calls this API then opens UDP sockets on the returned ports.
 */
const { Router } = require('express');
const Peer = require('./Peer');

const router = Router();

/** @type {Map<string, Room>} rooms reference — injected via setup() */
let _rooms = null;
let _getOrCreateRoom = null;
let _io = null;

/**
 * @param {Map<string, Room>} rooms
 * @param {Function} getOrCreateRoom
 * @param {import('socket.io').Server} io
 */
function setupBotRouter(rooms, getOrCreateRoom, io) {
  _rooms = rooms;
  _getOrCreateRoom = getOrCreateRoom;
  _io = io;
  return router;
}

// ── POST /api/bot/join ────────────────────────────────────────────────────
router.post('/join', async (req, res) => {
  try {
    const { roomId } = req.body;
    if (!roomId) return res.status(400).json({ error: 'roomId required' });

    const room = await _getOrCreateRoom(roomId);
    const botId = `bot-${Date.now()}`;

    // Create a bot Peer object
    const botPeer = new Peer({ socketId: botId, displayName: 'IVR Bot' });
    room.peers.set(botId, botPeer);
    console.log(`[Bot] Joined room ${roomId} as ${botId}`);

    // Notify connected clients that the bot joined
    if (_io) {
      _io.to(roomId).emit('peerJoined', {
        peerId: botId,
        displayName: 'IVR Bot',
      });
    }

    // ── Recv PlainTransport (mediasoup → IVR: bot hears participants) ──────
    const recvTransport = await room.router.createPlainTransport({
      listenIp: { ip: process.env.MEDIASOUP_LISTEN_IP || '127.0.0.1', announcedIp: null },
      portRange: { min: 40000, max: 49999 },
      rtcpMux: true,
      comedia: false,
      appData: { direction: 'recv', botId },
    });

    // ── Send PlainTransport (IVR → mediasoup: bot speaks) ─────────────────
    const sendTransport = await room.router.createPlainTransport({
      listenIp: { ip: process.env.MEDIASOUP_LISTEN_IP || '127.0.0.1', announcedIp: null },
      portRange: { min: 40000, max: 49999 },
      rtcpMux: true,
      comedia: false,
      appData: { direction: 'send', botId },
    });

    botPeer.addTransport(recvTransport);
    botPeer.addTransport(sendTransport);

    // Store router RTP capabilities on the bot peer so createConsumer works
    botPeer._rtpCapabilities = room.router.rtpCapabilities;

    // ── Create consumers for all existing audio producers ─────────────────
    const consumers = [];
    for (const [peerId, peer] of room.peers) {
      if (peerId === botId) continue;
      for (const producer of peer.producers.values()) {
        if (producer.kind !== 'audio') continue;
        try {
          const consumer = await recvTransport.consume({
            producerId: producer.id,
            rtpCapabilities: room.router.rtpCapabilities,
            paused: false,
          });
          botPeer.addConsumer(consumer);
          consumer.on('transportclose', () => botPeer.removeConsumer(consumer.id));
          consumer.on('producerclose', () => botPeer.removeConsumer(consumer.id));
          consumers.push({
            consumerId: consumer.id,
            producerId: producer.id,
            peerId,
            rtpParameters: consumer.rtpParameters,
          });
          console.log(`[Bot] Consuming audio from peer ${peerId}, consumer ${consumer.id}`);
        } catch (err) {
          console.error(`[Bot] Cannot consume from ${peerId}: ${err.message}`);
        }
      }
    }


    // Return everything the IVR service needs
    res.json({
      botId,
      roomId,
      rtpCapabilities: room.router.rtpCapabilities,
      recvTransport: {
        id: recvTransport.id,
        ip: recvTransport.tuple?.localIp || '127.0.0.1',
        port: recvTransport.tuple?.localPort,
      },
      sendTransport: {
        id: sendTransport.id,
        ip: sendTransport.tuple?.localIp || '127.0.0.1',
        port: sendTransport.tuple?.localPort,
      },
      consumers,
    });
  } catch (err) {
    console.error('[Bot] join error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bot/leave ───────────────────────────────────────────────────
router.post('/leave', (req, res) => {
  try {
    const { roomId, botId } = req.body;
    const room = _rooms?.get(roomId);
    if (!room) {
      // Room already destroyed, which means bot is evicted anyway. Return 200 OK.
      return res.json({ ok: true });
    }

    const peer = room.getPeer(botId);
    if (peer) {
      peer.close();
      room.peers.delete(botId);
      console.log(`[Bot] Left room ${roomId} (${botId})`);

      // Notify connected clients that the bot left
      if (_io) {
        _io.to(roomId).emit('peerLeft', {
          peerId: botId,
          displayName: 'IVR Bot',
        });
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bot/connect-recv ───────────────────────────────────────────
// Called by IVR after it binds its recv UDP socket, so mediasoup knows
// where to send the RTP packets.
router.post('/connect-recv', async (req, res) => {
  try {
    const { roomId, botId, ip, port } = req.body;
    const room = _rooms?.get(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const botPeer = room.getPeer(botId);
    if (!botPeer) return res.status(404).json({ error: 'Bot peer not found' });

    for (const transport of botPeer.transports.values()) {
      if (transport.appData?.direction === 'recv') {
        await transport.connect({ ip, port });
        console.log(`[Bot] Recv transport connected to ${ip}:${port}`);
        break;
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bot/connect-send ────────────────────────────────────────────
// Called by IVR after it knows its local UDP port, so mediasoup knows
// where to send RTP back.
router.post('/connect-send', async (req, res) => {
  try {
    const { roomId, botId, ip, port } = req.body;
    const room = _rooms?.get(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const botPeer = room.getPeer(botId);
    if (!botPeer) return res.status(404).json({ error: 'Bot peer not found' });

    // Find the send transport
    for (const transport of botPeer.transports.values()) {
      if (transport.appData?.direction === 'send') {
        await transport.connect({ ip, port });
        console.log(`[Bot] Send transport connected to ${ip}:${port}`);
        break;
      }
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/bot/produce ─────────────────────────────────────────────────
// Creates an audio producer on the bot's send transport so participants
// can hear the IVR. Called after IVR has connected its send UDP socket.
router.post('/produce', async (req, res) => {
  try {
    const { roomId, botId, rtpParameters } = req.body;
    const room = _rooms?.get(roomId);
    if (!room) return res.status(404).json({ error: 'Room not found' });

    const botPeer = room.getPeer(botId);
    if (!botPeer) return res.status(404).json({ error: 'Bot peer not found' });

    let sendTransport = null;
    for (const transport of botPeer.transports.values()) {
      if (transport.appData?.direction === 'send') {
        sendTransport = transport;
        break;
      }
    }
    if (!sendTransport) return res.status(404).json({ error: 'Send transport not found' });

    const producer = await sendTransport.produce({
      kind: 'audio',
      rtpParameters,
    });

    botPeer.addProducer(producer);
    producer.on('transportclose', () => botPeer.removeProducer(producer.id));

    console.log(`[Bot] Producer created: ${producer.id} in room ${roomId}`);
    
    // Notify connected clients that the bot has a new audio producer
    if (_io) {
      _io.to(roomId).emit('newProducer', {
        producerId: producer.id,
        producerPeerId: botId,
        kind: producer.kind
      });
    }

    res.json({ producerId: producer.id });
  } catch (err) {
    console.error('[Bot] produce error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { setupBotRouter };
