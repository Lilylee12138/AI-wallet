import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'

type ChatMsg = {
  role: 'user' | 'assistant'
  content: string
}

function getFallbackPageInfo(pathname: string) {
  if (pathname.includes('/action/transfer')) {
    return { page: 'transfer', title: 'Send' }
  }

  if (pathname.includes('/action/swap')) {
    return { page: 'swap', title: 'Swap' }
  }

  if (pathname.includes('/proposal') || pathname.includes('/vote')) {
    return { page: 'dao_proposal', title: 'DAO Proposal' }
  }

  if (pathname.includes('/dao')) {
    return { page: 'dao', title: 'Govern' }
  }

  if (pathname.includes('/trade')) {
    return { page: 'trade', title: 'Transfer & Swap' }
  }

  if (pathname.includes('/dashboard') || pathname === '/') {
    return { page: 'dashboard', title: 'Wallet' }
  }

  return { page: 'wallet', title: 'AI Wallet' }
}

function safeParse(raw: string | null) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export default function ChatbotButton() {
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)

  const storageKey = useMemo(() => `wallet_ai_chat_messages:${location.pathname}`, [location.pathname])

  const [messages, setMessages] = useState<ChatMsg[]>([])

  useEffect(() => {
    const saved = safeParse(sessionStorage.getItem(storageKey))
    if (saved && Array.isArray(saved)) {
      setMessages(saved)
    } else {
      setMessages([
        {
          role: 'assistant',
          content: 'Hi, I’m your AI wallet assistant. You can ask me about risk, gas, swap, DAO voting, or wallet operations.'
        }
      ])
    }
  }, [storageKey])

  useEffect(() => {
    sessionStorage.setItem(storageKey, JSON.stringify(messages))
  }, [storageKey, messages])

  function getActiveContext() {
    const fallback = getFallbackPageInfo(location.pathname)
    const saved = safeParse(sessionStorage.getItem('wallet_ai_context'))

    if (saved && saved.path === location.pathname) {
      return {
        page: saved.page || fallback.page,
        title: saved.title || fallback.title,
        context: saved.context || {}
      }
    }

    return {
      page: fallback.page,
      title: fallback.title,
      context: {
        pageTitle: fallback.title,
        pathname: location.pathname,
        pageHint:
          fallback.page === 'dao'
            ? 'This is the DAO proposal list page.'
            : fallback.page === 'dao_proposal'
            ? 'This is a DAO proposal detail page.'
            : fallback.page === 'transfer'
            ? 'This is the transfer action page.'
            : fallback.page === 'swap'
            ? 'This is the swap action page.'
            : fallback.page === 'trade'
            ? 'This is the trade overview page.'
            : fallback.page === 'dashboard'
            ? 'This is the wallet dashboard page.'
            : 'This is an AI smart wallet page.'
      }
    }
  }

  async function sendMessage() {
    const text = input.trim()
    if (!text || sending) return

    const userMsg: ChatMsg = { role: 'user', content: text }
    const nextMessages = [...messages, userMsg]

    setMessages(nextMessages)
    setInput('')
    setSending(true)

    try {
      const active = getActiveContext()

      const r = await fetch('http://127.0.0.1:8787/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          page: active.page,
          context: active.context,
          history: messages.slice(-8)
        })
      })

      const j = await r.json()
      if (!r.ok) throw new Error(j?.detail || j?.error || 'llm chat error')

      const reply = j?.reply || 'Sorry, I do not have a response right now.'
      setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: `I ran into a problem while answering: ${e?.message || String(e)}`
        }
      ])
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {open && (
        <div
          style={{
            position: 'fixed',
            right: 18,
            bottom: 110,
            width: 'min(380px, calc(100vw - 32px))',
            height: 460,
            borderRadius: 22,
            border: '1px solid rgba(255,255,255,.10)',
            background: 'rgba(5,15,40,.96)',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 20px 60px rgba(0,0,0,.35)',
            zIndex: 60,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          <div
            style={{
              padding: '14px 16px',
              borderBottom: '1px solid rgba(255,255,255,.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between'
            }}
          >
            <div>
              <div style={{ fontWeight: 800, fontSize: 18 }}>AI Assistant</div>
              <div style={{ fontSize: 12, opacity: 0.72 }}>
                Context-aware wallet guidance
              </div>
            </div>

            <button
              className='btn btnGhost'
              style={{ minWidth: 0, padding: '8px 12px' }}
              onClick={() => setOpen(false)}
            >
              Close
            </button>
          </div>

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 14,
              display: 'flex',
              flexDirection: 'column',
              gap: 10
            }}
          >
            {messages.map((msg, idx) => (
              <div
                key={idx}
                style={{
                  alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: '86%',
                  padding: '12px 14px',
                  borderRadius: 16,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap',
                  background:
                    msg.role === 'user'
                      ? 'rgba(88,166,255,.16)'
                      : 'rgba(255,255,255,.06)',
                  border: '1px solid rgba(255,255,255,.06)'
                }}
              >
                {msg.content}
              </div>
            ))}

            {sending && (
              <div
                style={{
                  alignSelf: 'flex-start',
                  maxWidth: '86%',
                  padding: '12px 14px',
                  borderRadius: 16,
                  lineHeight: 1.6,
                  background: 'rgba(255,255,255,.06)',
                  border: '1px solid rgba(255,255,255,.06)',
                  opacity: 0.8
                }}
              >
                Thinking…
              </div>
            )}
          </div>

          <div
            style={{
              borderTop: '1px solid rgba(255,255,255,.08)',
              padding: 12,
              display: 'flex',
              gap: 10
            }}
          >
            <input
              className='input'
              placeholder='Ask about risk, gas, swap, DAO...'
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') sendMessage()
              }}
              style={{ flex: 1, margin: 0 }}
            />
            <button
              className='btn btnPrimary'
              onClick={sendMessage}
              disabled={sending || !input.trim()}
              style={{ minWidth: 88 }}
            >
              Send
            </button>
          </div>
        </div>
      )}

      <button
        className='chatbot'
        onClick={() => setOpen((v) => !v)}
        title='AI Assistant'
      >
        AI
      </button>
    </>
  )
}