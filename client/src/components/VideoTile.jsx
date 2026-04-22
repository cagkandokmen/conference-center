import { useEffect, useRef } from 'react'

export default function VideoTile({ stream, displayName, isLocal = false, muted = false }) {
  const videoRef = useRef(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !stream) return
    video.srcObject = stream
  }, [stream])

  const initials = displayName
    ? displayName.slice(0, 2).toUpperCase()
    : '??'

  const hasVideo = stream && stream.getVideoTracks().length > 0

  return (
    <div className={`video-tile${isLocal ? ' video-tile--local' : ''}`}>
      {/* Avatar shown when no video track */}
      {!hasVideo && (
        <div className="video-tile__avatar">{initials}</div>
      )}

      {/* Video element — always rendered so srcObject can be set */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal || muted}
        style={{ display: hasVideo ? 'block' : 'none' }}
      />

      {/* Name + badge overlay */}
      <div className="video-tile__info">
        <span className="video-tile__name">
          {displayName || 'Anonymous'}
        </span>
        {isLocal && <span className="video-tile__badge">You</span>}
      </div>
    </div>
  )
}
