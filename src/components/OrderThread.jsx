import { useState, useEffect } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '../lib/firebase'
import MessageThread from './MessageThread'

/**
 * Buyer ↔ shop conversation attached to an order.
 *
 * Collapsed by default so it doesn't bury the order list, but shows a live
 * message count so a reply from the shop is noticeable without opening it.
 * Wraps the same MessageThread used for commissions, pointed at
 * orders/{id}/messages.
 */
export default function OrderThread({ order, user, profile }) {
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)

  // Light listener just for the count — cheap, and it means an unopened thread
  // still signals that the shop replied.
  useEffect(() => {
    if (!order?.id) return
    return onSnapshot(
      collection(db, 'orders', order.id, 'messages'),
      snap => setCount(snap.size),
      () => {},   // closed/denied threads simply show nothing
    )
  }, [order?.id])

  if (!user) return null

  const isShop = user.email === 'zionomari@artsaturated.com'

  return (
    <div style={{ marginTop: '10px' }}>
      <button
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.06em',
          color: count > 0 ? 'rgb(var(--color-ink))' : 'rgb(var(--color-warm-gray))',
          textDecoration: 'underline',
        }}
      >
        {open ? 'Hide messages' : count > 0 ? `Messages (${count})` : 'Message us about this order'}
      </button>

      {open && (
        <div style={{ marginTop: '10px', border: '1px solid #e8e0d4', padding: '10px' }}>
          <MessageThread
            parentCollection="orders"
            requestId={order.id}
            currentUid={user.uid}
            currentName={profile?.name || user.displayName || user.email}
            role={isShop ? 'shop' : 'buyer'}
          />
        </div>
      )}
    </div>
  )
}
