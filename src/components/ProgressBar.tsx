
export default function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total ? Math.round((completed / total) * 100) : 0
  return (
    <div className="progress">
      <div className="progress-head">
        <div>Today's Progress</div>
        <div>{completed} / {total} Prayers</div>
      </div>
      <div className="progress-bar-outer">
        <div className="progress-bar-inner" style={{ width: `${pct}%` }} />
      </div>
      {pct === 100 && <div className="progress-done">Alhamdulillah — all prayers completed.</div>}
    </div>
  )
}
