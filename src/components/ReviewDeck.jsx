import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchAllProducts, setListingModeration, fetchReports, resolveReport } from '../data/storage'
import Spinner from './Spinner'

/**
 * Seller-listing review deck.
 *
 * Sellers publish straight to the shop, so this is review after the fact rather
 * than a gate: one card at a time, swipe right to clear it, left to flag it for
 * another look. Flagging leaves the listing live and marked — taking something
 * down is a deliberate third action, because an accidental swipe should never
 * pull someone's work out of the shop.
 *
 * Built for a phone: pointer events (not drag events, which never fire on
 * touch), 44px+ buttons, and arrow keys for anyone on a desktop.
 */

const SWIPE_THRESHOLD = 90   // px of travel that counts as a decision

export default function ReviewDeck() {
  const [tab,      setTab]      = useState('queue')   // 'queue' | 'reported'
  const [queue,    setQueue]    = useState([])
  const [reports,  setReports]  = useState([])
  const [products, setProducts] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState('')
  const [dx,       setDx]       = useState(0)
  const dragStart = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [all, open] = await Promise.all([fetchAllProducts(), fetchReports('open')])
      setProducts(all)
      setQueue(all.filter(p => p.source === 'seller_upload' && (p.moderation || 'unreviewed') === 'unreviewed'))
      setReports(open)
    } catch (err) {
      console.error('ReviewDeck load:', err)
      setError('Could not load the queue.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const card = queue[0]

  const decide = useCallback(async (action) => {
    if (!card || busy) return
    setBusy(true)
    setError('')
    try {
      if (action === 'ok')      await setListingModeration(card.id, 'ok')
      if (action === 'flag')    await setListingModeration(card.id, 'flagged')
      if (action === 'remove')  await setListingModeration(card.id, 'removed', { active: false })
      setQueue(q => q.slice(1))
      setDx(0)
    } catch (err) {
      console.error('moderation failed:', err)
      setError('That did not save — try again.')
    } finally {
      setBusy(false)
    }
  }, [card, busy])

  // Arrow keys mirror the swipe, for review at a desk.
  useEffect(() => {
    if (tab !== 'queue') return
    const onKey = (e) => {
      if (e.key === 'ArrowRight') decide('ok')
      if (e.key === 'ArrowLeft')  decide('flag')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tab, decide])

  // ── Drag ──────────────────────────────────────────────────────────────────
  function onPointerDown(e) {
    if (busy) return
    dragStart.current = e.clientX
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  function onPointerMove(e) {
    if (dragStart.current == null) return
    setDx(e.clientX - dragStart.current)
  }
  function onPointerUp() {
    if (dragStart.current == null) return
    const travelled = dx
    dragStart.current = null
    if (travelled >  SWIPE_THRESHOLD) { decide('ok');   return }
    if (travelled < -SWIPE_THRESHOLD) { decide('flag'); return }
    setDx(0)   // not far enough — spring back
  }

  const btn = (extra = {}) => ({
    fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
    padding: '14px 18px', minHeight: 44, border: '1px solid rgb(var(--color-warm-gray-light))',
    background: 'transparent', color: 'rgb(var(--color-warm-gray))', cursor: 'pointer',
    transition: 'all 0.15s', ...extra,
  })

  const tabBtn = (on) => ({
    fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase',
    padding: '8px 14px', minHeight: 44, cursor: 'pointer', transition: 'all 0.15s',
    border: '1px solid', borderColor: on ? 'rgb(var(--color-ink))' : 'rgb(var(--color-warm-gray-light))',
    background: on ? 'rgb(var(--color-ink))' : 'transparent',
    color: on ? 'rgb(var(--color-cream))' : 'rgb(var(--color-warm-gray))',
  })

  if (loading) return <div className="py-16 flex justify-center"><Spinner /></div>

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex gap-2 mb-6 flex-wrap">
        <button style={tabBtn(tab === 'queue')}    onClick={() => setTab('queue')}>
          To Review ({queue.length})
        </button>
        <button style={tabBtn(tab === 'reported')} onClick={() => setTab('reported')}>
          Reported ({reports.length})
        </button>
        <button style={btn()} onClick={load} disabled={busy}>Refresh</button>
      </div>

      {error && <p className="font-mono text-[12px] mb-4" style={{ color: '#b94040' }}>{error}</p>}

      {/* ── Swipe deck ───────────────────────────────────────────────────── */}
      {tab === 'queue' && (
        !card ? (
          <p className="font-mono text-[13px] text-warm-gray text-center py-16">
            Nothing waiting. Every seller listing has been looked at.
          </p>
        ) : (
          <>
            <div
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              style={{
                border: '1px solid rgb(var(--color-warm-gray-light))',
                background: 'rgb(var(--color-cream))',
                padding: 16, touchAction: 'pan-y', userSelect: 'none', cursor: 'grab',
                transform: `translateX(${dx}px) rotate(${dx / 30}deg)`,
                transition: dragStart.current == null ? 'transform 0.2s' : 'none',
                opacity: busy ? 0.5 : 1,
              }}
            >
              {/* Which way this swipe is going */}
              <div style={{ height: 18, marginBottom: 6 }}>
                {dx > 40 && <span className="font-mono text-[11px]" style={{ color: '#3a7a40' }}>✓ LOOKS GOOD</span>}
                {dx < -40 && <span className="font-mono text-[11px]" style={{ color: '#b97a30' }}>⚑ FLAG</span>}
              </div>

              {card.imageURL || card.image ? (
                <img
                  src={card.imageURL || card.image}
                  alt={card.name}
                  draggable={false}
                  style={{ width: '100%', height: 340, objectFit: 'cover', display: 'block', marginBottom: 14 }}
                />
              ) : (
                <div style={{ height: 340, display: 'grid', placeItems: 'center', border: '1px dashed rgb(var(--color-warm-gray-light))', marginBottom: 14 }}>
                  <span className="font-mono text-[11px] text-warm-gray">No photo</span>
                </div>
              )}

              <p className="eyebrow mb-1">
                {card.category}{card.listingType === 'sculpture' ? ' · Sculpture' : ''}
                {card.garmentType ? ` · ${card.garmentType}` : ''}
              </p>
              <p className="font-serif text-[1.4rem] leading-tight mb-1">{card.name}</p>
              <p className="font-mono text-[13px] text-ink mb-1">${card.price}</p>
              <p className="font-mono text-[11px] text-warm-gray">
                by {card.artistName || 'unknown seller'}
                {card.medium ? ` · ${card.medium}` : ''}
                {card.dimensions ? ` · ${card.dimensions}` : ''}
                {card.sizes?.length ? ` · ${card.sizes.join(' / ')}` : ''}
              </p>
              {(card.imageURLs?.length > 1) && (
                <div className="flex gap-1.5 mt-3 flex-wrap">
                  {card.imageURLs.slice(1).map((u, i) => (
                    <img key={i} src={u} alt="" draggable={false}
                         style={{ width: 52, height: 52, objectFit: 'cover', border: '1px solid rgb(var(--color-warm-gray-light))' }} />
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 mt-5">
              <button style={btn({ flex: 1, borderColor: '#b97a30', color: '#b97a30' })}
                      disabled={busy} onClick={() => decide('flag')}>
                ⚑ Flag
              </button>
              <button style={btn({ flex: 1, borderColor: '#3a7a40', color: '#3a7a40' })}
                      disabled={busy} onClick={() => decide('ok')}>
                ✓ Looks Good
              </button>
            </div>
            <button style={btn({ width: '100%', marginTop: 8, borderColor: '#b94040', color: '#b94040' })}
                    disabled={busy}
                    onClick={() => { if (window.confirm(`Take "${card.name}" out of the shop?`)) decide('remove') }}>
              Take Down
            </button>

            <p className="font-mono text-[10px] text-warm-gray text-center mt-4">
              Swipe right to clear · left to flag · {queue.length - 1} left after this
            </p>
          </>
        )
      )}

      {/* ── Reports ──────────────────────────────────────────────────────── */}
      {tab === 'reported' && (
        reports.length === 0 ? (
          <p className="font-mono text-[13px] text-warm-gray text-center py-16">No open reports.</p>
        ) : (
          <ul className="flex flex-col gap-3" style={{ listStyle: 'none', padding: 0 }}>
            {reports.map(r => {
              const p = products.find(x => x.id === r.productId)
              return (
                <li key={r.id} style={{ border: '1px solid rgb(var(--color-warm-gray-light))', padding: 14 }}>
                  <p className="font-mono text-[12px] text-ink mb-1">{r.productName || p?.name || r.productId}</p>
                  <p className="font-mono text-[11px] mb-1" style={{ color: '#b94040' }}>{r.reason}</p>
                  {r.note && <p className="font-mono text-[11px] text-warm-gray leading-relaxed mb-2">{r.note}</p>}
                  {r.reporterEmail && (
                    <p className="font-mono text-[10px] text-warm-gray mb-2">from {r.reporterEmail}</p>
                  )}
                  <div className="flex gap-2 flex-wrap">
                    {p && (
                      <a href={`/shop/${p.slug}`} target="_blank" rel="noopener noreferrer"
                         style={{ ...btn(), textDecoration: 'none', display: 'inline-block' }}>
                        View listing ↗
                      </a>
                    )}
                    {p && (
                      <button
                        style={btn({ borderColor: '#b94040', color: '#b94040' })}
                        disabled={busy}
                        onClick={async () => {
                          if (!window.confirm(`Take "${p.name}" out of the shop?`)) return
                          setBusy(true)
                          try {
                            await setListingModeration(p.id, 'removed', { active: false })
                            await resolveReport(r.id, 'actioned')
                            setReports(rs => rs.filter(x => x.id !== r.id))
                          } catch (err) {
                            console.error(err)
                            setError('Could not take that listing down.')
                          } finally { setBusy(false) }
                        }}
                      >
                        Take down
                      </button>
                    )}
                    <button
                      style={btn()}
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        try {
                          await resolveReport(r.id, 'dismissed')
                          setReports(rs => rs.filter(x => x.id !== r.id))
                        } catch (err) {
                          console.error(err)
                          setError('Could not dismiss that report.')
                        } finally { setBusy(false) }
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )
      )}
    </div>
  )
}
