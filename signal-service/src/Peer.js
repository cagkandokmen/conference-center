/**
 * Peer — represents a single connected client inside a Room.
 * Holds send/recv WebRTC transports, producers and consumers.
 */
class Peer {
  constructor({ socketId, displayName }) {
    this.id = socketId;
    this.displayName = displayName;

    /** @type {Map<string, import('mediasoup').types.WebRtcTransport>} */
    this.transports = new Map();

    /** @type {Map<string, import('mediasoup').types.Producer>} */
    this.producers = new Map();

    /** @type {Map<string, import('mediasoup').types.Consumer>} */
    this.consumers = new Map();
  }

  // ─── Transports ──────────────────────────────────────────────────────────

  addTransport(transport) {
    this.transports.set(transport.id, transport);
  }

  getTransport(transportId) {
    return this.transports.get(transportId);
  }

  async connectTransport(transportId, dtlsParameters) {
    const transport = this.transports.get(transportId);
    if (!transport) throw new Error(`Transport ${transportId} not found for peer ${this.id}`);
    await transport.connect({ dtlsParameters });
  }

  // ─── Producers ───────────────────────────────────────────────────────────

  addProducer(producer) {
    this.producers.set(producer.id, producer);
  }

  getProducer(producerId) {
    return this.producers.get(producerId);
  }

  removeProducer(producerId) {
    this.producers.delete(producerId);
  }

  // ─── Consumers ───────────────────────────────────────────────────────────

  addConsumer(consumer) {
    this.consumers.set(consumer.id, consumer);
  }

  getConsumer(consumerId) {
    return this.consumers.get(consumerId);
  }

  removeConsumer(consumerId) {
    this.consumers.delete(consumerId);
  }

  // ─── Cleanup ─────────────────────────────────────────────────────────────

  close() {
    for (const transport of this.transports.values()) {
      transport.close();
    }
    this.transports.clear();
    this.producers.clear();
    this.consumers.clear();
  }

  // ─── Serialization ───────────────────────────────────────────────────────

  toJSON() {
    return {
      id: this.id,
      displayName: this.displayName,
      producers: Array.from(this.producers.keys()),
    };
  }
}

module.exports = Peer;
