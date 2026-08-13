import Logo from './Logo'

export default function Header({ displayName, onProfile }: { displayName: string; onProfile: () => void }) {
  const today = new Date()
  const formatted = today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <header className="sp-header">
      <div className="sp-header-left">
        <Logo className="header-logo" />
        <div>
          <div className="greet">Assalamu Alaikum</div>
          <div className="date">{formatted}</div>
        </div>
      </div>
      <button className="avatar" onClick={onProfile} aria-label="Open profile">
        {displayName?.charAt(0)?.toUpperCase() || 'U'}
      </button>
    </header>
  )
}
