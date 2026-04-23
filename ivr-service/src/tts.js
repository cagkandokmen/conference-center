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
    const { spawn } = require('child_process');
    
    if (process.platform === 'darwin') {
      const args = ['-o', filename, '--data-format=LEI16@48000', text];
      if (voice) args.unshift('-v', voice);
      
      const child = spawn('say', args);
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`say command failed with code ${code}`));
      });
    } else {
      // Ubuntu / Linux (Directly use espeak to bypass the buggy say.js wrapper)
      // -w writes to wav file, -s 150 is normal speed
      const child = spawn('espeak', ['-w', filename, '-s', '150', text]);
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`espeak failed with code ${code}`));
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
