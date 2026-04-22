/**
 * signaling.js — Socket.IO event handlers for the SFU.
 *
 * Flow:
 *   1. joinRoom           → create/get Room, create Peer
 *   2. getRtpCapabilities → return router RTP caps
 *   3. createWebRtcTransport (send + recv) → return transport params
 *   4. connectTransport   → DTLS handshake
 *   5. produce            → start producing, notify others
 *   6. consume            → consume existing producers
 *   7. resumeConsumer     → unpause consumer
 *   8. disconnect         → cleanup, notify others
 */
const Room = require('./Room');

/** @type {Map<string, Room>} */
const rooms = new Map();

/** Round-robin index for worker selection */
let workerIdx = 0;

/**
 * @param {import('socket.io').Server} io
 * @param {import('mediasoup').types.Worker[]} workers
 */
function setupSignaling(io, workers) {
  function getNextWorker() {
    const worker = workers[workerIdx];
    workerIdx = (workerIdx + 1) % workers.length;
    return worker;
  }

  async function getOrCreateRoom(roomId) {
    if (rooms.has(roomId)) return rooms.get(roomId);
    const room = new Room(roomId, getNextWorker());
    await room.init();
    rooms.set(roomId, room);
    return room;
  }

  io.on('connection', (socket) => {
    console.log(`[Socket] Connected: ${socket.id}`);

    /** Convenience: reply with error */
    const replyError = (cb, msg) => {
      console.error(`[Socket ${socket.id}] Error: ${msg}`);
      if (typeof cb === 'function') cb({ error: msg });
    };

    // ── joinRoom ──────────────────────────────────────────────────────────
    socket.on('joinRoom', async ({ roomId, displayName }, cb) => {
      try {
        const room = await getOrCreateRoom(roomId);
        const peer = room.createPeer(socket.id, displayName);

        // Store room reference on socket for easy access
        socket.roomId = roomId;

        socket.join(roomId);

        // Tell the new peer about everyone already in the room
        const existingPeers = room.getPeersExcept(socket.id);

        console.log(
          `[joinRoom] roomId=${roomId} peerId=${socket.id} displayName=${displayName} existingPeers=${existingPeers.length}`
        );

        cb({ peers: existingPeers });

        // Notify everyone else
        socket.to(roomId).emit('peerJoined', {
          peerId: socket.id,
          displayName,
        });
      } catch (err) {
        replyError(cb, err.message);
      }
    });

    // ── getRtpCapabilities ────────────────────────────────────────────────
    socket.on('getRtpCapabilities', (_, cb) => {
      try {
        const room = rooms.get(socket.roomId);
        if (!room) return replyError(cb, 'Room not found');
        cb({ rtpCapabilities: room.router.rtpCapabilities });
      } catch (err) {
        replyError(cb, err.message);
      }
    });

    // ── createWebRtcTransport ─────────────────────────────────────────────
    socket.on('createWebRtcTransport', async ({ direction }, cb) => {
      try {
        const room = rooms.get(socket.roomId);
        if (!room) return replyError(cb, 'Room not found');

        const peer = room.getPeer(socket.id);
        if (!peer) return replyError(cb, 'Peer not found');

        const params = await room.createWebRtcTransport(peer, direction);

        cb({ params });
      } catch (err) {
        replyError(cb, err.message);
      }
    });

    // ── connectTransport ──────────────────────────────────────────────────
    socket.on('connectTransport', async ({ transportId, dtlsParameters }, cb) => {
      try {
        const room = rooms.get(socket.roomId);
        if (!room) return replyError(cb, 'Room not found');

        const peer = room.getPeer(socket.id);
        if (!peer) return replyError(cb, 'Peer not found');

        await peer.connectTransport(transportId, dtlsParameters);
        cb({});
      } catch (err) {
        replyError(cb, err.message);
      }
    });

    // ── produce ───────────────────────────────────────────────────────────
    socket.on('produce', async ({ transportId, kind, rtpParameters, appData }, cb) => {
      try {
        const room = rooms.get(socket.roomId);
        if (!room) return replyError(cb, 'Room not found');

        const peer = room.getPeer(socket.id);
        if (!peer) return replyError(cb, 'Peer not found');

        const producer = await room.createProducer(
          peer,
          transportId,
          kind,
          rtpParameters,
          appData || {}
        );

        cb({ producerId: producer.id });

        // Count how many other peers will be notified
        const otherPeers = [...room.peers.keys()].filter(id => id !== socket.id);
        console.log(`[produce] notifying ${otherPeers.length} peer(s) of new ${kind} producer: ${producer.id}`);

        // Notify all other peers about the new producer
        socket.to(socket.roomId).emit('newProducer', {
          producerId: producer.id,
          producerPeerId: socket.id,
          displayName: peer.displayName,
          kind,
          appData: producer.appData,
        });
      } catch (err) {
        replyError(cb, err.message);
      }
    });

    // ── consume ───────────────────────────────────────────────────────────
    socket.on('consume', async ({ producerId, producerPeerId, rtpCapabilities }, cb) => {
      try {
        console.log(`[consume] consumerPeerId=${socket.id} producerPeerId=${producerPeerId} producerId=${producerId}`);

        const room = rooms.get(socket.roomId);
        if (!room) return replyError(cb, 'Room not found');

        const consumerPeer = room.getPeer(socket.id);
        if (!consumerPeer) return replyError(cb, 'Consumer peer not found');

        const producerPeer = room.getPeer(producerPeerId);
        if (!producerPeer) {
          console.error(`[consume] producerPeer NOT FOUND for id=${producerPeerId}. Room peers: ${[...room.peers.keys()].join(', ')}`);
          return replyError(cb, 'Producer peer not found');
        }

        // Log recv transport info for debugging
        for (const [tid, t] of consumerPeer.transports) {
          console.log(`[consume] consumerPeer transport id=${tid} direction=${t.appData?.direction}`);
        }

        consumerPeer._rtpCapabilities = rtpCapabilities;

        const consumerParams = await room.createConsumer(
          consumerPeer,
          producerPeer,
          producerId
        );

        console.log(`[consume] ✅ consumer created id=${consumerParams.id}`);
        cb({ params: consumerParams });
      } catch (err) {
        console.error(`[consume] ❌ ERROR: ${err.message}`);
        replyError(cb, err.message);
      }
    });

    // ── resumeConsumer ────────────────────────────────────────────────────
    socket.on('resumeConsumer', async ({ consumerId }, cb) => {
      try {
        const room = rooms.get(socket.roomId);
        if (!room) return replyError(cb, 'Room not found');

        const peer = room.getPeer(socket.id);
        if (!peer) return replyError(cb, 'Peer not found');

        const consumer = peer.getConsumer(consumerId);
        if (!consumer) return replyError(cb, `Consumer ${consumerId} not found`);

        await consumer.resume();
        cb({});
      } catch (err) {
        replyError(cb, err.message);
      }
    });

    // ── getProducers ──────────────────────────────────────────────────────
    socket.on('getProducers', (_, cb) => {
      try {
        const room = rooms.get(socket.roomId);
        if (!room) return replyError(cb, 'Room not found');

        const producers = [];
        for (const [peerId, peer] of room.peers) {
          if (peerId === socket.id) continue;
          for (const [producerId, producer] of peer.producers) {
            producers.push({
              producerId,
              producerPeerId: peerId,
              displayName: peer.displayName,
              kind: producer.kind,
              appData: producer.appData,
            });
          }
        }
        cb({ producers });
      } catch (err) {
        replyError(cb, err.message);
      }
    });

    // ── disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      console.log(`[Socket] Disconnected: ${socket.id}`);
      const roomId = socket.roomId;
      if (!roomId) return;

      const room = rooms.get(roomId);
      if (!room) return;

      const peer = room.removePeer(socket.id);

      const remainingPeers = Array.from(room.peers.keys());
      const onlyBotsLeft = remainingPeers.every(id => id.startsWith('bot-'));

      if (room.isEmpty || onlyBotsLeft) {
        // If there are bots left, tell the IVR service to shut them down
        if (onlyBotsLeft && remainingPeers.length > 0) {
          const ivrUrl = process.env.IVR_SERVICE_URL || 'http://localhost:3002';
          for (const botId of remainingPeers) {
            fetch(`${ivrUrl}/leave`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ roomId, botId })
            }).catch(() => {});
          }
        }

        room.close();
        rooms.delete(roomId);
        console.log(`[Room ${roomId}] Destroyed (empty or only bots left)`);
      } else {
        // Notify remaining peers
        io.to(roomId).emit('peerLeft', {
          peerId: socket.id,
          displayName: peer?.displayName,
        });
      }
    });
  });

  // Expose rooms map and room factory for the bot router
  return { rooms, getOrCreateRoom };
}

module.exports = { setupSignaling };
