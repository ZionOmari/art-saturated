import { useState, useEffect } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import Spinner from './Spinner'


export default function FeedbackBubble() {
  const { user, profile } = useAuth()
  const [open,      setOpen]      = useState(false)
  const [type,      setType]      = useState(null)   // 'bug' | 'suggestion'
  const [message,   setMessage]   = useState('')
  const [email,     setEmail]     = useState(user?.email || '')
  const [submitted, setSubmitted] = useState(false)
  const [busy,      setBusy]      = useState(false)

  // Other pages open the bubble as an inquiry (e.g. shipping outside the US):
  // window.dispatchEvent(new CustomEvent('as:inquiry', { detail: { message } }))
  useEffect(() => {
    function onInquiry(e) {
      setOpen(true)
      setType('inquiry')
      setMessage(e.detail?.message || '')
      setSubmitted(false)
    }
    window.addEventListener('as:inquiry', onInquiry)
    return () => window.removeEventListener('as:inquiry', onInquiry)
  }, [])

  function handleOpen() {
    setOpen(o => !o)
    setType(null)
    setMessage('')
    setSubmitted(false)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!message.trim()) return
    setBusy(true)
    try {
      await addDoc(collection(db, 'feedback'), {
        type,
        message:   message.trim(),
        email:     email.trim() || user?.email || 'anonymous',
        name:      profile?.name || user?.displayName || 'anonymous',
        uid:       user?.uid || null,
        createdAt: serverTimestamp(),
        status:    'new',
      })
      setSubmitted(true)
    } catch (err) {
      console.error(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {/* ── Floating bubble ──────────────────────────────────── */}
      <button
        onClick={handleOpen}
        aria-label="Feedback"
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          zIndex: 999,
          width: '48px',
          height: '48px',
          borderRadius: '50%',
          background: '#1a1208',
          border: '1px solid rgba(255,255,255,0.15)',
          color: '#f2ebe0',
          fontSize: '20px',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
          transition: 'transform 0.2s',
          transform: open ? 'rotate(45deg)' : 'none',
        }}
      >
        {open ? '✕' : '?'}
      </button>

      {/* ── Pop-up window ─────────────────────────────────────── */}
      {open && (
        <div style={{
          position: 'fixed',
          bottom: '84px',
          right: '24px',
          zIndex: 998,
          width: '300px',
          background: '#faf8f4',
          border: '1px solid #d4c9bb',
          boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
          padding: '20px',
        }}>

          {submitted ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <p style={{ fontFamily: 'serif', fontSize: '1.1rem', color: '#1a1208', marginBottom: '6px' }}>
                {type === 'bug' ? 'Bug reported.' : type === 'inquiry' ? 'Message sent.' : 'Suggestion sent.'}
              </p>
              <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a' }}>
                {type === 'inquiry' ? "Thanks — we'll email you back." : "Thanks — we'll look into it."}
              </p>
            </div>
          ) : !type ? (
            <>
              <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a5c3a', marginBottom: '14px' }}>
                What's up?
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  onClick={() => setType('bug')}
                  style={{
                    flex: 1, fontFamily: 'monospace', fontSize: '11px',
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    padding: '12px', border: '1px solid #d4c9bb',
                    background: 'transparent', cursor: 'pointer', color: '#1a1208',
                    transition: 'all 0.18s',
                  }}
                  onMouseEnter={e => { e.target.style.background = '#1a1208'; e.target.style.color = '#f2ebe0' }}
                  onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = '#1a1208' }}
                >
                  🐛 Report a Bug
                </button>
                <button
                  onClick={() => setType('suggestion')}
                  style={{
                    flex: 1, fontFamily: 'monospace', fontSize: '11px',
                    letterSpacing: '0.1em', textTransform: 'uppercase',
                    padding: '12px', border: '1px solid #d4c9bb',
                    background: 'transparent', cursor: 'pointer', color: '#1a1208',
                    transition: 'all 0.18s',
                  }}
                  onMouseEnter={e => { e.target.style.background = '#1a1208'; e.target.style.color = '#f2ebe0' }}
                  onMouseLeave={e => { e.target.style.background = 'transparent'; e.target.style.color = '#1a1208' }}
                >
                  💡 Suggestion
                </button>
              </div>
            </>
          ) : (
            <form onSubmit={handleSubmit}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                <button
                  type="button"
                  onClick={() => setType(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', padding: 0 }}
                >
                  ←
                </button>
                <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#1a1208', margin: 0 }}>
                  {type === 'bug' ? '🐛 Report a Bug' : type === 'inquiry' ? '✉ Message Us' : '💡 Send a Suggestion'}
                </p>
              </div>

              {!user && (
                <input
                  type="email"
                  placeholder={type === 'inquiry' ? 'Your email (so we can reply)' : 'Your email (optional)'}
                  required={type === 'inquiry'}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  style={{
                    width: '100%', fontFamily: 'monospace', fontSize: '12px',
                    padding: '10px 12px', border: '1px solid #d4c9bb',
                    background: '#fff', color: '#1a1208', outline: 'none',
                    boxSizing: 'border-box', marginBottom: '10px',
                  }}
                />
              )}

              <textarea
                placeholder={type === 'bug'
                  ? 'What happened? Where on the site?'
                  : type === 'inquiry' ? 'Your country, what you want to order, and any questions'
                  : 'What would make this better?'}
                value={message}
                onChange={e => setMessage(e.target.value)}
                required
                style={{
                  width: '100%', fontFamily: 'monospace', fontSize: '12px',
                  padding: '10px 12px', border: '1px solid #d4c9bb',
                  background: '#fff', color: '#1a1208', outline: 'none',
                  boxSizing: 'border-box', minHeight: '90px',
                  resize: 'vertical', marginBottom: '10px',
                }}
              />

              <button
                type="submit"
                disabled={busy || !message.trim()}
                style={{
                  width: '100%', fontFamily: 'monospace', fontSize: '11px',
                  letterSpacing: '0.12em', textTransform: 'uppercase',
                  padding: '11px', border: '1px solid #1a1208',
                  background: busy ? '#d4c9bb' : '#1a1208',
                  color: '#f2ebe0', cursor: busy ? 'not-allowed' : 'pointer',
                  transition: 'all 0.18s',
                }}
              >
                {busy ? <span className="flex items-center justify-center gap-2"><Spinner />Sending…</span> : 'Send'}
              </button>
            </form>
          )}
        </div>
      )}
    </>
  )
}
