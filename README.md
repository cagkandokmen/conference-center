# mediasoup-server

A production-quality WebRTC SFU stack using **mediasoup** + **Socket.IO** signaling and a **React + Vite** client.

```
mediasoup-server/
├── signal-service/    Node.js SFU signaling server
└── client/            React + Vite WebRTC client
```

---

## Quick Start

### 1. Signal Service

```bash
cd signal-service
npm install
npm start          # production
# or
npm run dev        # with nodemon hot-reload
```

Server starts on **http://localhost:3001**

### 2. React Client

```bash
cd client
npm install
npm run dev
```

Client starts on **http://localhost:5173**

---

## Environment Variables (signal-service)

Create `signal-service/.env` to override:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP / WS port |
| `MEDIASOUP_LISTEN_IP` | `0.0.0.0` | IP mediasoup listens on |
| `MEDIASOUP_ANNOUNCED_IP` | `127.0.0.1` | IP announced to clients (set to your public IP for remote) |

---

## Architecture

```
Browser A                          Browser B
   │                                  │
   │  Socket.IO (WS)                  │
   ▼                                  ▼
┌────────────────────────────────────────┐
│           signal-service               │
│                                        │
│  ┌─────────────┐   ┌────────────────┐  │
│  │   Room       │   │  Peer (per ws) │  │
│  │  (Router)    │   │  transports    │  │
│  │             │◄──│  producers     │  │
│  │             │──►│  consumers     │  │
│  └─────────────┘   └────────────────┘  │
│                                        │
│  mediasoup Worker pool (1 per CPU)     │
└────────────────────────────────────────┘
```

## Signaling Events

| Event | Direction | Description |
|---|---|---|
| `joinRoom` | C→S | Join / create a room |
| `getRtpCapabilities` | C→S | Fetch router RTP capabilities |
| `createWebRtcTransport` | C→S | Create send or recv transport |
| `connectTransport` | C→S | DTLS handshake |
| `produce` | C→S | Start producing a track |
| `getProducers` | C→S | List existing producers in room |
| `consume` | C→S | Request to consume a producer |
| `resumeConsumer` | C→S | Resume paused consumer |
| `newProducer` | S→C | Notify peers of new producer |
| `peerJoined` | S→C | New peer entered the room |
| `peerLeft` | S→C | Peer disconnected |
# conference-center
