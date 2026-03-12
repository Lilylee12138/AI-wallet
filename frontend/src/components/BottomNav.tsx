import { NavLink } from 'react-router-dom'

export default function BottomNav() {
  return (
    <div className='nav'>
      <NavLink to='/dashboard' className={({ isActive }) => (isActive ? 'active' : '')}>Wallet</NavLink>
      <NavLink to='/trade' className={({ isActive }) => (isActive ? 'active' : '')}>Trade</NavLink>
      <NavLink to='/dao' className={({ isActive }) => (isActive ? 'active' : '')}>Govern</NavLink>
      <NavLink to='/settings' className={({ isActive }) => (isActive ? 'active' : '')}>Settings</NavLink>
    </div>
  )
}
