import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import './styles/theme.css'

import RequireAuth from './components/RequireAuth'

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

        <Route path='/dashboard' element={<RequireAuth><Dashboard /></RequireAuth>} />
        <Route path='/trade' element={<RequireAuth><Trade /></RequireAuth>} />
        <Route path='/dao' element={<RequireAuth><Dao /></RequireAuth>} />
        <Route path='/dao/:id' element={<RequireAuth><DaoProposal /></RequireAuth>} />
        <Route path='/settings' element={<RequireAuth><Settings /></RequireAuth>} />

        <Route path='/action/transfer' element={<RequireAuth><ActionTransfer /></RequireAuth>} />
        <Route path='/action/swap' element={<RequireAuth><ActionSwap /></RequireAuth>} />
        <Route path='/action/vote/:id' element={<RequireAuth><ActionVote /></RequireAuth>} />
      </Routes>
    </BrowserRouter>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>
)
