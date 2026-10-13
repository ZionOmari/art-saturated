import { useState, useRef, useEffect, useMemo } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { collection, doc, addDoc, getDoc, getDocs, query, where, serverTimestamp } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { checkoutCdOrder } from '../lib/stripe'
import {
  CD_PRICING, PACKAGING_LABELS, STOCK_LABELS, priceCdOrder, reorderWindow, fmtCents,
} from '../../functions/cdPricing.mjs'
import { CD_TERMS, CD_TERMS_UPDATED } from '../data/cdTerms'
import CdMockup from '../components/CdMockup'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'

// CD printing — made to order and paid at checkout, so the customer supplies
// everything needed to print up front and nobody has to email back and forth.
// Price is recomputed server-side from the saved config (functions/cdPricing.mjs).

// ── Image cropper ─────────────────────────────────────────────────────────────
// aspect = width / height. Output is sized for 300dpi print.
const CROP_BOX = 280

function ImageCropperModal({ file, title, aspect = 1, outW = 1500, round = false, onDone, onCancel }) {
  const boxW = aspect >= 1 ? CROP_BOX : Math.round(CROP_BOX * aspect)
  const boxH = aspect >= 1 ? Math.round(CROP_BOX / aspect) : CROP_BOX
  const outH = Math.round(outW / aspect)

  const [imgSrc,    setImgSrc]    = useState('')
  const [pos,       setPos]       = useState({ x: 0, y: 0 })
  const [scale,     setScale]     = useState(1)
  const [natSize,   setNatSize]   = useState({ w: 0, h: 0 })
  const [dragging,  setDragging]  = useState(false)
  const [lastMouse, setLastMouse] = useState({ x: 0, y: 0 })
  const imgRef    = useRef()
  const canvasRef = useRef()

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setImgSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  function handleLoad(e) {
    const { naturalWidth: w, naturalHeight: h } = e.target
    setNatSize({ w, h })
    const s = Math.max(boxW / w, boxH / h)
    setScale(s)
    setPos({ x: -(w * s - boxW) / 2, y: -(h * s - boxH) / 2 })
  }

  function clamp(p) {
    const dw = natSize.w * scale, dh = natSize.h * scale
    return {
      x: Math.min(0, Math.max(p.x, boxW - dw)),
      y: Math.min(0, Math.max(p.y, boxH - dh)),
    }
  }

  function down(cx, cy) { setDragging(true); setLastMouse({ x: cx, y: cy }) }
  function move(cx, cy) {
    if (!dragging) return
    setPos(p => clamp({ x: p.x + cx - lastMouse.x, y: p.y + cy - lastMouse.y }))
    setLastMouse({ x: cx, y: cy })
  }
  function up() { setDragging(false) }

  function handleDone() {
    const canvas = canvasRef.current
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    ctx.drawImage(imgRef.current, -pos.x / scale, -pos.y / scale, boxW / scale, boxH / scale, 0, 0, outW, outH)
    canvas.toBlob(blob => onDone(blob), 'image/jpeg', 0.92)
  }

  // Source pixels inside the frame vs. what print needs.
  const lowRes = natSize.w > 0 && boxW / scale < outW * 0.66

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#f5f1e8', padding: '24px', maxWidth: '360px', width: '100%' }}>
        <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#7a5030', marginBottom: '4px' }}>
          {title}
        </p>
        <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#a08060', marginBottom: '14px' }}>
          Drag to reposition. What's inside the frame is what gets printed.
        </p>

        <div
          style={{ width: boxW, height: boxH, overflow: 'hidden', position: 'relative', background: '#1a1814', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none', touchAction: 'none', margin: '0 auto' }}
          onMouseDown={e => { e.preventDefault(); down(e.clientX, e.clientY) }}
          onMouseMove={e => move(e.clientX, e.clientY)}
          onMouseUp={up} onMouseLeave={up}
          onTouchStart={e => { e.preventDefault(); down(e.touches[0].clientX, e.touches[0].clientY) }}
          onTouchMove={e => { e.preventDefault(); move(e.touches[0].clientX, e.touches[0].clientY) }}
          onTouchEnd={up}
        >
          {imgSrc && (
            <img ref={imgRef} src={imgSrc} onLoad={handleLoad} draggable={false} alt=""
              style={{ position: 'absolute', left: pos.x, top: pos.y, width: natSize.w * scale, height: natSize.h * scale, pointerEvents: 'none' }} />
          )}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', border: '2px solid rgba(255,255,255,0.25)', boxSizing: 'border-box', borderRadius: round ? '50%' : 0, boxShadow: round ? '0 0 0 400px rgba(0,0,0,0.45)' : 'none' }} />
          {round && (
            <div style={{ position: 'absolute', left: '50%', top: '50%', width: '15%', height: '15%', transform: 'translate(-50%,-50%)', borderRadius: '50%', background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
          )}
        </div>

        {lowRes && (
          <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#a04020', marginTop: '10px' }}>
            This image is low resolution and may print blurry.
          </p>
        )}

        <canvas ref={canvasRef} style={{ display: 'none' }} />

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          <button onClick={handleDone} style={{ flex: 1, fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '11px', background: '#1a1814', color: '#f5f2ec', border: 'none', cursor: 'pointer' }}>
            Use this crop
          </button>
          <button onClick={onCancel} style={{ fontFamily: 'monospace', fontSize: '11px', color: '#7a5030', background: 'none', border: '1px solid #a08060', padding: '11px 16px', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const inp = {
  width: '100%', fontFamily: 'monospace', fontSize: '13px', padding: '10px 12px',
  border: '1px solid #a08060', background: 'rgba(236,230,217,0.6)', color: '#1a1814',
  outline: 'none', boxSizing: 'border-box',
}
const eyebrow = {
  fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase',
  color: '#b08a3e', marginBottom: '8px', display: 'block',
}
const noteBox = {
  background: 'rgba(36,20,8,0.78)', color: '#ece6d9', padding: '8px 14px', borderRadius: '6px', display: 'inline-block',
}

function Choice({ options, value, onChange }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(150px, 1fr))` }}>
      {options.map(o => {
        const on = value === o.key
        return (
          <button key={o.key} type="button" onClick={() => onChange(o.key)}
            aria-pressed={on}
            className="text-left px-4 py-3 border transition-colors"
            style={{ borderColor: on ? '#1a1814' : '#c5bfb5', background: on ? '#1a1814' : 'transparent', color: on ? '#f5f2ec' : '#1a1814' }}>
            <span className="block font-mono text-[11px] uppercase tracking-[0.08em]">{o.label}</span>
            {o.sub && <span className="block font-mono text-[10px] mt-1" style={{ color: on ? '#d4c4a8' : '#8a857d' }}>{o.sub}</span>}
          </button>
        )
      })}
    </div>
  )
}

function TurnaroundChoice({ value, onChange }) {
  return (
    <Choice value={value ? 'rush' : 'standard'} onChange={k => onChange(k === 'rush')} options={[
      { key: 'standard', label: 'Standard', sub: '7–14 days' },
      { key: 'rush',     label: 'Rush',     sub: `Under ${CD_PRICING.rushDays} days · +${CD_PRICING.rushPct}%` },
    ]} />
  )
}

function Section({ n, title, children }) {
  return (
    <section>
      <p style={eyebrow}>{n}. {title}</p>
      {children}
    </section>
  )
}

// Artwork slot: click to pick → crop → preview.
function ArtSlot({ label, preview, onPick, onRemove, aspect = 1, round = false, optionalNote }) {
  const inputRef = useRef()
  return (
    <div className="flex flex-col gap-1">
      <div
        role="button" tabIndex={0}
        onClick={() => inputRef.current.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current.click() }}
        className="border border-warm-gray-light relative overflow-hidden cursor-pointer hover:border-ink transition-colors"
        style={{ aspectRatio: String(aspect), borderRadius: round ? '50%' : 0 }}
      >
        {preview ? (
          <>
            <img src={preview} className="w-full h-full object-cover" alt={label} />
            <button type="button" aria-label={`Remove ${label}`}
              onClick={e => { e.stopPropagation(); onRemove() }}
              className="absolute top-1 right-1 w-6 h-6 bg-ink text-cream font-mono text-[10px] flex items-center justify-center"
              style={round ? { top: '14%', right: '14%' } : undefined}>
              ✕
            </button>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-1 px-2 text-center">
            <span className="font-mono text-[18px] text-warm-gray/40">+</span>
            {optionalNote && <span className="font-mono text-[9px] text-warm-gray/60 leading-tight">{optionalNote}</span>}
          </div>
        )}
      </div>
      <p className="font-mono text-[9px] text-warm-gray text-center uppercase tracking-widest">{label}</p>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) onPick(f) }} />
    </div>
  )
}

const PANEL_LABELS = {
  2: ['Front cover', 'Back / inside'],
  4: ['Front cover', 'Inside left', 'Inside right', 'Back of booklet'],
}

// Jewel tray card: 5.91" × 4.63" incl. spines → aspect ≈ 1.276, 1772px at 300dpi.
const TRAY_ASPECT = 5.91 / 4.63

// ── Pay-a-saved-order view (?pay=<id>) ────────────────────────────────────────
// Reached from the emailed link: an unfinished checkout, or the balance on a
// deposit order. A fresh Stripe session is made on every click, so the link
// in the email never expires.
function PayExisting({ orderId }) {
  const { user } = useAuth()
  const [order, setOrder] = useState(null)
  const [err,   setErr]   = useState('')
  const [busy,  setBusy]  = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'quoteRequests', orderId))
      .then(s => s.exists() ? setOrder({ id: s.id, ...s.data() }) : setErr('Order not found.'))
      .catch(() => setErr('This order belongs to a different account. Sign in with the email you ordered with.'))
  }, [orderId, user?.uid])

  // Amounts the checkout function stored win over a local recompute: a
  // reorder is priced with a locked rate this page doesn't know.
  const price = order ? priceCdOrder(order) : null
  const due = !order ? 0
    : order.paymentStatus === 'unpaid'       ? (order.dueNowCents ?? price.dueNow)
    : order.paymentStatus === 'deposit_paid' ? (order.totalCents ?? price.total) - (order.amountPaidCents || 0)
    : 0

  async function pay() {
    setBusy(true); setErr('')
    try { await checkoutCdOrder({ orderId, customerEmail: order.email }) }
    catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div className="max-w-md mx-auto px-6 pt-16 pb-24 text-center">
      <p style={eyebrow}>CD Printing</p>
      {!order && !err && <Spinner />}
      {err && <p className="font-mono text-[12px] text-red-500 mb-4">{err}</p>}
      {order && (
        <>
          <h1 className="font-serif text-[1.8rem] font-normal mb-2">{order.albumTitle || 'Your CD order'}</h1>
          <p className="font-mono text-[12px] text-warm-gray mb-6">
            {order.qty} × {PACKAGING_LABELS[order.packaging] || order.packaging} · Order #{order.id.slice(-6).toUpperCase()}
          </p>
          <div className="mb-8 text-left">
            <CdMockup packaging={order.packaging} panelCount={order.panelCount} gloss={order.gloss}
              art={order.artwork || {}} artistName={order.artistName} albumTitle={order.albumTitle} />
          </div>
          {due > 0 ? (
            <>
              <p className="font-mono text-[13px] text-ink mb-6">
                {order.paymentStatus === 'deposit_paid' ? 'Remaining balance' : 'Amount due'}: <strong>{fmtCents(due)}</strong>
              </p>
              <button onClick={pay} disabled={busy} className="btn-outline w-full">
                {busy ? <span className="flex items-center justify-center gap-2"><Spinner />Opening checkout…</span> : `Pay ${fmtCents(due)}`}
              </button>
            </>
          ) : (
            <p className="font-mono text-[13px] text-ink">This order is paid in full. Thank you.</p>
          )}
        </>
      )}
    </div>
  )
}

// ── Outside-US shipping inquiry ──────────────────────────────────────────────
// International orders aren't sold online; this opens the site's feedback
// bubble as an inquiry (it emails the owner — notifyFeedback).
function askAboutShipping(context) {
  window.dispatchEvent(new CustomEvent('as:inquiry', {
    detail: { message: `Shipping inquiry (${context}): I'm outside the US. Country: ` },
  }))
}

function InquiryLink({ context }) {
  return (
    <p className="font-mono text-[10px] text-warm-gray">
      Outside the US?{' '}
      <button type="button" onClick={() => askAboutShipping(context)} className="underline text-earth">Message us</button>
      {' '}for a shipping quote.
    </p>
  )
}

// ── Terms of Service ──────────────────────────────────────────────────────────
function CdTerms() {
  return (
    <section id="terms" className="border border-warm-gray-light p-5">
      <p style={eyebrow}>CD Printing Terms of Service</p>
      <p className="font-mono text-[10px] text-warm-gray mb-4">Last updated {CD_TERMS_UPDATED}</p>
      <div className="flex flex-col gap-4">
        {CD_TERMS.map((s, i) => (
          <div key={s.title}>
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink mb-1">{i + 1}. {s.title}</p>
            <ul className="flex flex-col gap-1">
              {s.items.map((t, j) => (
                <li key={j} className="font-mono text-[11px] text-warm-gray leading-relaxed pl-3" style={{ textIndent: '-0.75rem' }}>· {t}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}

const tsMs = t => (t?.toMillis ? t.toMillis() : typeof t?.seconds === 'number' ? t.seconds * 1000 : null)
const isPaid = o => o.paymentStatus === 'paid' || o.paymentStatus === 'deposit_paid'
const fmtDate = ms => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

// ── Your projects (signed-in customers with past paid orders) ────────────────
// One row per project — the latest paid order in it — with a reorder link
// while the retention window is open.
function MyProjects({ uid }) {
  const [projects, setProjects] = useState([])
  useEffect(() => {
    getDocs(query(collection(db, 'quoteRequests'), where('uid', '==', uid)))
      .then(snap => {
        const latest = {}
        snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(isPaid).forEach(o => {
          const key = o.projectId || o.id
          if (!latest[key] || (tsMs(o.paidAt) || 0) > (tsMs(latest[key].paidAt) || 0)) latest[key] = o
        })
        setProjects(Object.values(latest).sort((a, b) => (tsMs(b.paidAt) || 0) - (tsMs(a.paidAt) || 0)))
      })
      .catch(e => console.error('MyProjects:', e))
  }, [uid])

  if (projects.length === 0) return null
  return (
    <div className="border border-warm-gray-light p-4 mb-10">
      <p style={eyebrow}>Your CD projects</p>
      <div className="flex flex-col divide-y divide-warm-gray-light">
        {projects.map(o => {
          const w = reorderWindow(tsMs(o.paidAt))
          return (
            <div key={o.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="font-mono text-[12px] text-ink truncate">{o.artistName} — {o.albumTitle}</p>
                <p className="font-mono text-[10px] text-warm-gray">
                  {o.qty} × {PACKAGING_LABELS[o.packaging]} · {w.open ? `reorder by ${fmtDate(w.until)}` : 'files expired'}
                </p>
              </div>
              {w.open && (
                <Link to={`/cd-printing?reorder=${o.id}`} className="btn-outline text-[10px] shrink-0">Reorder</Link>
              )}
            </div>
          )
        })}
      </div>
      <p className="font-mono text-[10px] text-warm-gray mt-2">Reorders: no setup fee, same per-disc rate.</p>
    </div>
  )
}

// ── Reorder view (?reorder=<id>) ──────────────────────────────────────────────
// Same files and options as the source order; only quantity and delivery
// change. The function re-checks the window and rate — this view is display.
function Reorder({ sourceId }) {
  const { user } = useAuth()
  const [src,  setSrc]  = useState(null)
  const [err,  setErr]  = useState('')
  const [qty,  setQty]  = useState('')
  const delivery = 'ship'   // online only — every order ships
  const [rush, setRush] = useState(false)
  const [agree, setAgree] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    getDoc(doc(db, 'quoteRequests', sourceId))
      .then(s => {
        if (!s.exists()) return setErr('Order not found.')
        const o = { id: s.id, ...s.data() }
        setSrc(o); setQty(String(o.qty || 1)); 
      })
      .catch(() => setErr('This order belongs to a different account.'))
  }, [sourceId, user?.uid])

  if (err) return <p className="font-mono text-[12px] text-red-500 text-center py-16">{err}</p>
  if (!src) return <div className="py-16 flex justify-center"><Spinner /></div>

  const w = reorderWindow(tsMs(src.paidAt))
  const rate = src.perDiscCents || priceCdOrder(src).perDisc
  const q = parseInt(qty, 10) || 0
  const price = priceCdOrder({ ...src, qty: Math.max(1, q), delivery, rush }, { reorderRate: rate })

  async function submit() {
    if (q < 1) return setErr('Enter how many discs you need.')
    if (!agree) return setErr('Please agree to the terms.')
    setBusy(true); setErr('')
    try {
      const c = price.config
      const ref2 = await addDoc(collection(db, 'quoteRequests'), {
        uid: user.uid,
        name: src.name, email: src.email, phone: src.phone || '',
        artistName: src.artistName, albumTitle: src.albumTitle,
        ...c,
        trackList: src.trackList, audioFiles: src.audioFiles, artwork: src.artwork,
        reorderOf: src.id,
        projectId: src.projectId || src.id,
        estimatedTotal: price.total / 100,
        status: 'pending_payment',
        paymentStatus: 'unpaid',
        createdAt: serverTimestamp(),
      })
      await checkoutCdOrder({ orderId: ref2.id, customerEmail: src.email })
    } catch (e) { setErr(e.message); setBusy(false) }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-12 pb-24 flex flex-col gap-8">
      <div>
        <p style={eyebrow}>CD Printing · Reorder</p>
        <h1 className="font-serif text-[2rem] font-normal">{src.artistName} — {src.albumTitle}</h1>
        <p className="font-mono text-[12px] text-warm-gray mt-1">
          {PACKAGING_LABELS[src.packaging]}
          {src.packaging !== 'sleeve' && ` · ${src.panelCount}-panel · ${STOCK_LABELS[src.stock]}${src.gloss ? ' · gloss' : ''}`}
          {' · '}{(src.trackList || []).length} tracks
        </p>
      </div>

      <CdMockup packaging={src.packaging} panelCount={src.panelCount} gloss={src.gloss}
        art={src.artwork || {}} artistName={src.artistName} albumTitle={src.albumTitle} />

      {!w.open ? (
        <p className="font-mono text-[12px] text-ink border border-warm-gray-light p-4">
          The files for this project were kept until {w.until ? fmtDate(w.until) : 'its retention date'}, so it can no longer be reordered.
          {' '}<Link to="/cd-printing" className="text-earth underline">Start a new order</Link>.
        </p>
      ) : (
        <div className="border border-warm-gray-light p-5 flex flex-col gap-4">
          <p className="font-mono text-[11px] text-warm-gray">
            Same files and options as before, no setup fee, and your {fmtCents(rate)}/disc rate — available until {fmtDate(w.until)}.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <input style={{ ...inp, width: '120px' }} type="number" inputMode="numeric" min="1" max={CD_PRICING.maxQty}
              value={qty} onChange={e => setQty(e.target.value)} aria-label="Number of discs" />
            <span className="font-mono text-[12px] text-warm-gray">discs · {fmtCents(price.perDisc)} each</span>
          </div>
          <p className="font-mono text-[11px] text-ink">Ships within the US · {fmtCents(CD_PRICING.shippingFlat)} flat</p>
          <InquiryLink context={`CD reorder ${src.id.slice(-6).toUpperCase()}`} />
          <TurnaroundChoice value={rush} onChange={setRush} />
          <div className="flex flex-col gap-1 font-mono text-[12px]">
            <div className="flex justify-between"><span className="text-warm-gray">{price.config.qty} discs × {fmtCents(price.perDisc)}</span><span>{fmtCents(price.discsTotal)}</span></div>
            <div className="flex justify-between"><span className="text-warm-gray">Setup fee</span><span className="text-earth">waived</span></div>
            {price.rushFee > 0 && <div className="flex justify-between"><span className="text-warm-gray">Rush (+{CD_PRICING.rushPct}%)</span><span>{fmtCents(price.rushFee)}</span></div>}
            <div className="flex justify-between"><span className="text-warm-gray">Indiana sales tax</span><span>{fmtCents(price.tax)}</span></div>
            {price.shipping > 0 && <div className="flex justify-between"><span className="text-warm-gray">Shipping</span><span>{fmtCents(price.shipping)}</span></div>}
            <div className="flex justify-between border-t border-warm-gray-light pt-2 mt-1 text-[14px]"><span>Total</span><span className="font-medium">{fmtCents(price.total)}</span></div>
            <div className="flex justify-between text-earth"><span>{price.isDeposit ? `Due today (${CD_PRICING.depositPct}% deposit)` : 'Due today'}</span><span>{fmtCents(price.dueNow)}</span></div>
          </div>
          <label className="flex items-start gap-2 font-mono text-[11px] text-ink cursor-pointer">
            <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} className="mt-0.5" />
            <span>I agree to the <a href="#terms" className="underline">CD Printing Terms of Service</a>.</span>
          </label>
          {err && <p className="font-mono text-[12px] text-red-500" role="alert">{err}</p>}
          <button onClick={submit} disabled={busy} className="btn-outline w-full">
            {busy ? <span className="flex items-center justify-center gap-2"><Spinner />Opening checkout…</span> : `Pay ${fmtCents(price.dueNow)} & reorder`}
          </button>
        </div>
      )}

      <CdTerms />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function QuoteRequestPage() {
  const { user, profile } = useAuth()
  const location = useLocation()
  const [params] = useSearchParams()
  const payId = params.get('pay')
  const reorderId = params.get('reorder')

  useEffect(() => {
    document.title = 'CD Printing — Art Saturated'
    return () => { document.title = 'Art Saturated' }
  }, [])

  // Order config
  const [packaging,    setPackaging]    = useState('jewel')
  const [stock,        setStock]        = useState('standard')
  const [panelCount,   setPanelCount]   = useState(4)
  const [qty,          setQty]          = useState('25')
  const delivery = 'ship'   // online only — every order ships
  const [removeCredit, setRemoveCredit] = useState(false)
  const [gloss,        setGloss]        = useState(false)
  const [rush,         setRush]         = useState(false)

  // Release + contact
  const [info, setInfo] = useState({ name: '', email: '', phone: '', artistName: '', albumTitle: '' })
  useEffect(() => {
    setInfo(i => ({
      ...i,
      name:  i.name  || profile?.name || user?.displayName || '',
      email: i.email || user?.email || '',
      phone: i.phone || profile?.phone || '',
    }))
  }, [user, profile])

  // Tracks + audio (audio[i] belongs to tracks[i])
  const [tracks, setTracks] = useState([{ title: '', file: null }])
  const audioInputRef = useRef()

  // Artwork: key → { blob, preview }
  const [art, setArt] = useState({})
  const [crop, setCrop] = useState(null)   // { key, file, title, aspect, round }

  const [agree, setAgree] = useState({ final: false, rights: false, terms: false })
  const [busy,    setBusy]    = useState(false)
  const [busyMsg, setBusyMsg] = useState('')
  const [error,   setError]   = useState('')

  const printed = packaging !== 'sleeve'
  const qtyNum  = parseInt(qty, 10) || 0
  const price   = useMemo(
    () => priceCdOrder({ qty: Math.max(1, qtyNum), packaging, panelCount, stock, gloss, removeCredit, delivery, rush }),
    [qtyNum, packaging, panelCount, stock, gloss, removeCredit, delivery, rush],
  )

  // Artwork slots required by the current config
  const slots = useMemo(() => {
    const s = [{ key: 'disc', label: 'Disc face', round: true, aspect: 1, optional: printed, optionalNote: printed ? 'Optional — uses front cover' : null }]
    if (printed) {
      PANEL_LABELS[panelCount].forEach((label, i) => s.push({ key: `panel${i}`, label, aspect: 1 }))
      if (packaging === 'jewel') s.push({ key: 'tray', label: 'Tray card (back)', aspect: TRAY_ASPECT, wide: true })
    }
    return s
  }, [printed, panelCount, packaging])

  // Free preview URLs on unmount
  const artRef = useRef(art)
  artRef.current = art
  useEffect(() => () => Object.values(artRef.current).forEach(a => a?.preview && URL.revokeObjectURL(a.preview)), [])

  function setArtBlob(key, blob) {
    setArt(prev => {
      if (prev[key]?.preview) URL.revokeObjectURL(prev[key].preview)
      return { ...prev, [key]: blob ? { blob, preview: URL.createObjectURL(blob) } : undefined }
    })
  }

  // ── Tracks ──
  function addTrack()          { setTracks(t => [...t, { title: '', file: null }]) }
  function removeTrack(i)      { setTracks(t => t.filter((_, idx) => idx !== i)) }
  function updateTitle(i, v)   { setTracks(t => t.map((tr, idx) => idx === i ? { ...tr, title: v } : tr)) }
  function removeAudio(i)      { setTracks(t => t.map((tr, idx) => idx === i ? { ...tr, file: null } : tr)) }

  // Multiple files: fill empty slots in order, adding tracks as needed and
  // using the file name as the title when none was typed.
  function handleAudio(e) {
    const files = Array.from(e.target.files).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    e.target.value = ''
    setTracks(prev => {
      const next = prev.map(t => ({ ...t }))
      for (const f of files) {
        let i = next.findIndex(t => !t.file)
        if (i === -1) { next.push({ title: '', file: null }); i = next.length - 1 }
        next[i].file = f
        if (!next[i].title.trim()) next[i].title = f.name.replace(/\.[^.]+$/, '').replace(/^\d+[\s._-]*/, '')
      }
      return next
    })
  }

  // ── Validation ──
  function validate() {
    if (!info.name.trim())       return 'Enter your name.'
    if (!info.email.trim())      return 'Enter your email.'
    if (!info.artistName.trim()) return 'Enter the artist name as it should print.'
    if (!info.albumTitle.trim()) return 'Enter the album title as it should print.'
    if (qtyNum < 1)              return 'Enter how many discs you need.'
    if (qtyNum > CD_PRICING.maxQty) return `For more than ${CD_PRICING.maxQty} discs, email us first.`
    if (tracks.length === 0)     return 'Add at least one track.'
    if (tracks.some(t => !t.title.trim())) return 'Every track needs a title.'
    if (tracks.some(t => !t.file))         return 'Every track needs an audio file.'
    const missing = slots.find(s => !s.optional && !art[s.key])
    if (missing) return `Add artwork for: ${missing.label}.`
    if (!agree.final || !agree.rights || !agree.terms) return 'Tick all three boxes to confirm.'
    return null
  }

  // ── Submit: upload, save, go to Stripe ──
  async function handleSubmit(e) {
    e.preventDefault()
    const err = validate()
    if (err) { setError(err); return }
    setError('')
    setBusy(true)

    try {
      const base = `quotes/${user.uid}/${Date.now()}`
      async function put(path, data, contentType) {
        const r = ref(storage, `${base}/${path}`)
        await uploadBytes(r, data, contentType ? { contentType } : undefined)
        return getDownloadURL(r)
      }

      setBusyMsg('Uploading artwork…')
      const artwork = {}
      for (const s of slots) {
        if (art[s.key]) artwork[s.key] = await put(`${s.key}.jpg`, art[s.key].blob, 'image/jpeg')
      }

      const audioFiles = []
      for (let i = 0; i < tracks.length; i++) {
        setBusyMsg(`Uploading audio ${i + 1} of ${tracks.length}…`)
        const f = tracks[i].file
        const safe = f.name.replace(/[^\w.\- ]+/g, '_')
        audioFiles.push({ track: tracks[i].title.trim(), name: f.name, url: await put(`track_${String(i + 1).padStart(2, '0')}_${safe}`, f) })
      }

      setBusyMsg('Saving order…')
      const c = price.config
      const docRef = await addDoc(collection(db, 'quoteRequests'), {
        uid:        user.uid,
        name:       info.name.trim(),
        email:      info.email.trim(),
        phone:      info.phone.trim(),
        artistName: info.artistName.trim(),
        albumTitle: info.albumTitle.trim(),
        ...c,
        trackList:  tracks.map(t => t.title.trim()),
        audioFiles,
        artwork,
        // Display copy only — the function reprices from the config above.
        estimatedTotal: price.total / 100,
        status:        'pending_payment',
        paymentStatus: 'unpaid',
        createdAt:     serverTimestamp(),
      })

      setBusyMsg('Opening secure checkout…')
      await checkoutCdOrder({ orderId: docRef.id, customerEmail: info.email.trim() })
    } catch (err) {
      console.error(err)
      setError(err.message || 'Something went wrong. Check your connection and try again.')
      setBusy(false)
      setBusyMsg('')
    }
  }

  const shell = children => (
    <main className="pt-[60px]">
      <div style={{ background: 'rgba(250,248,244,0.96)', minHeight: 'calc(100vh - 60px)' }}>{children}</div>
      <Footer />
    </main>
  )

  if (reorderId) return shell(user
    ? <Reorder sourceId={reorderId} />
    : <SignInPrompt from={location.pathname + location.search} text="Sign in to reorder your CDs." />)

  if (payId) return shell(user
    ? <PayExisting orderId={payId} />
    : <SignInPrompt from={location.pathname + location.search} text="Sign in to pay for your CD order." />)

  const packagingOptions = [
    { key: 'jewel',  label: 'Jewel case',  sub: 'Booklet + tray card with spines' },
    { key: 'slim',   label: 'Slim case',   sub: 'Thin case, front insert only' },
    { key: 'sleeve', label: 'Disc only',   sub: 'Printed disc in a paper sleeve' },
  ]

  return shell(
    <div className="max-w-2xl mx-auto px-4 sm:px-6 pt-12 pb-24">
      <div className="mb-10">
        <p style={eyebrow}>Physical Media</p>
        <h1 className="font-serif text-[2.2rem] font-normal mb-3">CD Printing</h1>
        <p className="font-mono text-[13px] text-warm-gray leading-relaxed">
          Short-run CDs for your album, EP, or demo — burned, printed, and assembled by hand in Fort Wayne.
          Any quantity, made to order. Build it below, upload your files, and check out.
        </p>
      </div>

      {!user ? (
        <SignInPrompt from={location.pathname} text="Sign in to start a CD order. Your order status and receipts are tied to your account." />
      ) : (
      <>
      <MyProjects uid={user.uid} />
      <form onSubmit={handleSubmit} className="flex flex-col gap-10" noValidate>

        <Section n={1} title="Packaging">
          <Choice options={packagingOptions} value={packaging} onChange={setPackaging} />
        </Section>

        {printed && (
          <Section n={2} title="Cover">
            <div className="flex flex-col gap-4">
              <Choice value={stock} onChange={setStock} options={[
                { key: 'standard',  label: STOCK_LABELS.standard,  sub: `Classic insert feel · ${fmtCents(CD_PRICING.print.standard)} per print` },
                { key: 'cardstock', label: STOCK_LABELS.cardstock, sub: `Heavier, sturdier · ${fmtCents(CD_PRICING.print.cardstock)} per print` },
              ]} />
              <p className="font-mono text-[10px] text-warm-gray -mt-2">
                Every case gets a printed front and back cover ({CD_PRICING.printsPerCover} prints per disc).
              </p>
              <Choice value={String(panelCount)} onChange={v => setPanelCount(Number(v))} options={[
                { key: '2', label: '2-panel', sub: 'Folded card: front + back' },
                { key: '4', label: '4-panel', sub: 'Booklet: front, inside spread, back' },
              ]} />
              <label className="flex items-start gap-2 font-mono text-[11px] text-ink cursor-pointer">
                <input type="checkbox" checked={gloss} onChange={e => setGloss(e.target.checked)} className="mt-0.5" />
                <span>Gloss finish on the covers (+{fmtCents(CD_PRICING.gloss)} per cover). The disc stays matte.</span>
              </label>
            </div>
          </Section>
        )}

        <Section n={printed ? 3 : 2} title="Quantity, shipping & turnaround">
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <input style={{ ...inp, width: '120px' }} type="number" inputMode="numeric" min="1" max={CD_PRICING.maxQty}
                value={qty} onChange={e => setQty(e.target.value)} aria-label="Number of discs" />
              <span className="font-mono text-[12px] text-warm-gray">
                discs · {fmtCents(price.perDisc)} each
                {price.discountPct > 0 && <span className="text-earth"> ({price.discountPct}% volume discount)</span>}
              </span>
            </div>
            <p className="font-mono text-[10px] text-warm-gray">
              Volume discount: {CD_PRICING.volume.map(v => `${v.pct}% off at ${v.min}+`).join(' · ')}
            </p>
            <p className="font-mono text-[11px] text-ink">Ships within the US · {fmtCents(CD_PRICING.shippingFlat)} flat</p>
            <InquiryLink context="CD printing" />
            <TurnaroundChoice value={rush} onChange={setRush} />
          </div>
        </Section>

        <Section n={printed ? 4 : 3} title="Release details">
          <div className="grid sm:grid-cols-2 gap-3">
            <input style={inp} placeholder="Artist name (as printed)" value={info.artistName}
              onChange={e => setInfo(i => ({ ...i, artistName: e.target.value }))} />
            <input style={inp} placeholder="Album title (as printed)" value={info.albumTitle}
              onChange={e => setInfo(i => ({ ...i, albumTitle: e.target.value }))} />
          </div>
          {packaging === 'jewel' && (
            <p className="font-mono text-[10px] text-warm-gray mt-2">The spines will read: {info.artistName || 'ARTIST'} — {info.albumTitle || 'TITLE'}</p>
          )}
        </Section>

        <Section n={printed ? 5 : 4} title="Tracks & audio">
          <div className="flex flex-col gap-2">
            {tracks.map((t, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="font-mono text-[11px] text-warm-gray w-6 text-right shrink-0">{i + 1}.</span>
                <input style={{ ...inp, flex: 1, minWidth: 0 }} placeholder={`Track ${i + 1} title`} value={t.title}
                  onChange={e => updateTitle(i, e.target.value)} />
                {t.file ? (
                  <span className="font-mono text-[10px] text-ink shrink-0 flex items-center gap-1 max-w-[110px]">
                    <span className="truncate">♪ {t.file.name}</span>
                    <button type="button" onClick={() => removeAudio(i)} aria-label="Remove audio" className="text-red-400 px-1">✕</button>
                  </span>
                ) : (
                  <span className="font-mono text-[10px] text-warm-gray/50 shrink-0">no audio</span>
                )}
                {tracks.length > 1 && (
                  <button type="button" onClick={() => removeTrack(i)} aria-label={`Remove track ${i + 1}`}
                    className="font-mono text-[11px] text-warm-gray shrink-0 px-1">−</button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-3">
            <button type="button" onClick={() => audioInputRef.current.click()} className="btn-outline text-[11px]">Upload audio</button>
            <button type="button" onClick={addTrack} className="font-mono text-[11px] text-earth uppercase tracking-widest">+ Add track</button>
          </div>
          <input ref={audioInputRef} type="file" accept="audio/*,.wav,.mp3,.flac,.aiff,.aif" multiple style={{ display: 'none' }} onChange={handleAudio} />
          <p className="font-mono text-[10px] mt-3" style={noteBox}>
            WAV preferred (MP3 okay). Select all your files at once — they're matched in filename order.
            The disc plays tracks in the order listed here. 80 minutes max per disc.
          </p>
        </Section>

        <Section n={printed ? 6 : 5} title="Artwork">
          <p className="font-mono text-[10px] mb-4" style={noteBox}>
            Upload finished, print-ready art. We print exactly what's in the crop frame — nothing gets redesigned.
            {printed && ' Include your track list on the back panel if you want it printed.'}
            {' '}Aim for at least 1500px square.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {slots.filter(s => !s.wide).map(s => (
              <ArtSlot key={s.key} label={s.label} aspect={s.aspect} round={s.round} optionalNote={s.optionalNote}
                preview={art[s.key]?.preview}
                onPick={file => setCrop({ key: s.key, file, title: s.label, aspect: s.aspect, round: s.round })}
                onRemove={() => setArtBlob(s.key, null)} />
            ))}
          </div>
          {slots.filter(s => s.wide).map(s => (
            <div key={s.key} className="mt-4 max-w-sm">
              <ArtSlot label={s.label} aspect={s.aspect} preview={art[s.key]?.preview}
                onPick={file => setCrop({ key: s.key, file, title: s.label, aspect: s.aspect, outW: 1772 })}
                onRemove={() => setArtBlob(s.key, null)} />
              <p className="font-mono text-[10px] text-warm-gray mt-1">Back of the case, seen through the plastic. Spine text is added for you.</p>
            </div>
          ))}
        </Section>

        <Section n={printed ? 7 : 6} title="Preview">
          <CdMockup packaging={packaging} panelCount={panelCount} gloss={gloss}
            art={Object.fromEntries(Object.entries(art).filter(([, a]) => a).map(([k, a]) => [k, a.preview]))}
            artistName={info.artistName} albumTitle={info.albumTitle} />
        </Section>

        <CdTerms />

        {/* Summary */}
        <div className="border border-warm-gray-light p-5">
          <p style={eyebrow}>Your order</p>
          <div className="flex flex-col gap-1 font-mono text-[12px] mb-4">
            {price.lines.filter(l => l.each > 0).map(l => (
              <div key={l.label} className="flex justify-between gap-3">
                <span className="text-warm-gray">{l.label}</span>
                <span className="text-ink">{fmtCents(l.each)}</span>
              </div>
            ))}
            {price.discountPct > 0 && (
              <div className="flex justify-between"><span className="text-warm-gray">Volume discount</span><span className="text-earth">−{price.discountPct}%</span></div>
            )}
            <div className="flex justify-between border-t border-warm-gray-light pt-2 mt-1">
              <span className="text-warm-gray">{price.config.qty} discs × {fmtCents(price.perDisc)}</span>
              <span className="text-ink">{fmtCents(price.discsTotal)}</span>
            </div>
            <div className="flex justify-between"><span className="text-warm-gray">Setup fee (one per order)</span><span className="text-ink">{fmtCents(price.setupFee)}</span></div>
            {price.rushFee > 0 && (
              <div className="flex justify-between"><span className="text-warm-gray">Rush, under {CD_PRICING.rushDays} days (+{CD_PRICING.rushPct}%)</span><span className="text-ink">{fmtCents(price.rushFee)}</span></div>
            )}
            <div className="flex justify-between"><span className="text-warm-gray">Indiana sales tax ({Math.round(CD_PRICING.taxRate * 100)}%)</span><span className="text-ink">{fmtCents(price.tax)}</span></div>
            {price.shipping > 0 && (
              <div className="flex justify-between"><span className="text-warm-gray">Shipping (US flat rate)</span><span className="text-ink">{fmtCents(price.shipping)}</span></div>
            )}
            <div className="flex justify-between border-t border-warm-gray-light pt-2 mt-1 text-[14px]">
              <span className="text-ink">Total</span><span className="text-ink font-medium">{fmtCents(price.total)}</span>
            </div>
            <div className="flex justify-between text-[13px]">
              <span className="text-earth">{price.isDeposit ? `Due today (${CD_PRICING.depositPct}% deposit)` : 'Due today'}</span>
              <span className="text-earth font-medium">{fmtCents(price.dueNow)}</span>
            </div>
            {price.isDeposit && (
              <div className="flex justify-between text-[11px]">
                <span className="text-warm-gray">Balance, emailed when your CDs are ready</span>
                <span className="text-warm-gray">{fmtCents(price.balance)}</span>
              </div>
            )}
          </div>

          {printed && (
            <label className="flex items-start gap-2 font-mono text-[11px] text-ink mb-4 cursor-pointer">
              <input type="checkbox" checked={removeCredit} onChange={e => setRemoveCredit(e.target.checked)} className="mt-0.5" />
              <span>Leave off the small "Printed at Art Saturated" credit (+{fmtCents(CD_PRICING.removeCredit)}/disc)</span>
            </label>
          )}

          <div className="grid sm:grid-cols-3 gap-2 mb-4">
            <input style={inp} placeholder="Your name" value={info.name} onChange={e => setInfo(i => ({ ...i, name: e.target.value }))} autoComplete="name" />
            <input style={inp} type="email" placeholder="Email" value={info.email} onChange={e => setInfo(i => ({ ...i, email: e.target.value }))} autoComplete="email" />
            <input style={inp} type="tel" placeholder="Phone (optional)" value={info.phone} onChange={e => setInfo(i => ({ ...i, phone: e.target.value }))} autoComplete="tel" />
          </div>

          <p className="font-mono text-[10px] mb-4" style={noteBox}>
            No proof round: production starts when payment clears, and we print your files as submitted.
            {rush ? `Ready in under ${CD_PRICING.rushDays} days.` : 'Ready in 7–14 days.'} Reorder within {Math.round(CD_PRICING.retentionDays / 30.5)} months with no setup fee at the same rate.
            {' '}<a href="#terms" style={{ color: '#d4b870', textDecoration: 'underline' }}>Full terms</a>.
          </p>

          <div className="flex flex-col gap-2 mb-5 font-mono text-[11px] text-ink">
            {[
              ['final',  'My audio and artwork are final and print-ready.'],
              ['rights', 'I own or have the rights to everything I uploaded.'],
              ['terms',  'I agree to the CD Printing Terms of Service above.'],
            ].map(([k, label]) => (
              <label key={k} className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" checked={agree[k]} onChange={e => setAgree(a => ({ ...a, [k]: e.target.checked }))} className="mt-0.5" />
                <span>{label}</span>
              </label>
            ))}
          </div>

          {error && <p className="font-mono text-[12px] text-red-500 mb-4" role="alert">{error}</p>}

          <button type="submit" disabled={busy} className="btn-outline w-full text-center">
            {busy
              ? <span className="flex items-center justify-center gap-2"><Spinner />{busyMsg || 'Working…'}</span>
              : `Pay ${fmtCents(price.dueNow)} & place order`}
          </button>
          <p className="font-mono text-[10px] text-warm-gray text-center mt-2">Secure checkout by Stripe.</p>
        </div>
      </form>
      </>
      )}

      {crop && (
        <ImageCropperModal
          file={crop.file}
          title={crop.title}
          aspect={crop.aspect}
          outW={crop.outW || 1500}
          round={crop.round}
          onDone={blob => { setArtBlob(crop.key, blob); setCrop(null) }}
          onCancel={() => setCrop(null)}
        />
      )}
    </div>
  )
}

function SignInPrompt({ from, text }) {
  return (
    <div className="border border-warm-gray-light p-6 text-center max-w-md mx-auto my-8">
      <p className="font-mono text-[13px] text-ink mb-4 leading-relaxed">{text}</p>
      <Link to="/login" state={{ from }} className="btn-outline inline-block">Sign in or create an account</Link>
    </div>
  )
}
