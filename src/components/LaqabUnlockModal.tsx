import type { LaqabUnlock } from '../lib/prayerActions'

export default function LaqabUnlockModal({ laqab, onClose }: { laqab: LaqabUnlock; onClose: () => void }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal laqab-unlock-modal" onClick={(e) => e.stopPropagation()}>
        <div className="laqab-unlock-body">
          <div className="laqab-unlock-icon">🤍</div>
          <h2>Alhamdulillah</h2>
          <p className="muted">New Laqab Unlocked</p>
          <h3>{laqab.name}</h3>
          {laqab.meaning && <p className="muted">{laqab.meaning}</p>}
          <p className="laqab-unlock-meta">{laqab.requirement_days} days of consistency</p>
          <button type="button" className="madeup" onClick={onClose}>Continue</button>
        </div>
      </div>
    </div>
  )
}
