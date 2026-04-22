/**
 * ivr.js — Lightweight IVR state machine (Greeting only).
 */
const { speak, stop } = require('./tts');

class IVR {
  constructor({ onLeave, onSpeak } = {}) {
    this._onLeave = onLeave || (() => { });
    this._onSpeak = onSpeak || speak;
  }

  /**
   * Called when the bot first joins the room.
   */
  async onJoin() {
    await this._onSpeak(
      'Hello! Welcome to Chag-han Video. I am a lightweight assistant. ' +
      'Voice recognition is currently disabled to save server memory, ' +
      'but you can still hear my announcements.'
    );
  }

  // Stubs for future keypad (DTMF) integration
  async onTranscript(text) {}
  async onGarbage() {}
  async onDtmf(key) {
    console.log(`[IVR] DTMF key: ${key}`);
  }
}

module.exports = IVR;
