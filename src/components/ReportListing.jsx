import { useState } from 'react'
import { reportListing } from '../data/storage'
import { useAuth } from '../context/AuthContext'

const REASONS = [
  "Not the seller's own work",
  'Stolen or misused photos',
  'Counterfeit or misrepresented',
  'Prohibited or unsafe item',
  'Never shipped / seller unreachable',
  'Something else',
]

/**
 * Report a listing.
 *
 * Sellers publish straight to the shop with no approval step, so this is one of
 * the two things that catch a bad listing (the other is the owner's review
 * queue). Open to signed-out visitors on purpose: whoever recognises their own
 * stolen photo is rarely the one with an account here.
 */
export default function ReportListing({ product }) {
  const { user } = useAuth()
  const [open,   setOpen]   = useState(false)
  const [reason, setReason] = useState('')
  const [note,   setNote]   = useState('')
  const [email,  setEmail]  = useState('')
  const [busy,   setBusy]   = useState(false)
  const [done,   setDone]   = useState(false)
  const [error,  setError]  = useState('')

  if (done) {
    return (
      <p className="font-mono text-[10px] text-warm-gray mt-4 pt-4" style={{ borderTop: '1px solid #e8ddd0' }}>
        Reported. Thank you — Art Saturated will take a look.
      </p>
    )
  }

  if (!open) {
    return (
      <div className="mt-4 pt-4" style={{ borderTop: '1px solid #e8ddd0' }}>
        <button
          onClick={() => setOpen(true)}
          className="font-mono text-[10px] text-warm-gray hover:text-ink bg-transparent border-0 p-0 cursor-pointer"
        >
          ⚐ Report this listing
        </button>
      </div>
    )
  }

  async function submit() {
    if (!reason) { setError('Pick a reason.'); return }
    setBusy(true)
    setError('')
    try {
      await reportListing({
        productId:     product.id,
        productName:   product.name,
        reason,
        note,
        reporterEmail: user?.email || email,
        reporterUid:   user?.uid || null,
      })
      setDone(true)
    } catch (err) {
      console.error('report failed:', err)
      setError('Could not send the report — try again.')
      setBusy(false)
    }
  }

  const field = {
    width: '100%', padding: '8px 10px', fontFamily: 'monospace', fontSize: '12px',
    border: '1px solid rgb(var(--color-warm-gray-light))', background: 'transparent',
    color: 'rgb(var(--color-ink))',
  }

  return (
    <div className="mt-4 pt-4 flex flex-col gap-2" style={{ borderTop: '1px solid #e8ddd0' }}>
      <p className="eyebrow">Report this listing</p>

      <select style={field} value={reason} onChange={e => setReason(e.target.value)} aria-label="Reason">
        <option value="">— Reason —</option>
        {REASONS.map(r => <option key={r} value={r}>{r}</option>)}
      </select>

      <textarea
        style={{ ...field, resize: 'none' }}
        rows={3}
        value={note}
        maxLength={1000}
        onChange={e => setNote(e.target.value)}
        placeholder="Anything that would help (optional)"
      />

      {!user && (
        <input
          style={field}
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="Your email (optional — only if you want a reply)"
        />
      )}

      {error && <p className="font-mono text-[11px]" style={{ color: '#b94040' }}>{error}</p>}

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={busy}
          className="font-mono text-[11px] tracking-[0.1em] uppercase border border-warm-gray-light bg-transparent px-4 py-2 cursor-pointer hover:border-ink hover:text-ink disabled:opacity-50"
        >
          {busy ? 'Sending…' : 'Send Report'}
        </button>
        <button
          onClick={() => { setOpen(false); setError('') }}
          className="font-mono text-[11px] tracking-[0.1em] uppercase text-warm-gray bg-transparent border-0 px-2 cursor-pointer hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
