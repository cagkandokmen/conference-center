require('dotenv').config();
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const mediasoup = require('mediasoup');
const config = require('./config');
const { setupSignaling } = require('./signaling');
const { setupBotRouter } = require('./botRouter');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// ─── Static files (production) ─────────────────────────────────────────────
// In production Express serves the React build directly — no Nginx needed.
// In development Vite dev server runs separately on :5173.
const clientDist = path.resolve(__dirname, '../../client/dist');

if (isProd) {
  if (!fs.existsSync(clientDist)) {
    console.warn(`⚠️  client/dist not found. Run: npm run build`);
  } else {
    // Serve static assets (JS, CSS, images …)
    app.use(express.static(clientDist));
    console.log(`📦 Serving React build from ${clientDist}`);
  }
}

app.use(express.json());

// ─── Health check ──────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', env: isProd ? 'production' : 'development' }));

// ─── SPA fallback (production) ────────────────────────────────────────────
// All non-API/socket routes return index.html so React Router works.
if (isProd && fs.existsSync(clientDist)) {
  app.get('*', (req, res) => {
    // Don't catch socket.io or /health
    if (req.path.startsWith('/socket.io') || req.path === '/health') return;
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// ─── Create HTTP or HTTPS server ──────────────────────────────────────────
let server;

const sslCert = process.env.SSL_CERT; // path to fullchain.pem
const sslKey = process.env.SSL_KEY;  // path to privkey.pem

if (isProd && sslCert && sslKey) {
  // Production HTTPS — certs from Let's Encrypt (Certbot) or any CA
  const credentials = {
    cert: fs.readFileSync(sslCert, 'utf8'),
    key: fs.readFileSync(sslKey, 'utf8'),
  };
  server = https.createServer(credentials, app);
  console.log('🔒 HTTPS mode — SSL certs loaded');
} else {
  // Development HTTP (browsers allow getUserMedia on localhost without HTTPS)
  server = http.createServer(app);
  if (isProd) {
    console.warn('⚠️  Production without SSL — set SSL_CERT and SSL_KEY env vars');
  }
}

// ─── Socket.IO ────────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    // In production same-origin — no CORS needed.
    // In dev, Vite runs on :5173 so we allow it.
    origin: isProd ? false : '*',
    methods: ['GET', 'POST'],
  },
});

// ─── mediasoup Workers ────────────────────────────────────────────────────
async function createWorkers() {
  const workers = [];
  for (let i = 0; i < config.numWorkers; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: 'warn',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
      rtcMinPort: 40000,
      rtcMaxPort: 49999,
    });

    worker.on('died', () => {
      console.error(`[Worker ${worker.pid}] died — restarting process`);
      process.exit(1);
    });

    workers.push(worker);
    console.log(`[Worker ${i + 1}/${config.numWorkers}] pid=${worker.pid}`);
  }
  return workers;
}

// ─── Bootstrap ────────────────────────────────────────────────────────────
async function main() {
  const workers = await createWorkers();
  const { rooms, getOrCreateRoom } = setupSignaling(io, workers);

  // Mount bot API (localhost-only, used by ivr-service)
  app.use('/api/bot', setupBotRouter(rooms, getOrCreateRoom, io));

  const port = config.listenPort;
  const protocol = isProd && sslCert ? 'https' : 'http';

  const serverInstance = server.listen(port, config.listenIp, () => {
    console.log(`\n🚀 Server listening on ${protocol}://localhost:${port}`);
    if (isProd) {
      console.log(`   React app   → ${protocol}://localhost:${port}/`);
      console.log(`   Signal API  → ${protocol}://localhost:${port}/socket.io`);
    } else {
      console.log(`   Signal API  → http://localhost:${port}/socket.io`);
      console.log(`   React dev   → http://localhost:5173  (run: npm run dev --prefix client)`);
    }
    console.log('');
  });

  // ── Graceful Shutdown (prevents EADDRINUSE) ────────────────────────────
  async function shutdown() {
    console.log('\n[Signal] Shutting down gracefully...');
    for (const worker of workers) {
      worker.close();
    }
    serverInstance.close(() => {
      console.log('[Signal] HTTP server closed. Exiting.');
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 3000);
  }

  process.once('SIGUSR2', shutdown);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
