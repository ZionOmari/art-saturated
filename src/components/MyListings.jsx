import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { fetchMyListings, updateMyListing } from '../data/storage'
import Spinner from './Spinner'

// A seller's own listings: see status, edit the basics, hide/show, mark sold
// elsewhere. What a seller may change is enforced by firestore.rules (seller
// update allowlist; listings the owner took down are frozen) — this page only
// offers what those rules allow.

const mono = { fontFamily: 'monospace' }
const label = { ...mono, fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgb(var(--color-warm-gray))', margin: '0 0 4px' }
const input = {
  width: '100%', ...mono, fontSize: '13px', padding: '9px 11px', marginBottom: '10px',
  border: '1px solid #d4c9bb', background: 'rgb(var(--color-paper))', color: 'rgb(var(--color-ink))',
  outline: 'none', boxSizing: 'border-box',
}
const smallBtn = (tone = 'ink') => ({
  ...mono, fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase',
  padding: '7px 12px', cursor: 'pointer', background: 'transparent',
  border: `1px solid ${tone === 'danger' ? '#b94040' : 'rgb(var(--color-warm-gray-light))'}`,
  color: tone === 'danger' ? '#b94040' : 'rgb(var(--color-ink))',
})

const money = (n) => {
  const v = Number(n || 0)
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`
}

function statusOf(p) {
  if (p.moderation === 'removed') return { text: 'Removed by Art Saturated', color: '#b94040' }
  if (p.sold || Number(p.stock) === 0) return { text: 'Sold out', color: 'rgb(var(--color-warm-gray))' }
  if (p.active === false) return { text: 'Hidden', color: '#b97a30' }
  return { text: 'Live', color: '#3a7a40' }
}

function firstImage(p) {
  if (Array.isArray(p.imageURLs) && p.imageURLs[0]) return p.imageURLs[0]
  return p.imageURL || p.image || null
}

export default function MyListings({ uid, isMember, onAddNew }) {
  const [items,   setItems]   = useState(null)   // null = loading
  const [error,   setError]   = useState('')
  const [editing, setEditing] = useState(null)   // product id being edited
  const [draft,   setDraft]   = useState({})
  const [busyId,  setBusyId]  = useState(null)

  useEffect(() => {
    if (!uid) return
    fetchMyListings(uid).then(setItems).catch(err => { setItems([]); setError(err.message) })
  }, [uid])

  async function save(p, patch) {
    setBusyId(p.id); setError('')
    try {
      await updateMyListing(p.id, patch)
      setItems(list => list.map(x => (x.id === p.id ? { ...x, ...patch } : x)))
      return true
    } catch (err) {
      setError(err.code === 'permission-denied'
        ? 'That change was refused. Your membership may have lapsed, or the listing was taken down.'
        : (err.message || 'Could not save.'))
      return false
    } finally {
      setBusyId(null)
    }
  }

  function startEdit(p) {
    setError('')
    setEditing(p.id)
    setDraft({ name: p.name || '', description: p.description || '', price: String(p.price ?? ''), stock: String(p.stock ?? 1) })
  }

  async function saveEdit(p) {
    const price = Number(draft.price)
    const stock = parseInt(draft.stock, 10)
    if (!draft.name.trim())                 return setError('A listing needs a name.')
    if (!(price > 0))                       return setError('Price must be more than $0.')
    if (!Number.isInteger(stock) || stock < 0) return setError('Quantity must be 0 or more.')
    const ok = await save(p, { name: draft.name.trim(), description: draft.description.trim(), price, stock })
    if (ok) setEditing(null)
  }

  if (items === null) return <div className="py-6 flex justify-center"><Spinner size={20} color="#3d2810" /></div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' }}>
        <p style={{ ...mono, fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgb(var(--color-ink))', margin: 0 }}>
          Your Listings {items.length > 0 && `(${items.length})`}
        </p>
        <button className="btn-outline" onClick={onAddNew}>+ List something new</button>
      </div>

      {!isMember && items.length > 0 && (
        <p style={{ ...mono, fontSize: '12px', color: '#b97a30', lineHeight: 1.6, margin: '0 0 16px' }}>
          Your membership isn't active, so these are view-only. Renew it in the Artist Profile tab to edit.
        </p>
      )}
      {/* Errors from an open editor show inside that card (visible on a phone); others here. */}
      {error && !editing && <p style={{ ...mono, fontSize: '12px', color: '#b94040', margin: '0 0 14px' }}>{error}</p>}

      {items.length === 0 && (
        <p style={{ ...mono, fontSize: '13px', color: 'rgb(var(--color-warm-gray))', lineHeight: 1.7 }}>
          Nothing listed yet. Anything you upload shows up here, where you can edit it, hide it, or mark it sold.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {items.map(p => {
          const st      = statusOf(p)
          const frozen  = p.moderation === 'removed'
          const canEdit = isMember && !frozen
          const busy    = busyId === p.id
          const img     = firstImage(p)
          return (
            <div key={p.id} style={{ border: '1px solid #e8e0d4', padding: '12px', background: 'rgb(var(--color-paper))', opacity: busy ? 0.6 : 1 }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ width: '64px', height: '64px', flexShrink: 0, background: '#e8e0d4', overflow: 'hidden' }}>
                  {img && <img src={img} alt={p.name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'flex-start' }}>
                    <p style={{ ...mono, fontSize: '13px', color: 'rgb(var(--color-ink))', margin: 0, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {p.name || 'Untitled'}
                    </p>
                    <span style={{ ...mono, fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: st.color, border: `1px solid ${st.color}`, padding: '2px 8px', flexShrink: 0 }}>
                      {st.text}
                    </span>
                  </div>
                  <p style={{ ...mono, fontSize: '11px', color: 'rgb(var(--color-warm-gray))', margin: '4px 0 0' }}>
                    {money(p.price)} · {Number(p.stock ?? 1)} available{p.listingType ? ` · ${p.listingType}` : ''}
                  </p>
                  {frozen && (
                    <p style={{ ...mono, fontSize: '11px', color: '#b94040', margin: '6px 0 0', lineHeight: 1.5 }}>
                      Taken down by Art Saturated. Questions? Use the ? button to message us.
                    </p>
                  )}
                </div>
              </div>

              {editing === p.id ? (
                <div style={{ marginTop: '12px' }}>
                  <p style={label}>Name</p>
                  <input style={input} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
                  <p style={label}>Description</p>
                  <textarea style={{ ...input, minHeight: '70px', resize: 'vertical' }} value={draft.description}
                    onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
                  <div style={{ display: 'flex', gap: '10px' }}>
                    <div style={{ flex: 1 }}>
                      <p style={label}>Price ($)</p>
                      <input style={input} type="number" min="1" step="0.01" inputMode="decimal" value={draft.price}
                        onChange={e => setDraft(d => ({ ...d, price: e.target.value }))} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={label}>Available</p>
                      <input style={input} type="number" min="0" step="1" inputMode="numeric" value={draft.stock}
                        onChange={e => setDraft(d => ({ ...d, stock: e.target.value }))} />
                    </div>
                  </div>
                  {error && <p role="alert" style={{ ...mono, fontSize: '12px', color: '#b94040', margin: '0 0 10px' }}>{error}</p>}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={{ ...smallBtn(), background: 'rgb(var(--color-ink))', color: 'rgb(var(--color-cream))' }} disabled={busy} onClick={() => saveEdit(p)}>Save</button>
                    <button style={smallBtn()} disabled={busy} onClick={() => { setEditing(null); setError('') }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                  {p.slug && !frozen && p.active !== false && (
                    <Link to={`/shop/${p.slug}`} style={{ ...smallBtn(), textDecoration: 'none' }}>View</Link>
                  )}
                  {canEdit && <button style={smallBtn()} disabled={busy} onClick={() => startEdit(p)}>Edit</button>}
                  {canEdit && (
                    <button style={smallBtn()} disabled={busy} onClick={() => save(p, { active: p.active === false })}>
                      {p.active === false ? 'Show in shop' : 'Hide from shop'}
                    </button>
                  )}
                  {canEdit && !p.sold && Number(p.stock ?? 1) > 0 && (
                    <button style={smallBtn('danger')} disabled={busy}
                      onClick={() => { if (window.confirm(`Mark “${p.name || 'this piece'}” as sold elsewhere? It will stop being buyable here.`)) save(p, { stock: 0 }) }}>
                      Sold elsewhere
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
