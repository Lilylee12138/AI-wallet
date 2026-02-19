import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './styles/theme.css'

import Auth from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Trade from './pages/Trade'
import Dao from './pages/Dao'
import DaoProposal from './pages/DaoProposal'
import Settings from './pages/Settings'

import ActionTransfer from './pages/action/Transfer'
import ActionSwap from './pages/action/Swap'
import ActionVote from './pages/action/Vote'

function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path='/' element={<Navigate to='/auth' replace />} />
        <Route path='/auth' element={<Auth />} />
        <Route path='/dashboard' element={<Dashboard />} />
        <Route path='/trade' element={<Trade />} />
        <Route path='/dao' element={<Dao />} />
        <Route path='/dao/:id' element={<DaoProposal />} />
        <Route path='/action/transfer' element={<ActionTransfer />} />
        <Route path='/action/swap' element={<ActionSwap />} />
        <Route path='/action/vote/:id' element={<ActionVote />} />
        <Route path='/settings' element={<Settings />} />
      </Routes>
    </BrowserRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>
)
