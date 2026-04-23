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
  inject(text) {
    console.log(`[STT] Injected text: "${text}"`);
    this.emit('transcript', text);
  }
  reset() {}
  close() {}
}

module.exports = STT;
