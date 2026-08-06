import { useState, useEffect, useRef } from 'react'
import { collection, query, orderBy, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'

/**
 * MessageThread
 * Real-time message thread for a commission request.
 *
 * Props:
 *   requestId    – Firestore commissionRequests doc ID
 *   currentUid   – logged-in user's UID
 *   currentName  – display name for sent messages
 *   role         – 'artist' | 'collector'
 */
export default function MessageThread({ requestId, currentUid, currentName, role }) {
  const [messages, setMessages] = useState([])
  const [text,     setText]     = useState('')
  const [sending,  setSending]  = useState(false)
  const bottomRef = useRef(null)

  // ── Real-time listener ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!requestId) return
    const q = query(
      collection(db, 'commissionRequests', requestId, 'messages'),
      orderBy('createdAt', 'asc'),
    )
    return onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    }, () => {}) // silently ignore permission errors on closed threads
  }, [requestId])

  // ── Auto-scroll to latest message ───────────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // ── Send ─────────────────────────────────────────────────────────────────────
  async function send(e) {
    e.preventDefault()
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setSending(true)
    try {
      await addDoc(collection(db, 'commissionRequests', requestId, 'messages'), {
        text:       trimmed,
        senderUid:  currentUid,
        senderName: currentName || 'Unknown',
        role,
        createdAt:  serverTimestamp(),
      })
      setText('')
    } catch (err) {
      console.error('MessageThread send failed:', err)
    } finally {
      setSending(false)
    }
  }

  function fmtTime(ts) {
    if (!ts?.toDate) return ''
    return ts.toDate().toLocaleString('en-US', {
      month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    })
  }

  return (
    <div style={{
      border: '1px solid #e0d8cc',
      background: '#faf8f4',
      marginTop: '10px',
    }}>
      {/* ── Message list ── */}
      <div style={{
        maxHeight: '280px',
        overflowY: 'auto',
        padding: '14px 14px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      }}>
        {messages.length === 0 && (
          <p style={{
            fontFamily: 'monospace', fontSize: '11px',
            color: '#a08060', textAlign: 'center', padding: '16px 0',
          }}>
            No messages yet — start the conversation below.
          </p>
        )}

        {messages.map(msg => {
          const isMe = msg.senderUid === currentUid
          return (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: isMe ? 'flex-end' : 'flex-start',
              }}
            >
              <div style={{
                maxWidth: '82%',
                padding: '8px 12px',
                background: isMe ? '#1a1208' : '#ede7dc',
                color: isMe ? '#f5f2ec' : '#1a1208',
                fontFamily: 'monospace',
                fontSize: '12px',
                lineHeight: '1.65',
                wordBreak: 'break-word',
              }}>
                {msg.text}
              </div>
              <p style={{
                fontFamily: 'monospace', fontSize: '10px',
                color: '#a08060', marginTop: '3px',
                textAlign: isMe ? 'right' : 'left',
              }}>
                {msg.senderName} · {fmtTime(msg.createdAt)}
              </p>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* ── Input ── */}
      <form
        onSubmit={send}
        style={{ display: 'flex', borderTop: '1px solid #e0d8cc' }}
      >
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder="Write a message…"
          disabled={sending}
          style={{
            flex: 1,
            fontFamily: 'monospace',
            fontSize: '12px',
            padding: '10px 12px',
            border: 'none',
            background: 'transparent',
            color: '#1a1208',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          style={{
            fontFamily: 'monospace',
            fontSize: '10px',
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            padding: '10px 16px',
            background: text.trim() && !sending ? '#1a1208' : 'transparent',
            color: text.trim() && !sending ? '#f5f2ec' : '#c0a880',
            border: 'none',
            borderLeft: '1px solid #e0d8cc',
            cursor: text.trim() && !sending ? 'pointer' : 'default',
            transition: 'all 0.15s',
            flexShrink: 0,
          }}
        >
          {sending ? '…' : 'Send →'}
        </button>
      </form>
    </div>
  )
}
