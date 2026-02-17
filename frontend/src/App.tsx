import { Link, Route, Routes } from 'react-router-dom'
import CounterPage from './pages/CounterPage'
import DaoPage from './pages/DaoPage'

export default function App (): JSX.Element {
  return (
    <div>
      <div style={{ padding: 12, borderBottom: '1px solid #eee', fontFamily: 'system-ui' }}>
        <Link to='/' style={{ marginRight: 12 }}>Wallet</Link>
        <Link to='/dao'>DAO</Link>
      </div>

      <Routes>
        <Route path='/' element={<CounterPage />} />
        <Route path='/dao' element={<DaoPage />} />
      </Routes>
    </div>
  )
}
