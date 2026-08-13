
export default function QadaSection({ count, onView }: { count: number; onView: () => void }) {
  return (
    <div className="qada">
      <div className="qada-head">
        <div>Qada</div>
        <button className="view-qada" onClick={onView}>View Qada →</button>
      </div>
      <div className="qada-body">{count > 0 ? `You have ${count} prayers to make up.` : `You're all caught up.`}</div>
    </div>
  )
}
