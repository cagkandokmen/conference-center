export default function ControlBar({
  micEnabled, camEnabled,
  onToggleMic, onToggleCam, onLeave,
  ivrActive, ivrLoading, onCallIvr, onHangupIvr,
}) {
  return (
    <div className="control-bar">
      {/* Mic */}
      <button
        id="ctrl-mic"
        className={`ctrl-btn${!micEnabled ? ' ctrl-btn--off' : ''}`}
        onClick={onToggleMic}
        title={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
      >
        {micEnabled ? '🎙️' : '🔇'}
        <span className="ctrl-btn__tooltip">
          {micEnabled ? 'Mute mic' : 'Unmute mic'}
        </span>
      </button>

      {/* Camera */}
      <button
        id="ctrl-cam"
        className={`ctrl-btn${!camEnabled ? ' ctrl-btn--off' : ''}`}
        onClick={onToggleCam}
        title={camEnabled ? 'Stop camera' : 'Start camera'}
      >
        {camEnabled ? '📹' : '🚫'}
        <span className="ctrl-btn__tooltip">
          {camEnabled ? 'Stop camera' : 'Start camera'}
        </span>
      </button>

      {/* IVR Bot */}
      <button
        id="ctrl-ivr"
        className={`ctrl-btn${ivrActive ? ' ctrl-btn--off' : ''}`}
        onClick={ivrActive ? onHangupIvr : onCallIvr}
        disabled={ivrLoading}
        title={ivrActive ? 'Hang up IVR' : 'Call IVR assistant'}
        style={ivrActive ? { borderColor: 'var(--clr-green)', color: 'var(--clr-green)' } : {}}
      >
        {ivrLoading ? '⏳' : ivrActive ? '🤖✕' : '🤖'}
        <span className="ctrl-btn__tooltip">
          {ivrActive ? 'Hang up IVR' : 'Call IVR bot'}
        </span>
      </button>

      {/* Leave */}
      <button
        id="ctrl-leave"
        className="ctrl-btn ctrl-btn--leave"
        onClick={onLeave}
        title="Leave room"
      >
        📵
        <span className="ctrl-btn__tooltip">Leave</span>
      </button>
    </div>
  )
}
