
export default function StreakCard({
  days,
  completedToday,
  onOpen,
}: {
  days: number
  completedToday: number
  onOpen: () => void
}) {
  const unlocked = days > 0
  const onTrackToday = completedToday >= 5

  return (
    <button type="button" className="streak-card streak-card-btn" onClick={onOpen}>
      <div className="streak-emoji">🔥</div>
      <div className="streak-main">
        <div className="streak-num">{unlocked ? days : '-'}</div>
        <div className="streak-label">{unlocked ? 'Day Streak' : 'Start your journey'}</div>
      </div>
      <div className="streak-sub">
        {onTrackToday
          ? 'All five prayers done today — streak safe until Fajr.'
          : unlocked
            ? `${completedToday}/5 today — complete all before Fajr to keep your streak.`
            : 'Complete all five prayers before Fajr to begin your streak.'}
      </div>
      {unlocked && <div className="streak-note">Tap to view your progress</div>}
    </button>
  )
}
