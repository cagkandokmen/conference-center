/**
 * Room — owns a mediasoup Router and manages all Peers inside it.
 */
const config = require('./config');
const Peer = require('./Peer');

class Room {
  /**
   * @param {string} roomId
   * @param {import('mediasoup').types.Worker} worker
   */
  constructor(roomId, worker) {
    this.id = roomId;
    this._worker = worker;

    /** @type {import('mediasoup').types.Router | null} */
    this._router = null;

    /** @type {Map<string, Peer>} */
    this.peers = new Map();
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────

  /** Must be called once before the room is used. */
  async init() {
    this._router = await this._worker.createRouter(config.routerOptions);
    console.log(`[Room ${this.id}] Router created (id=${this._router.id})`);
  }

  get router() {
    if (!this._router) throw new Error(`Room ${this.id} not initialized`);
    return this._router;
  }

  close() {
    this._router?.close();
    for (const peer of this.peers.values()) peer.close();
    this.peers.clear();
    console.log(`[Room ${this.id}] Closed`);
  }

  get isEmpty() {
    return this.peers.size === 0;
  }

  // ─── Peer Management ─────────────────────────────────────────────────────

  createPeer(socketId, displayName) {
    const peer = new Peer({ socketId, displayName });
    this.peers.set(socketId, peer);
    console.log(`[Room ${this.id}] Peer joined: ${displayName} (${socketId})`);
    return peer;
  }

  getPeer(socketId) {
    return this.peers.get(socketId);
  }

  removePeer(socketId) {
    const peer = this.peers.get(socketId);
    if (!peer) return null;
    peer.close();
    this.peers.delete(socketId);
    console.log(`[Room ${this.id}] Peer left: ${peer.displayName} (${socketId})`);
    return peer;
  }

  // ─── Transport ───────────────────────────────────────────────────────────

  async createWebRtcTransport(peer, direction) {
    const transport = await this.router.createWebRtcTransport({
      ...config.webRtcTransportOptions,
      appData: { direction }, // must be set at creation time in mediasoup
    });

    transport.on('dtlsstatechange', (state) => {
      if (state === 'closed') {
        peer.removeTransport?.(transport.id);
        transport.close();
      }
    });

    transport.on('close', () => {
      console.log(`[Room ${this.id}] Transport closed for peer ${peer.id}`);
    });

    peer.addTransport(transport);

    return {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters,
    };
  }

  // ─── Producers ───────────────────────────────────────────────────────────

  async createProducer(peer, transportId, kind, rtpParameters, appData) {
    const transport = peer.getTransport(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found`);

    const producer = await transport.produce({ kind, rtpParameters, appData });

    peer.addProducer(producer);

    producer.on('transportclose', () => {
      peer.removeProducer(producer.id);
    });

    console.log(
      `[Room ${this.id}] Producer created: kind=${kind} peerId=${peer.id} producerId=${producer.id}`
    );

    return producer;
  }

  // ─── Consumers ───────────────────────────────────────────────────────────

  async createConsumer(consumerPeer, producerPeer, producerId) {
    const producer = producerPeer.getProducer(producerId);
    if (!producer) throw new Error(`Producer ${producerId} not found`);

    if (
      !this.router.canConsume({
        producerId: producer.id,
        rtpCapabilities: consumerPeer._rtpCapabilities,
      })
    ) {
      throw new Error(`Cannot consume producer ${producerId}`);
    }

    // Find the recv transport for this consumer peer (direction === 'recv')
    let recvTransport = null;
    for (const t of consumerPeer.transports.values()) {
      if (t.appData?.direction === 'recv') {
        recvTransport = t;
        break;
      }
    }
    if (!recvTransport) throw new Error(`No recv transport for peer ${consumerPeer.id}`);

    const consumer = await recvTransport.consume({
      producerId: producer.id,
      rtpCapabilities: consumerPeer._rtpCapabilities,
      paused: true, // start paused, client resumes after rendering
    });

    consumerPeer.addConsumer(consumer);

    consumer.on('transportclose', () => consumerPeer.removeConsumer(consumer.id));
    consumer.on('producerclose', () => consumerPeer.removeConsumer(consumer.id));

    console.log(
      `[Room ${this.id}] Consumer created: peerId=${consumerPeer.id} consumerId=${consumer.id}`
    );

    return {
      id: consumer.id,
      producerId: producer.id,
      kind: consumer.kind,
      rtpParameters: consumer.rtpParameters,
      producerPeerId: producerPeer.id,
      producerDisplayName: producerPeer.displayName,
      appData: producer.appData,
    };
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /** Return serializable list of peers (excluding the requesting peer). */
  getPeersExcept(socketId) {
    const result = [];
    for (const [id, peer] of this.peers) {
      if (id !== socketId) result.push(peer.toJSON());
    }
    return result;
  }
}

module.exports = Room;
