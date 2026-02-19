import { Link, Route, Routes } from 'react-router-dom'
import App from './App'
import DaoPage from './pages/DaoPage'

export default function Root () {
  return (
    <div style={{ maxWidth: 900, margin: '20px auto', fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <Link to="/">Wallet</Link>
        <Link to="/dao">DAO</Link>
      </div>

      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/dao" element={<DaoPage />} />
      </Routes>
    </div>
  )
}
