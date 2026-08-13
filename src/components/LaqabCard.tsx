
export default function LaqabCard({
  name,
  daysNeeded,
  daysRemaining,
  progress,
  onOpen,
}: {
  name: string
  daysNeeded: number
  daysRemaining: number
  progress: number
  onOpen?: () => void
}) {
  return (
    <button type="button" className="laqab-card laqab-card-btn" onClick={onOpen}>
      <div className="laqab-left">🔒</div>
      <div className="laqab-main">
        <div className="laqab-name">{name}</div>
        <div className="laqab-meta">{daysNeeded}-day streak • {daysRemaining} days remaining</div>
      </div>
      <div className="laqab-progress">
        <div className="laqab-bar-outer"><div className="laqab-bar-inner" style={{ width: `${progress}%` }} /></div>
      </div>
    </button>
  )
}
