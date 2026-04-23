/**
 * ivr.js — Simple IVR logic.
 */
class IVR {
  constructor({ onLeave, onSpeak } = {}) {
    this._onLeave = onLeave || (() => { });
    this._onSpeak = onSpeak || (() => { });
    this._state = 'idle';
  }

  async onJoin() {
    this._state = 'listening';
    await this._onSpeak(
      "Hello! Welcome to Chag-han Video. I am your simple IVR assistant. " +
      "Say help for assistance, or say goodbye to disconnect me."
    );
  }

  async onTranscript(text) {
    if (!text || this._state !== 'listening') return;
    const lower = text.toLowerCase();
    console.log(`[IVR] I heard: "${lower}"`);

    if (lower.includes('help') || lower.includes('support')) {
      await this._onSpeak("For help, please stay on the line. I am a simple bot.");
    } else if (lower.includes('bye') || lower.includes('goodbye') || lower.includes('leave')) {
      await this._onSpeak("Goodbye!");
      // Wait a moment for the audio to finish before leaving
      setTimeout(() => this._onLeave(), 1500);
    } else if (lower.includes('hello') || lower.includes('hi')) {
      await this._onSpeak("Hello there! How can I help you?");
    } else {
      await this._onSpeak(`You said: ${text}`);
    }
  }
}

module.exports = IVR;
