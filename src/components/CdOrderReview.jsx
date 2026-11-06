import { useState } from 'react'
import { arrayUnion, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { dpiQuality } from '../../functions/cdSpecs.mjs'

// Admin, on one CD order: what the customer approved, anything worth a look,
// and a way to contact them — with or without pausing the order. Sending a note
// sets ownerNoteId; onQuoteRequestUpdated emails it to the customer.

const ART_LABEL = { disc: 'Disc', panel0: 'Front', panel1: 'Panel 2', panel2: 'Panel 3', panel3: 'Panel 4', tray: 'Tray card' }
const mono = { fontFamily: 'monospace' }
const when = (t) => {
  const d = t?.toDate ? t.toDate() : (t ? new Date(t) : null)
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
}

export default function CdOrderReview({ order, onPatch }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const flags = Object.entries(order.proofQuality || {}).filter(([, dpi]) => dpiQuality(dpi) !== 'good')
  const onHold = order.status === 'on_hold'
  const locked = order.status === 'pending_payment'

  async function apply(patch, local = patch) {
    setBusy(true); setError('')
    try {
      await updateDoc(doc(db, 'quoteRequests', order.id), patch)
      onPatch(local)
      return true
    } catch (err) {
      setError(err.message || 'Could not save.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function send(hold) {
    const text = note.trim()
    if (!text) return setError('Write a note first.')
    const entry = { text, at: new Date().toISOString(), hold }
    const patch = { ownerNote: text, ownerNoteId: Date.now(), ownerNoteAt: serverTimestamp(), ownerNotes: arrayUnion(entry) }
    if (hold && !onHold) { patch.status = 'on_hold'; patch.statusBeforeHold = order.status }
    const ok = await apply(patch, { ...patch, ownerNoteAt: new Date(), ownerNotes: [...(order.ownerNotes || []), entry] })
    if (ok) setNote('')
  }

  const resume = () => apply({ status: order.statusBeforeHold || 'paid' })

  return (
    <div style={{ border: '1px solid #e8e0d4', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <p style={{ ...mono, fontSize: '11px', margin: 0, color: order.proofApprovedAt ? '#3a7a40' : '#8a857d' }}>
        {order.proofApprovedAt ? `Proof approved by customer ${when(order.proofApprovedAt)}` : order.reorderOf ? 'Reorder of an approved project' : 'No proof approval on file'}
      </p>

      {flags.length > 0 && (
        <p style={{ ...mono, fontSize: '11px', margin: 0, color: '#a06a10', lineHeight: 1.5 }}>
          Check before printing: {flags.map(([k, dpi]) => `${ART_LABEL[k] || k} ${dpi} dpi`).join(', ')}
        </p>
      )}

      {onHold && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <p style={{ ...mono, fontSize: '11px', margin: 0, color: '#b03020', flex: 1, minWidth: '160px' }}>On hold, waiting on the customer.</p>
          <button type="button" onClick={resume} disabled={busy} className="btn-outline text-[10px]">Resume order</button>
        </div>
      )}

      {(order.ownerNotes || []).map(n => (
        <p key={n.at} style={{ ...mono, fontSize: '11px', margin: 0, color: '#6a5a48', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
          <span style={{ color: '#8a857d' }}>{when(n.at)}{n.hold ? ' · held' : ''}:</span> {n.text}
        </p>
      ))}

      <textarea value={note} onChange={e => setNote(e.target.value)} disabled={locked} rows={3}
        placeholder="Spotted a problem? Write to the customer here. They can reply to the email."
        aria-label="Note to the customer"
        className="font-mono text-[12px] px-3 py-2 border border-warm-gray-light bg-transparent" style={{ resize: 'vertical', width: '100%', boxSizing: 'border-box' }} />
      {error && <p role="alert" style={{ ...mono, fontSize: '11px', color: '#b03020', margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => send(false)} disabled={busy || locked} className="btn-outline text-[10px]">Email customer</button>
        {!onHold && (
          <button type="button" onClick={() => send(true)} disabled={busy || locked} className="btn-outline text-[10px]">Email &amp; put on hold</button>
        )}
      </div>
    </div>
  )
}
