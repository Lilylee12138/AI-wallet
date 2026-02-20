import { Navigate, useLocation } from 'react-router-dom'
import { isAuthed } from '../lib/auth'

export default function RequireAuth(props: { children: JSX.Element }) {
  const loc = useLocation()
  if (!isAuthed()) {
    return <Navigate to='/auth' replace state={{ from: loc.pathname }} />
  }
  return props.children
}
