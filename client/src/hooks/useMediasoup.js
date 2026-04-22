/**
 * useMediasoup — complete mediasoup client hook.
 *
 * Manages:
 *  - Socket.IO connection
 *  - mediasoup Device load
 *  - Send (produce) transport
 *  - Recv (consume) transport
 *  - Local producers (mic, camera)
 *  - Remote consumers
 *  - Room peer state
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { io } from 'socket.io-client'
import { Device } from 'mediasoup-client'

// Production: React is served by Express on the same origin → use window.location.origin
// Development: Vite dev server proxies /socket.io to :3001 → use relative path '/'
const SIGNAL_URL = import.meta.env.DEV ? 'http://localhost:3001' : window.location.origin

function promisifyEmit(socket, event, data) {
  return new Promise((resolve, reject) => {
    socket.emit(event, data, (response) => {
      if (response?.error) reject(new Error(response.error))
      else resolve(response)
    })
  })
}

export function useMediasoup({ roomId, displayName }) {
  const socketRef      = useRef(null)
  const deviceRef      = useRef(null)
  const sendTransport  = useRef(null)
  const recvTransport  = useRef(null)

  const localVideoRef  = useRef(null) // <video> element ref (set externally)
  const localStreamRef = useRef(null)

  const [status, setStatus]         = useState('idle')       // idle | connecting | connected | error
  const [peers, setPeers]           = useState([])           // [{ id, displayName, streams }]
  const [micEnabled, setMicEnabled] = useState(true)
  const [camEnabled, setCamEnabled] = useState(true)

  // Map: peerId → { videoStream, audioStream }
  const peerStreamsRef = useRef({})
  // Map: producerId → consumer
  const consumersRef  = useRef({})

  // ── Helpers ─────────────────────────────────────────────────────────────

  const updatePeers = useCallback(() => {
    setPeers(prev =>
      prev.map(p => ({
        ...p,
        stream: peerStreamsRef.current[p.id]?.stream || null,
      }))
    )
  }, [])

  // ── Consume a remote producer ────────────────────────────────────────────

  const consumeProducer = useCallback(async ({ producerId, producerPeerId, displayName: peerName, kind }) => {
    const socket = socketRef.current
    if (!socket || !recvTransport.current) return

    try {
      const { params } = await promisifyEmit(socket, 'consume', {
        producerId,
        producerPeerId,
        rtpCapabilities: deviceRef.current.rtpCapabilities,
      })

      const consumer = await recvTransport.current.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      })

      consumersRef.current[consumer.id] = consumer

      // Build / update stream for this peer
      if (!peerStreamsRef.current[producerPeerId]) {
        peerStreamsRef.current[producerPeerId] = { stream: new MediaStream() }
      }
      peerStreamsRef.current[producerPeerId].stream.addTrack(consumer.track)

      // Resume on server
      await promisifyEmit(socket, 'resumeConsumer', { consumerId: consumer.id })

      // Ensure peer exists in state
      setPeers(prev => {
        const exists = prev.find(p => p.id === producerPeerId)
        const updated = exists
          ? prev.map(p => p.id === producerPeerId
              ? { ...p, stream: peerStreamsRef.current[producerPeerId].stream }
              : p)
          : [...prev, {
              id: producerPeerId,
              displayName: peerName,
              stream: peerStreamsRef.current[producerPeerId].stream,
            }]
        return updated
      })

      consumer.on('trackended', () => {
        consumer.close()
        delete consumersRef.current[consumer.id]
      })
    } catch (err) {
      console.error('[consume] error:', err.message)
    }
  }, [])

  // ── Create receive transport and start consuming existing producers ──────

  const setupRecvTransport = useCallback(async (socket, existingPeers) => {
    const { params } = await promisifyEmit(socket, 'createWebRtcTransport', { direction: 'recv' })

    const transport = deviceRef.current.createRecvTransport(params)
    recvTransport.current = transport

    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        await promisifyEmit(socket, 'connectTransport', {
          transportId: transport.id,
          dtlsParameters,
        })
        callback()
      } catch (err) {
        errback(err)
      }
    })

    // Consume all producers already in the room
    const { producers } = await promisifyEmit(socket, 'getProducers', {})
    for (const prod of producers) {
      await consumeProducer(prod)
    }
  }, [consumeProducer])

  // ── Create send transport and produce local tracks ───────────────────────

  const setupSendTransport = useCallback(async (socket, localStream) => {
    const { params } = await promisifyEmit(socket, 'createWebRtcTransport', { direction: 'send' })

    const transport = deviceRef.current.createSendTransport(params)
    sendTransport.current = transport

    transport.on('connect', async ({ dtlsParameters }, callback, errback) => {
      try {
        await promisifyEmit(socket, 'connectTransport', {
          transportId: transport.id,
          dtlsParameters,
        })
        callback()
      } catch (err) {
        errback(err)
      }
    })

    transport.on('produce', async ({ kind, rtpParameters, appData }, callback, errback) => {
      try {
        const { producerId } = await promisifyEmit(socket, 'produce', {
          transportId: transport.id,
          kind,
          rtpParameters,
          appData,
        })
        callback({ id: producerId })
      } catch (err) {
        errback(err)
      }
    })

    // Produce audio
    const audioTrack = localStream.getAudioTracks()[0]
    if (audioTrack) {
      await transport.produce({ track: audioTrack, appData: { kind: 'audio' } })
    }

    // Produce video
    const videoTrack = localStream.getVideoTracks()[0]
    if (videoTrack) {
      await transport.produce({
        track: videoTrack,
        encodings: [
          { maxBitrate: 100_000 },
          { maxBitrate: 300_000 },
          { maxBitrate: 900_000 },
        ],
        codecOptions: { videoGoogleStartBitrate: 1000 },
        appData: { kind: 'video' },
      })
    }
  }, [])

  // ── Main join flow ───────────────────────────────────────────────────────

  const join = useCallback(async () => {
    if (!roomId || !displayName) return
    setStatus('connecting')

    try {
      // 1. Get local media
      const localStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true },
      })
      localStreamRef.current = localStream

      // 2. Connect socket
      const socket = io(SIGNAL_URL, { transports: ['websocket'] })
      socketRef.current = socket

      await new Promise((resolve, reject) => {
        socket.on('connect', resolve)
        socket.on('connect_error', reject)
      })

      // 3. Join room
      const { peers: existingPeers } = await promisifyEmit(socket, 'joinRoom', {
        roomId,
        displayName,
      })

      // 5. Load mediasoup Device
      const { rtpCapabilities } = await promisifyEmit(socket, 'getRtpCapabilities', {})
      const device = new Device()
      await device.load({ routerRtpCapabilities: rtpCapabilities })
      deviceRef.current = device

      // 6. Seed existing peers BEFORE consuming so consumeProducer
      //    updates them (with streams) instead of adding duplicates.
      //    Must happen before setupRecvTransport.
      setPeers(existingPeers.map(p => ({ ...p, stream: null })))

      // 7. Create transports (setupRecvTransport will fill in streams)
      await setupSendTransport(socket, localStream)
      await setupRecvTransport(socket, existingPeers)

      // 8. Socket event listeners
      socket.on('newProducer', (data) => {
        consumeProducer(data)
      })

      socket.on('peerJoined', ({ peerId, displayName: peerName }) => {
        setPeers(prev =>
          prev.find(p => p.id === peerId)
            ? prev
            : [...prev, { id: peerId, displayName: peerName, stream: null }]
        )
      })

      socket.on('peerLeft', ({ peerId }) => {
        setPeers(prev => prev.filter(p => p.id !== peerId))
        delete peerStreamsRef.current[peerId]
      })

      setStatus('connected')
    } catch (err) {
      console.error('[join] error:', err)
      setStatus('error')
    }
  }, [roomId, displayName, setupSendTransport, setupRecvTransport, consumeProducer])

  // ── Controls ─────────────────────────────────────────────────────────────

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current
    if (!stream) return
    stream.getAudioTracks().forEach(t => { t.enabled = !t.enabled })
    setMicEnabled(prev => !prev)
  }, [])

  const toggleCam = useCallback(() => {
    const stream = localStreamRef.current
    if (!stream) return
    stream.getVideoTracks().forEach(t => { t.enabled = !t.enabled })
    setCamEnabled(prev => !prev)
  }, [])

  const leave = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop())
    sendTransport.current?.close()
    recvTransport.current?.close()
    socketRef.current?.disconnect()
    setStatus('idle')
    setPeers([])
  }, [])

  // ── Auto-join on mount ───────────────────────────────────────────────────

  useEffect(() => {
    join()
    return () => leave()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return {
    status,
    peers,
    localStream: localStreamRef.current,
    micEnabled,
    camEnabled,
    toggleMic,
    toggleCam,
    leave,
  }
}
