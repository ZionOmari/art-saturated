import { useState, useEffect } from 'react'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { shippingRequest } from '../lib/shipping'
import Spinner from './Spinner'

// Artists who list their own work ship it themselves. Their return address
// lives at users/{uid}/private/shipping — NOT on the profile document, which is
// public for anyone in Discover Artists.

const box = { border: '1px solid #e8e0d4', padding: '16px' }
const inp = {
  width: '100%', fontFamily: 'monospace', fontSize: '13px', padding: '9px 11px',
  border: '1px solid #c5bfb5', background: 'transparent', color: 'rgb(var(--color-ink))', boxSizing: 'border-box',
}
const label = { fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgb(var(--color-ink))', margin: 0 }
const note = { fontFamily: 'monospace', fontSize: '12px', color: '#5a3820', lineHeight: 1.6 }

const EMPTY = { name: '', street1: '', street2: '', city: '', state: '', zip: '', phone: '' }
const REQUIRED = ['name', 'street1', 'city', 'state', 'zip']

export function useArtistShipFrom(uid) {
  const [addr, setAddr] = useState(null)   // null = loading
  useEffect(() => {
    if (!uid) return
    getDoc(doc(db, 'users', uid, 'private', 'shipping'))
      .then(s => setAddr({ ...EMPTY, ...(s.exists() ? s.data().shipFrom : {}) }))
      .catch(() => setAddr({ ...EMPTY }))
  }, [uid])
  return [addr, setAddr]
}

// Account → Artist Profile → Shipping
export function ArtistReturnAddress({ uid }) {
  const [addr, setAddr] = useArtistShipFrom(uid)
  const [state, setState] = useState('')   // '' | 'saving' | 'saved' | error text

  if (!addr) return <Spinner />
  const complete = REQUIRED.every(k => String(addr[k] || '').trim())

  async function save() {
    if (!complete) { setState('Fill in name, street, city, state and ZIP.'); return }
    setState('saving')
    try {
      const shipFrom = Object.fromEntries(Object.entries(addr).map(([k, v]) => [k, String(v || '').trim()]))
      shipFrom.state = shipFrom.state.toUpperCase()
      await setDoc(doc(db, 'users', uid, 'private', 'shipping'), { shipFrom, updatedAt: serverTimestamp() })
      setState('saved')
      setTimeout(() => setState(''), 2500)
    } catch (e) { setState('Couldn’t save: ' + (e.code || e.message)) }
  }

  const f = (k, ph, extra = {}) => (
    <input style={inp} placeholder={ph} value={addr[k]} {...extra}
      onChange={e => setAddr(a => ({ ...a, [k]: e.target.value }))} />
  )

  return (
    <div>
      <p style={{ ...label, marginBottom: '10px' }}>Shipping — your return address</p>
      <p style={{ ...note, marginBottom: '14px' }}>
        You ship the pieces you list. When one sells you'll get an email, and you buy and print the label
        from your sales below — postage is covered by what the buyer paid. This address goes on your labels
        and is used to price shipping. It's private: never shown on your profile.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '480px' }}>
        {f('name', 'Name')}
        {f('street1', 'Street address')}
        {f('street2', 'Apt / suite (optional)')}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 100px', gap: '8px' }}>
          {f('city', 'City')}
          {f('state', 'State', { maxLength: 2 })}
          {f('zip', 'ZIP', { inputMode: 'numeric' })}
        </div>
        {f('phone', 'Phone (for the carrier, optional)', { type: 'tel' })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '12px' }}>
        <button onClick={save} disabled={state === 'saving'} className="btn-outline">
          {state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved ✓' : 'Save return address'}
        </button>
        {state && !['saving', 'saved'].includes(state) && <span style={{ ...note, color: '#a04020' }}>{state}</span>}
      </div>
    </div>
  )
}

// One sale in the artist's dashboard: their package on the order, where it
// goes, and the label button. Renders nothing if this artist ships nothing.
export function ArtistShipmentPanel({ order, uid, onShipped }) {
  const s = (order.shipments || []).find(x => x.from === uid)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!s) return null

  const a = order.shippingAddress || {}
  const paid = order.paymentStatus === 'paid'

  async function buy() {
    if (!window.confirm(`Buy a ${s.carrier} ${s.service} label for this package?`)) return
    setBusy(true); setErr('')
    try {
      const r = await shippingRequest({ action: 'buy_label', kind: 'artist', orderId: order.id })
      onShipped?.(order.id, { ...s, status: 'shipped', trackingNumber: r.trackingNumber, labelUrl: r.labelUrl })
      if (r.labelUrl) window.open(r.labelUrl, '_blank', 'noopener')
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div style={{ ...box, marginTop: '10px', background: 'rgba(160,128,96,0.05)' }}>
      <p style={{ ...label, fontSize: '10px', marginBottom: '6px' }}>You ship this</p>
      <p style={{ ...note, margin: '0 0 8px' }}>
        {a.name}<br />
        {[a.street1, a.street2].filter(Boolean).join(', ')}<br />
        {a.city}, {a.state} {a.zip}
      </p>
      <p style={{ ...note, margin: '0 0 10px' }}>Buyer paid for: {s.carrier} {s.service}</p>

      {s.labelUrl ? (
        <p style={{ ...note, margin: 0 }}>
          ✓ Label bought · {s.carrier} {s.trackingNumber}{' '}
          <a href={s.labelUrl} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>Print label</a>
        </p>
      ) : !paid ? (
        <p style={{ ...note, margin: 0 }}>Waiting for payment — don't ship yet.</p>
      ) : (
        <button onClick={buy} disabled={busy} className="btn-outline">
          {busy ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}><Spinner />Buying label…</span> : 'Buy & print label'}
        </button>
      )}
      {err && <p style={{ ...note, color: '#a04020', margin: '8px 0 0' }}>{err}</p>}
    </div>
  )
}
