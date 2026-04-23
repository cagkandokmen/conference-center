const say = require('say');

/**
 * Export speech to a WAV file.
 * say.js uses:
 *   macOS  → built-in `say`
 *   Linux  → `espeak`
 *   Windows → SAPI
 */
const defaultVoice = process.platform === 'darwin' ? 'Samantha' : null;

function speakToFile(text, filename, { voice = defaultVoice, speed = 1.0 } = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[TTS] Exporting to file: "${text}" -> ${filename}`);
    
    if (process.platform === 'darwin') {
      const { spawn } = require('child_process');
      const args = ['-o', filename, '--data-format=LEI16@48000', text];
      if (voice) args.unshift('-v', voice);
      
      const child = spawn('say', args);
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`say command failed with code ${code}`));
      });
    } else {
      say.export(text, voice, speed, filename, (err) => {
        if (err) {
          console.error(`[TTS] Export Error: ${err.message}`);
          reject(err);
        } else {
          resolve();
        }
      });
    }
  });
}

/**
 * Stop any currently playing TTS.
 */
function stop() {
  try { say.stop(); } catch (_) {}
}

module.exports = { speakToFile, stop };
