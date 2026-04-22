import { useState, useId } from 'react'
import { useNavigate } from 'react-router-dom'

export default function LobbyPage() {
  const [displayName, setDisplayName] = useState('')
  const [roomId, setRoomId] = useState('')
  const navigate = useNavigate()
  const nameId = useId()
  const roomIdId = useId()

  function generateRoomId() {
    return Math.random().toString(36).slice(2, 8).toUpperCase()
  }

  function handleJoin(e) {
    e.preventDefault()
    const name = displayName.trim()
    const room = roomId.trim() || generateRoomId()
    if (!name) return
    // Pass displayName through location state
    navigate(`/room/${room}`, { state: { displayName: name } })
  }

  return (
    <div className="lobby">
      <div className="lobby__card">
        <div className="lobby__logo">
          <div className="lobby__logo-icon">🎥</div>
          <span className="lobby__logo-text">Cagkan Video</span>
        </div>

        <h1 className="lobby__title">Join a room</h1>
        <p className="lobby__subtitle">
          Start or join a real-time video conference — no account needed.
        </p>

        <form onSubmit={handleJoin}>
          <div className="form-group">
            <label htmlFor={nameId}>Your name</label>
            <input
              id={nameId}
              type="text"
              placeholder="e.g. Alice"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              autoFocus
              autoComplete="off"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor={roomIdId}>Room ID (optional)</label>
            <input
              id={roomIdId}
              type="text"
              placeholder="Leave blank to create a new room"
              value={roomId}
              onChange={e => setRoomId(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </div>

          <button
            className="btn-primary"
            type="submit"
            disabled={!displayName.trim()}
          >
            Join Room →
          </button>
        </form>
      </div>
    </div>
  )
}
