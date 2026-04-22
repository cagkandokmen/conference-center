/**
 * tts.js — Text-to-speech wrapper using say.js.
 *
 * say.js uses:
 *   macOS  → system `say` command (high quality, built-in)
 *   Linux  → espeak (install: sudo apt install espeak)
 *   Windows → SAPI
 *
 * speak(text) → returns a Promise that resolves when audio finishes playing.
 */
const say = require('say');

/**
 * Speak text via system TTS.
 * @param {string} text
 * @param {object} [opts]
 * @param {string} [opts.voice]  - platform voice name (optional)
 * @param {number} [opts.speed]  - speed multiplier (default 1.0)
 * @returns {Promise<void>}
 */
function speak(text, { voice = 'Samantha', speed = 1.0 } = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[TTS] Speaking: "${text}"`);
    say.speak(text, voice, speed, (err) => {
      if (err) {
        console.error(`[TTS] Error: ${err.message}`);
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

/**
 * Stop any currently playing TTS.
 */
function stop() {
  try { say.stop(); } catch (_) {}
}

module.exports = { speak, stop };
