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
  return new Promise(async (resolve, reject) => {
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
      // Ubuntu / Linux (Use Free Google TTS to sound human instead of robotic espeak)
      try {
        const axios = require('axios');
        const fs = require('fs');
        
        // Google TTS requires URL encoding and limits to ~200 chars per request.
        const encodedText = encodeURIComponent(text.substring(0, 200));
        const url = `https://translate.google.com/translate_tts?ie=UTF-8&tl=en-US&client=tw-ob&q=${encodedText}`;
        
        const res = await axios({ url, method: 'GET', responseType: 'stream' });
        const writer = fs.createWriteStream(filename);
        res.data.pipe(writer);
        
        writer.on('finish', () => resolve());
        writer.on('error', reject);
      } catch (err) {
        console.error('[TTS] Google TTS Error:', err.message);
        reject(err);
      }
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
