import { NavLink } from 'react-router-dom'

export default function BottomNav() {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : undefined)}>
        <span className="nav-icon" aria-hidden>🏠</span>
        <span>Today</span>
      </NavLink>
      <NavLink to="/qada" className={({ isActive }) => (isActive ? 'active' : undefined)}>
        <span className="nav-icon" aria-hidden>📿</span>
        <span>Qada</span>
      </NavLink>
      <NavLink to="/progress" className={({ isActive }) => (isActive ? 'active' : undefined)}>
        <span className="nav-icon" aria-hidden>📊</span>
        <span>Progress</span>
      </NavLink>
      <NavLink to="/laqabs" className={({ isActive }) => (isActive ? 'active' : undefined)}>
        <span className="nav-icon" aria-hidden>🏆</span>
        <span>Laqabs</span>
      </NavLink>
    </nav>
  )
}
