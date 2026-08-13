
export type Prayer = { key: string; name: string; time: string; status: 'completed' | 'upcoming' | 'current' | 'missed' }

function StatusIcon({ status }: { status: Prayer['status'] }) {
  if (status === 'completed') return <span className="icon done">✓</span>
  if (status === 'missed') return <span className="icon missed">!</span>
  if (status === 'current') return <span className="icon current">●</span>
  return <span className="icon upcoming">○</span>
}

export default function PrayerList({ prayers, onTap }: { prayers: Prayer[]; onTap: (p: Prayer) => void }) {
  return (
    <section className="prayer-list">
      <h3>Today's Salah</h3>
      <div className="list">
        {prayers.map((p) => (
          <button key={p.key} className={`prayer-card ${p.status}`} onClick={() => onTap(p)}>
            <div>
              <div className="p-name">{p.name}</div>
              <div className="p-time">{p.time}</div>
            </div>
            <div className="p-status"><StatusIcon status={p.status} /></div>
          </button>
        ))}
      </div>
    </section>
  )
}
