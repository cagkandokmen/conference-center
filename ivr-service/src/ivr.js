/**
 * ivr.js — IVR state machine.
 *
 * Receives transcript text (from STT), decides what to say/do.
 * Add your own keywords and actions here.
 *
 * States: idle → greeted → listening → (action)
 */
const { speak, stop } = require('./tts');

class IVR {
  /**
   * @param {{ onLeave: Function, onSpeak: Function }} callbacks
   */
  constructor({ onLeave, onSpeak } = {}) {
    this._state = 'idle';
    this._onLeave = onLeave || (() => { });
    this._onSpeak = onSpeak || speak;

    // Keyword → handler map. Keys are lowercase substrings to match.
    this._intents = [
      {
        keywords: ['hello', 'hi', 'hey'],
        action: () => this._onSpeak('Hello! I am the IVR assistant. How can I help you?'),
      },
      {
        keywords: ['help', 'support', 'assist'],
        action: () => this._onSpeak('For support, please stay on the line. A representative will join shortly.'),
      },
      {
        keywords: ['bye', 'goodbye', 'leave', 'exit', 'disconnect'],
        action: async () => {
          await this._onSpeak('Goodbye! Have a great day.');
          this._onLeave();
        },
      },
      {
        keywords: ['sales', 'buy', 'pricing'],
        action: () => this._onSpeak('Connecting you to the sales department.'),
      },
      {
        keywords: ['technical support', 'tech support', 'broken', 'issue'],
        action: () => this._onSpeak('Connecting you to technical support.'),
      },
      {
        keywords: ['billing', 'invoice', 'payment'],
        action: () => this._onSpeak('Connecting you to the billing department.'),
      },
    ];
  }

  get isListening() {
    return this._state === 'listening';
  }

  /**
   * Called when the bot first joins the room.
   */
  async onJoin() {
    this._state = 'greeted';
    await this._onSpeak(
      'Hello! Welcome to Chag-han Video IVR. ' +
      'Say help for support, say sales for the sales department, say technical support for tech support, ' +
      'or say goodbye to disconnect me.'
    );
    // Wait 1 second for speakers to physically finish and room echo to fade
    await new Promise(r => setTimeout(r, 1000));
    this._state = 'listening';
  }

  /**
   * Called when a final STT transcript arrives.
   * @param {string} text
   */
  async onTranscript(text) {
    if (!text || this._state !== 'listening') return;

    this._state = 'speaking';

    const lower = text.toLowerCase();
    console.log(`[IVR] Transcript received: "${lower}" (state: ${this._state})`);

    let matchedAction = null;
    // Find matching intent
    for (const intent of this._intents) {
      const matched = intent.keywords.some(kw => lower.includes(kw));
      if (matched) {
        matchedAction = intent.action;
        break;
      }
    }

    stop(); // stop any ongoing TTS

    if (matchedAction) {
      await matchedAction();
    } else {
      // No intent matched — default fallback
      await this._onSpeak(`I heard: ${text}. I'm sorry, I didn't understand that. Please try again.`);
    }

    // Wait 1 second for speakers to physically finish and room echo to fade
    await new Promise(r => setTimeout(r, 1000));
    this._state = 'listening';
  }

  /**
   * Called when the STT detects voice but the transcript is empty or garbage
   */
  async onGarbage() {
    if (this._state !== 'listening') return;

    this._state = 'speaking';
    console.log(`[IVR] Garbage transcript received. Asking user to repeat.`);

    stop(); // stop any ongoing TTS

    await speak("I didn't hear you clearly. Could you please repeat that?");

    // Wait 1 second for speakers to physically finish and room echo to fade
    await new Promise(r => setTimeout(r, 1000));
    this._state = 'listening';
  }

  /**
   * Called when a DTMF key is detected (future: RFC 4733).
   * @param {string} key  — '0'-'9', '*', '#'
   */
  async onDtmf(key) {
    console.log(`[IVR] DTMF key: ${key}`);
    await this.onTranscript(`press ${key}`);
  }
}

module.exports = IVR;
