import type { MissedAlert } from '../hooks/useTodayPrayers'

export default function MissedPrayerBanner({
  alert,
  onDismiss,
  onViewQada,
}: {
  alert: MissedAlert
  onDismiss: () => void
  onViewQada: () => void
}) {
  const label =
    alert.names.length === 1
      ? `${alert.names[0]} was missed`
      : `${alert.names.slice(0, -1).join(', ')} and ${alert.names.at(-1)} were missed`

  return (
    <div className="missed-banner" role="alert">
      <div className="missed-banner-text">
        <strong>{label}</strong>
        <span className="muted"> — added to Qada</span>
      </div>
      <div className="missed-banner-actions">
        <button type="button" className="view-qada" onClick={onViewQada}>View Qada</button>
        <button type="button" className="missed-dismiss" onClick={onDismiss} aria-label="Dismiss">×</button>
      </div>
    </div>
  )
}
