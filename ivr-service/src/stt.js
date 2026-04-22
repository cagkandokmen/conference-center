/**
 * stt.js — Stub (AI Speech-to-Text removed for memory optimization).
 */
const EventEmitter = require('events');

class STT extends EventEmitter {
  constructor() {
    super();
  }
  async init() {
    console.log('[STT] Lightweight mode: STT engine disabled.');
  }
  feed(pcm) {}
  reset() {}
  close() {}
}

module.exports = STT;
