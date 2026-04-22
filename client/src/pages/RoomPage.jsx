import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import { useMediasoup } from '../hooks/useMediasoup'
import VideoTile from '../components/VideoTile'
import ControlBar from '../components/ControlBar'

const IVR_URL = import.meta.env.VITE_IVR_URL || 'http://localhost:3002'

export default function RoomPage() {
  const { roomId } = useParams()
  const { state } = useLocation()
  const navigate = useNavigate()
  const localVideoRef = useRef(null)

  const displayName = state?.displayName || 'Anonymous'

  const {
    status,
    peers,
    localStream,
    micEnabled,
    camEnabled,
    toggleMic,
    toggleCam,
    leave,
  } = useMediasoup({ roomId, displayName })

  // Wire local stream into local <video>
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream
    }
  }, [localStream])

  // Derived state: IVR is active if there's a bot in the room
  const ivrActive = peers.some(p => p.id.startsWith('bot-') || p.displayName === 'IVR Bot')
  const [ivrLoading, setIvrLoading] = useState(false)

  function handleLeave() {
    // Also hang up IVR if active
    if (ivrActive) fetch(`${IVR_URL}/leave`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId }),
    }).catch(() => { })
    leave()
    navigate('/')
  }

  const callIvr = useCallback(async () => {
    setIvrLoading(true)
    try {
      const res = await fetch(`${IVR_URL}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId }),
      })
      if (!res.ok) throw new Error(await res.text())
      // ivrActive is now derived from peers automatically
    } catch (err) {
      alert(`IVR error: ${err.message}`)
    } finally {
      setIvrLoading(false)
    }
  }, [roomId])

  const hangupIvr = useCallback(async () => {
    setIvrLoading(true)
    try {
      await fetch(`${IVR_URL}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId }),
      })
      // ivrActive is now derived from peers automatically
    } catch (err) {
      console.error('IVR hangup error:', err)
    } finally {
      setIvrLoading(false)
    }
  }, [roomId])

  // Grid count = local + remote peers
  const totalCount = 1 + peers.length

  if (status === 'connecting' || status === 'idle') {
    return (
      <div className="room__connecting">
        <div className="spinner" />
        <p style={{ color: 'var(--clr-text-muted)', fontSize: 14 }}>
          Joining <strong style={{ color: 'var(--clr-text)' }}>{roomId}</strong>…
        </p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="room__connecting">
        <p style={{ fontSize: 28 }}>⚠️</p>
        <p style={{ color: 'var(--clr-red)', fontSize: 15 }}>
          Failed to connect to the signal server.
        </p>
        <p style={{ color: 'var(--clr-text-muted)', fontSize: 13 }}>
          Make sure <code>signal-service</code> is running on port 3001.
        </p>
        <button className="btn-primary" style={{ width: 'auto', padding: '10px 24px', marginTop: 16 }} onClick={() => navigate('/')}>
          ← Back to lobby
        </button>
      </div>
    )
  }

  return (
    <div className="room">
      {/* Header */}
      <header className="room__header">
        <div className="room__header-left">
          <span className="room__brand">🎥 Cagkan Video</span>
          <span className="room__id-badge">#{roomId}</span>
        </div>
        <div className="room__peer-count">
          <span className="room__peer-dot" />
          {totalCount} participant{totalCount !== 1 ? 's' : ''}
        </div>
      </header>

      {/* Video Grid */}
      <div className="room__grid-wrap">
        <div
          className="room__grid"
          data-count={Math.min(totalCount, 9)}
        >
          {/* Local tile */}
          <VideoTile
            stream={localStream}
            displayName={displayName}
            isLocal
          />

          {/* Remote peers */}
          {peers.map(peer => (
            <VideoTile
              key={peer.id}
              stream={peer.stream}
              displayName={peer.displayName}
            />
          ))}
        </div>
      </div>

      {/* Control bar */}
      <ControlBar
        micEnabled={micEnabled}
        camEnabled={camEnabled}
        onToggleMic={toggleMic}
        onToggleCam={toggleCam}
        onLeave={handleLeave}
        ivrActive={ivrActive}
        ivrLoading={ivrLoading}
        onCallIvr={callIvr}
        onHangupIvr={hangupIvr}
      />
    </div>
  )
}
