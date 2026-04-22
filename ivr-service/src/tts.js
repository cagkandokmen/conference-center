const say = require('say');
const path = require('path');
const fs = require('fs');

/**
 * Speak text via system TTS.
 * @param {string} text
 * @param {object} [opts]
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
 * Export speech to a WAV file.
 * @param {string} text 
 * @param {string} filename 
 */
function speakToFile(text, filename, { voice = null, speed = 1.0 } = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[TTS] Exporting to file: "${text}" -> ${filename}`);
    say.export(text, voice, speed, filename, (err) => {
      if (err) {
        console.error(`[TTS] Export Error: ${err.message}`);
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

module.exports = { speak, speakToFile, stop };
