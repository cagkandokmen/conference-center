/**
 * index.js — IVR service entry point.
 *
 * HTTP API:
 *   POST /join  { roomId } → bot joins the room
 *   POST /leave { roomId } → bot leaves the room
 *   GET  /status           → list active bots
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const Bot = require('./bot');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(express.json());
app.use(cors()); // allow React dev server and same-origin prod calls

// Active bots: roomId → Bot instance
const activeBots = new Map();

// ── POST /join ────────────────────────────────────────────────────────────
app.post('/join', async (req, res) => {
  const { roomId } = req.body;
  if (!roomId) return res.status(400).json({ error: 'roomId is required' });

  if (activeBots.has(roomId)) {
    return res.status(409).json({ error: 'IVR bot already active in this room' });
  }

  const bot = new Bot(roomId, () => {
    activeBots.delete(roomId);
  });
  activeBots.set(roomId, bot);

  // Join asynchronously so we can respond immediately
  bot.join().catch((err) => {
    console.error(`[IVR] Bot join failed for room ${roomId}:`, err.message);
    activeBots.delete(roomId);
  });

  console.log(`[IVR] Bot joining room ${roomId}`);
  res.json({ ok: true, roomId, message: 'IVR bot joining room...' });
});

// ── POST /leave ───────────────────────────────────────────────────────────
app.post('/leave', async (req, res) => {
  const { roomId } = req.body;
  const bot = activeBots.get(roomId);
  if (!bot) return res.status(404).json({ error: 'No active bot in this room' });

  await bot.leave().catch(console.error);
  activeBots.delete(roomId);

  res.json({ ok: true, roomId });
});

// ── GET /status ───────────────────────────────────────────────────────────
app.get('/status', (_, res) => {
  const rooms = [...activeBots.keys()];
  res.json({ activeBots: rooms.length, rooms });
});

// ── POST /inject ──────────────────────────────────────────────────────────
// Simulates a user speaking a phrase
app.post('/inject', (req, res) => {
  const { roomId, text } = req.body;
  const bot = activeBots.get(roomId);
  if (!bot) return res.status(404).json({ error: 'No active bot in this room' });

  // Call the stub STT inject method
  bot._stt.inject(text);
  res.json({ ok: true, injected: text });
});

// ── Health check ──────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok' }));

const server = app.listen(PORT, () => {
  console.log(`\n🤖 IVR Service running on http://localhost:${PORT}`);
  console.log(`   POST /join  { roomId } → bot joins room`);
  console.log(`   POST /leave { roomId } → bot leaves room`);
  console.log(`   GET  /status           → list active bots\n`);
});

// ── Graceful Shutdown (prevents EADDRINUSE on nodemon restart) ────────────
async function shutdown() {
  console.log('\n[IVR] Shutting down gracefully...');
  // Tell all active bots to leave and close their UDP sockets
  for (const bot of activeBots.values()) {
    await bot.leave().catch(() => { });
  }
  server.close(() => {
    console.log('[IVR] HTTP server closed. Exiting.');
    process.exit(0);
  });

  // Force exit after 3 seconds if things get stuck
  setTimeout(() => process.exit(1), 3000);
}

process.once('SIGUSR2', shutdown); // nodemon restart
process.once('SIGINT', shutdown);  // Ctrl+C
process.once('SIGTERM', shutdown); // Kill command

// ── Global Error Handling (prevents crashes) ──────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[IVR] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[IVR] Unhandled Rejection at:', promise, 'reason:', reason);
});
