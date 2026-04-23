/**
 * stt.js — Bridge to Python Vosk worker.
 */
const EventEmitter = require('events');
const { spawn } = require('child_process');
const path = require('path');

class STT extends EventEmitter {
  constructor() {
    super();
    this._worker = null;
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return;

    const workerPath = path.join(__dirname, 'stt_worker.py');
    
    // Spawn python process
    // Use 'python3' as standard for Mac/Ubuntu
    this._worker = spawn('python3', [workerPath]);

    this._worker.on('error', (err) => console.error('[STT] Worker spawn error:', err));
    if (this._worker.stdin) {
      this._worker.stdin.on('error', (err) => console.error('[STT] stdin error:', err.message));
    }

    this._worker.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.status === 'ready') {
            this._initialized = true;
            console.log('[STT] ✅ Vosk Python worker ready.');
          } else if (msg.transcript) {
            this.emit('final', { text: msg.transcript });
          } else if (msg.error) {
            console.error('[STT] Worker error:', msg.error);
          }
        } catch (e) {
          // console.warn('[STT] Failed to parse worker output:', line);
        }
      }
    });

    this._worker.stderr.on('data', (data) => {
      // console.error(`[STT Python Debug] ${data}`);
    });

    this._worker.on('close', (code) => {
      console.log(`[STT] Python worker exited with code ${code}`);
      this._initialized = false;
    });

    // Wait a bit for the worker to signal ready
    return new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(), 5000);
      const onReady = () => {
        clearTimeout(timeout);
        resolve();
      };
      this.once('ready', onReady); // We don't actually emit 'ready' yet but we could
      // For now we just resolve and let it work in background
      resolve();
    });
  }

  feed(pcm) {
    if (!this._worker || !this._worker.stdin.writable) return;
    this._worker.stdin.write(pcm);
  }

  reset() {
    // In Python version we could restart the process or send a reset signal
  }

  close() {
    if (this._worker) {
      this._worker.kill();
      this._worker = null;
    }
    this._initialized = false;
  }
}

module.exports = STT;
