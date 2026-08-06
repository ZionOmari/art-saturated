import { useState, useRef, useEffect } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'

// ── Full CD pricing (with custom booklet) ─────────────────────────────────────
function getPricePerDisc(qty) {
  if (qty === 1)  return 15.00  // 1-off demo disc
  if (qty >= 50)  return 4.50   // 50–100
  if (qty >= 20)  return 4.75   // 20–49
  return 5.00                   // 10–19 (minimum order of 10)
}
function getTotal(qty) { return qty * getPricePerDisc(qty) }
function getDeposit(qty) { return Math.ceil(getTotal(qty) * 0.5 * 100) / 100 }

const TIERS = [
  { label: '1 disc',        price: '$15.00 / disc', note: 'demo · flat rate' },
  { label: '10–19 discs',   price: '$5.00 / disc',  note: 'min. order 10'   },
  { label: '20–49 discs',   price: '$4.75 / disc',  note: ''                },
  { label: '50–100 discs',  price: '$4.50 / disc',  note: ''                },
]

// ── Disc-only pricing (no booklet) ────────────────────────────────────────────
function getDiscOnlyPricePerDisc(qty) {
  if (qty >= 100) return 4.00
  if (qty >= 50)  return 4.25
  if (qty >= 20)  return 4.50
  if (qty >= 5)   return 4.75
  return 5.00
}
function getDiscOnlyTotal(qty)   { return qty * getDiscOnlyPricePerDisc(qty) }
function getDiscOnlyDeposit(qty) { return Math.ceil(getDiscOnlyTotal(qty) * 0.5 * 100) / 100 }

const DISC_ONLY_TIERS = [
  { label: '1–4 discs',   price: '$5.00 / disc', note: '' },
  { label: '5–19 discs',  price: '$4.75 / disc', note: '' },
  { label: '20–49 discs', price: '$4.50 / disc', note: '' },
  { label: '50–99 discs', price: '$4.25 / disc', note: '' },
  { label: '100+ discs',  price: '$4.00 / disc', note: '' },
]

// ── Image cropper ─────────────────────────────────────────────────────────────
const CROP_DISPLAY = 280
const CROP_OUTPUT  = 1200

function ImageCropperModal({ file, index, onDone, onCancel }) {
  const [imgSrc,     setImgSrc]     = useState('')
  const [pos,        setPos]        = useState({ x: 0, y: 0 })
  const [scale,      setScale]      = useState(1)
  const [natSize,    setNatSize]    = useState({ w: 0, h: 0 })
  const [dragging,   setDragging]   = useState(false)
  const [lastMouse,  setLastMouse]  = useState({ x: 0, y: 0 })
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
    const s = CROP_DISPLAY / Math.min(w, h)
    setScale(s)
    setPos({ x: -(w * s - CROP_DISPLAY) / 2, y: -(h * s - CROP_DISPLAY) / 2 })
  }

  function clamp(p, s) {
    const dw = natSize.w * s, dh = natSize.h * s
    return {
      x: Math.min(0, Math.max(p.x, CROP_DISPLAY - dw)),
      y: Math.min(0, Math.max(p.y, CROP_DISPLAY - dh)),
    }
  }

  function down(cx, cy) { setDragging(true); setLastMouse({ x: cx, y: cy }) }
  function move(cx, cy) {
    if (!dragging) return
    setPos(p => clamp({ x: p.x + cx - lastMouse.x, y: p.y + cy - lastMouse.y }, scale))
    setLastMouse({ x: cx, y: cy })
  }
  function up() { setDragging(false) }

  function handleDone() {
    const canvas = canvasRef.current
    canvas.width = canvas.height = CROP_OUTPUT
    const ctx = canvas.getContext('2d')
    const sx = -pos.x / scale
    const sy = -pos.y / scale
    const sw = CROP_DISPLAY / scale
    ctx.drawImage(imgRef.current, sx, sy, sw, sw, 0, 0, CROP_OUTPUT, CROP_OUTPUT)
    canvas.toBlob(blob => onDone(blob, index), 'image/jpeg', 0.92)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div style={{ background: '#f5f1e8', padding: '24px', maxWidth: '360px', width: '100%' }}>
        <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#7a5030', marginBottom: '4px' }}>
          Panel {index + 1} — Crop to Square
        </p>
        <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#a08060', marginBottom: '14px' }}>
          Drag to reposition
        </p>

        <div
          style={{ width: CROP_DISPLAY, height: CROP_DISPLAY, overflow: 'hidden', position: 'relative', background: '#1a1814', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none', touchAction: 'none' }}
          onMouseDown={e => { e.preventDefault(); down(e.clientX, e.clientY) }}
          onMouseMove={e => move(e.clientX, e.clientY)}
          onMouseUp={up} onMouseLeave={up}
          onTouchStart={e => { e.preventDefault(); down(e.touches[0].clientX, e.touches[0].clientY) }}
          onTouchMove={e => { e.preventDefault(); move(e.touches[0].clientX, e.touches[0].clientY) }}
          onTouchEnd={up}
        >
          {imgSrc && (
            <img ref={imgRef} src={imgSrc} onLoad={handleLoad} draggable={false}
              style={{ position: 'absolute', left: pos.x, top: pos.y, width: natSize.w * scale, height: natSize.h * scale, pointerEvents: 'none' }} />
          )}
          {/* Rule-of-thirds grid */}
          <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
            {[33.33, 66.66].map(p => (
              <div key={p} style={{ position: 'absolute', left: `${p}%`, top: 0, bottom: 0, borderLeft: '1px solid rgba(255,255,255,0.12)' }} />
            ))}
            {[33.33, 66.66].map(p => (
              <div key={p} style={{ position: 'absolute', top: `${p}%`, left: 0, right: 0, borderTop: '1px solid rgba(255,255,255,0.12)' }} />
            ))}
            <div style={{ position: 'absolute', inset: 0, border: '2px solid rgba(255,255,255,0.25)', boxSizing: 'border-box' }} />
          </div>
        </div>

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

// ── Main page ─────────────────────────────────────────────────────────────────
const inp = {
  width: '100%', fontFamily: 'monospace', fontSize: '13px', padding: '10px 12px',
  border: '1px solid #a08060', background: 'rgba(236,230,217,0.6)', color: '#1a1814',
  outline: 'none', boxSizing: 'border-box',
}
const eyebrow = {
  fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase',
  color: '#d4b870', marginBottom: '8px', display: 'block',
}

const PANEL_LABELS = {
  2: ['Front Cover', 'Back Cover / Tracklist'],
  4: ['Front Cover', 'Inside Left', 'Inside Right', 'Back Cover'],
}

export default function QuoteRequestPage() {
  const [orderType,   setOrderType]   = useState('full')   // 'full' | 'disc-only'
  const [form,        setForm]        = useState({ name: '', email: '', phone: '', qty: 10, notes: '' })
  const [panelCount,  setPanelCount]  = useState(4)          // 2 or 4
  const [tracks,      setTracks]      = useState([{ title: '' }])
  const [audioFiles,  setAudioFiles]  = useState([])         // File[] per track (indexed)

  // Panel images (cropped square)
  const [imgBlobs,    setImgBlobs]    = useState([null, null, null, null])
  const [imgPreviews, setImgPreviews] = useState([null, null, null, null])
  const [cropFile,    setCropFile]    = useState(null)
  const [cropIndex,   setCropIndex]   = useState(null)
  const imgInputRefs  = [useRef(), useRef(), useRef(), useRef()]

  // Extra images drop bucket (no crop, max panelCount + 2)
  const [extraFiles,    setExtraFiles]    = useState([])    // File[]
  const [extraPreviews, setExtraPreviews] = useState([])    // blob URL[]
  const extraInputRef = useRef()

  const [uploading,  setUploading]  = useState(false)
  const [uploadMsg,  setUploadMsg]  = useState('')
  const [submitted,  setSubmitted]  = useState(false)
  const [error,      setError]      = useState('')
  const audioInputRef = useRef()

  const extraMax = panelCount + 2   // 4 for 2-panel, 6 for 4-panel

  // When panel count changes, trim panel blobs/previews to new count
  useEffect(() => {
    setImgBlobs(prev    => { const n = [...prev]; n.length = panelCount; return n.map(v => v ?? null) })
    setImgPreviews(prev => { const n = [...prev]; n.length = panelCount; return n.map(v => v ?? null) })
  }, [panelCount])

  const isDiscOnly = orderType === 'disc-only'
  const rawQty     = parseInt(form.qty) || 1
  const qty        = isDiscOnly ? Math.max(1, rawQty) : (rawQty === 1 ? 1 : Math.max(10, rawQty))
  const qtyError   = !isDiscOnly && rawQty > 1 && rawQty < 10 ? 'Minimum order is 10 discs (or 1 for a demo disc).' : ''
  const perDisc  = isDiscOnly ? getDiscOnlyPricePerDisc(qty) : getPricePerDisc(qty)
  const total    = isDiscOnly ? getDiscOnlyTotal(qty)        : getTotal(qty)
  const deposit  = isDiscOnly ? getDiscOnlyDeposit(qty)      : getDeposit(qty)

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      imgPreviews.forEach(u => u && URL.revokeObjectURL(u))
      extraPreviews.forEach(u => u && URL.revokeObjectURL(u))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Extra images ──
  function handleExtraFiles(e) {
    const incoming = Array.from(e.target.files)
    e.target.value = ''
    setExtraFiles(prev => {
      const slots = extraMax - prev.length
      if (slots <= 0) return prev
      return [...prev, ...incoming.slice(0, slots)]
    })
    setExtraPreviews(prev => {
      const slots = extraMax - prev.length
      if (slots <= 0) return prev
      return [...prev, ...incoming.slice(0, slots).map(f => URL.createObjectURL(f))]
    })
  }

  function removeExtra(i) {
    if (extraPreviews[i]) URL.revokeObjectURL(extraPreviews[i])
    setExtraFiles(prev    => prev.filter((_, idx) => idx !== i))
    setExtraPreviews(prev => prev.filter((_, idx) => idx !== i))
  }

  // ── Track list helpers ──
  function addTrack()           { setTracks(t => [...t, { title: '' }]) }
  function removeTrack(i)       {
    setTracks(t => t.filter((_, idx) => idx !== i))
    setAudioFiles(f => f.filter((_, idx) => idx !== i))
  }
  function updateTrack(i, val)  { setTracks(t => t.map((tr, idx) => idx === i ? { title: val } : tr)) }

  // ── Audio upload ──
  function handleAudioChange(e) {
    const files = Array.from(e.target.files)
    // Map by position: if they upload multiple, assign in order filling blanks first
    setAudioFiles(prev => {
      const next = [...prev]
      let fileIdx = 0
      for (let i = 0; i < tracks.length && fileIdx < files.length; i++) {
        if (!next[i]) { next[i] = files[fileIdx++] }
      }
      // if still files left, replace from start
      for (let i = 0; i < tracks.length && fileIdx < files.length; i++) {
        next[i] = files[fileIdx++]
      }
      return next
    })
    e.target.value = ''
  }

  function removeAudio(i) {
    setAudioFiles(prev => { const n = [...prev]; n[i] = null; return n })
  }

  // ── Image crop flow ──
  function handleImgSelect(e, idx) {
    const file = e.target.files[0]
    if (!file) return
    setCropFile(file)
    setCropIndex(idx)
    e.target.value = ''
  }

  function handleCropDone(blob, idx) {
    const url = URL.createObjectURL(blob)
    setImgBlobs(prev  => { const n = [...prev];  n[idx] = blob; return n })
    setImgPreviews(prev => { const n = [...prev]; if (n[idx]) URL.revokeObjectURL(n[idx]); n[idx] = url; return n })
    setCropFile(null); setCropIndex(null)
  }

  function removeImage(idx) {
    if (imgPreviews[idx]) URL.revokeObjectURL(imgPreviews[idx])
    setImgBlobs(prev    => { const n = [...prev]; n[idx] = null; return n })
    setImgPreviews(prev => { const n = [...prev]; n[idx] = null; return n })
  }

  // ── Validation ──
  function validate() {
    if (!form.name.trim())  return 'Please enter your name.'
    if (!form.email.trim()) return 'Please enter your email.'
    if (qty < 1)            return 'Quantity must be at least 1.'
    if (!isDiscOnly) {
      if (tracks.length === 0) return 'Add at least one track.'
      if (tracks.some(t => !t.title.trim())) return 'Please fill in all track titles.'
      if (tracks.some((_, i) => !audioFiles[i])) return 'Please upload an audio file for each track.'
      const panelBlobs = imgBlobs.slice(0, panelCount)
      if (panelBlobs.some(b => !b)) return `Please upload and crop all ${panelCount} booklet panel images.`
    }
    return null
  }

  // ── Submit ──
  async function handleSubmit(e) {
    e.preventDefault()
    const err = validate()
    if (err) { setError(err); return }
    setError('')
    setUploading(true)

    try {
      const timestamp = Date.now()

      let imageURLs = [], extraURLs = [], audioURLs = []

      if (!isDiscOnly) {
        // Upload booklet panel images
        setUploadMsg('Uploading booklet images…')
        const panelBlobs = imgBlobs.slice(0, panelCount)
        imageURLs = await Promise.all(panelBlobs.map(async (blob, i) => {
          const storageRef = ref(storage, `quotes/${timestamp}/panel_${i}.jpg`)
          await uploadBytes(storageRef, blob, { contentType: 'image/jpeg' })
          return getDownloadURL(storageRef)
        }))

        // Upload extra drop-bucket images
        if (extraFiles.length > 0) {
          setUploadMsg('Uploading extra images…')
          extraURLs = await Promise.all(extraFiles.map(async (file, i) => {
            const ext = file.name.split('.').pop()
            const storageRef = ref(storage, `quotes/${timestamp}/extra_${i}.${ext}`)
            await uploadBytes(storageRef, file)
            return getDownloadURL(storageRef)
          }))
        }

        // Upload audio files
        setUploadMsg('Uploading audio files…')
        audioURLs = await Promise.all(audioFiles.map(async (file, i) => {
          const ext = file.name.split('.').pop()
          const storageRef = ref(storage, `quotes/${timestamp}/track_${i + 1}_${file.name}`)
          await uploadBytes(storageRef, file)
          return { name: file.name, url: await getDownloadURL(storageRef), track: tracks[i].title }
        }))
      }

      // Save to Firestore
      setUploadMsg('Saving request…')
      await addDoc(collection(db, 'quoteRequests'), {
        orderType,
        name:           form.name.trim(),
        email:          form.email.trim(),
        phone:          form.phone.trim(),
        qty,
        ...(isDiscOnly ? {} : { panelCount, trackList: tracks.map(t => t.title.trim()), audioFiles: audioURLs, bookletImages: imageURLs, extraImages: extraURLs }),
        pricePerDisc:   perDisc,
        estimatedTotal: total,
        depositAmount:  deposit,
        notes:          form.notes.trim(),
        status:         'pending',
        createdAt:      serverTimestamp(),
      })

      setSubmitted(true)
    } catch (err) {
      console.error(err)
      setError('Upload failed. Check your connection and try again.')
    } finally {
      setUploading(false)
      setUploadMsg('')
    }
  }

  // ── Success screen ──
  if (submitted) return (
    <main className="pt-[60px]">
      <div className="max-w-2xl mx-auto px-6 pt-16 pb-24 text-center">
        <p style={{ fontSize: '2.5rem', marginBottom: '16px' }}>✦</p>
        <h1 className="font-serif text-[2rem] font-normal mb-4">Quote request received.</h1>
        <p className="font-mono text-[13px] text-warm-gray leading-relaxed mb-2">
          We'll review your order and reach out to confirm the quote and secure your deposit.
        </p>
        <p className="font-mono text-[13px] text-warm-gray leading-relaxed mb-8">
          Turnaround is 7–14 days after deposit is received. Thank you!
        </p>
        <a href="/shop" className="btn-outline">Back to Shop</a>
      </div>
      <Footer />
    </main>
  )

  return (
    <main className="pt-[60px]">
      <div className="max-w-2xl mx-auto px-6 pt-12 pb-24"
        style={{ background: 'rgba(250,248,244,0.96)', backdropFilter: 'blur(4px)', minHeight: 'calc(100vh - 60px)' }}>

        {/* Header */}
        <div className="mb-8">
          <p style={eyebrow}>Physical Media</p>
          <h1 className="font-serif text-[2.2rem] font-normal mb-3">CD Order Request</h1>
        </div>

        {/* Order type toggle */}
        <div className="mb-8">
          <p style={{ ...eyebrow, marginBottom: '10px' }}>Order Type</p>
          <div style={{ display: 'flex', border: '1px solid #a08060', overflow: 'hidden', width: 'fit-content' }}>
            {[
              { key: 'full',      label: 'Full CD (with booklet)' },
              { key: 'disc-only', label: 'Disc Only' },
            ].map(({ key, label }, i) => (
              <button key={key} type="button"
                onClick={() => { setOrderType(key); setForm(f => ({ ...f, qty: key === 'full' ? 10 : 1 })) }}
                style={{
                  fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase',
                  padding: '10px 24px', border: 'none', cursor: 'pointer',
                  borderRight: i === 0 ? '1px solid #a08060' : 'none',
                  background: orderType === key ? '#1a1814' : 'transparent',
                  color:      orderType === key ? '#f5f2ec' : '#7a5030',
                  transition: 'background 0.15s, color 0.15s',
                }}>
                {label}
              </button>
            ))}
          </div>
          <p className="font-mono text-[11px] mt-3" style={{ color: '#a08060' }}>
            {isDiscOnly
              ? 'Burned discs with no custom printed booklet. Ideal for demos, promos, or digital-only releases.'
              : 'Hand-burned with a custom-designed, printed booklet. Includes artwork, tracklist, and inner sleeve.'}
          </p>
        </div>

        {/* Pricing tiers */}
        <div className="mb-10 border border-warm-gray-light">
          <p style={{ ...eyebrow, padding: '14px 16px 0', marginBottom: '0' }}>Pricing</p>
          <div className={`grid ${isDiscOnly ? 'grid-cols-3 sm:grid-cols-5' : 'grid-cols-2 sm:grid-cols-4'} divide-x divide-y divide-warm-gray-light border-t border-warm-gray-light mt-3`}>
            {(isDiscOnly ? DISC_ONLY_TIERS : TIERS).map((t, i) => (
              <div key={i} className="py-4 px-4 flex flex-col gap-1">
                <p className="font-mono text-[10px] tracking-[0.08em] uppercase text-warm-gray">{t.label}</p>
                <p className="font-mono text-[14px] text-ink font-medium">{t.price}</p>
                {t.note && <p className="font-mono text-[9px] tracking-[0.06em] uppercase text-warm-gray/70">{t.note}</p>}
              </div>
            ))}
          </div>
        </div>

        <p className="font-mono text-[13px] -mt-4 mb-8 leading-relaxed" style={{ background: 'rgba(36,20,8,0.78)', color: '#ece6d9', padding: '10px 14px', display: 'inline-block', borderRadius: '6px' }}>
          {isDiscOnly
            ? 'Burned and labeled in store. No printed insert included — bring or provide your own, or leave blank.'
            : 'Hand-burned, hand-cut, and printed in store. Include your artwork, tracks, and contact info — we\'ll send a quote and payment link to secure your deposit.'}
        </p>
        {!isDiscOnly && (
          <p className="font-mono text-[12px] mb-8 block" style={{ background: 'rgba(36,20,8,0.78)', color: '#d4b870', padding: '6px 14px', display: 'inline-block', borderRadius: '6px' }}>
            Turnaround: 7–14 days after mock-up is approved.
          </p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-8">

          {/* ── Contact ── */}
          <div>
            <p style={eyebrow}>Contact</p>
            <div className="flex flex-col gap-3">
              <input style={inp} type="text" placeholder="Name" value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <input style={inp} type="email" placeholder="Email" value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
              <input style={inp} type="tel" placeholder="Phone (optional)" value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
            </div>
          </div>

          {/* ── Quantity + price ── */}
          <div>
            <p style={eyebrow}>Quantity</p>
            <div className="flex items-center gap-4 flex-wrap">
              <input style={{ ...inp, width: '120px' }} type="number" min="1" value={form.qty}
                onChange={e => setForm(f => ({ ...f, qty: e.target.value }))} />
              <div className="font-mono text-[13px] text-ink">
                {qty} × ${perDisc.toFixed(2)} = <strong>${total.toFixed(2)}</strong>
                <span className="text-warm-gray ml-2 text-[12px]">· 50% deposit = ${deposit.toFixed(2)}</span>
              </div>
            </div>
            {qtyError && <p className="font-mono text-[11px] text-earth mt-1">{qtyError}</p>}
          </div>

          {/* ── Full CD only sections ── */}
          {!isDiscOnly && <>{/* ── Track list ── */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <p style={{ ...eyebrow, marginBottom: 0 }}>Track List</p>
              <button type="button" onClick={addTrack}
                className="font-mono text-[11px] text-earth uppercase tracking-widest bg-none border-none cursor-pointer">
                + Add Track
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {tracks.map((track, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="font-mono text-[11px] text-warm-gray w-6 text-right shrink-0">{i + 1}.</span>
                  <input style={{ ...inp, marginBottom: 0, flex: 1 }} type="text"
                    placeholder={`Track ${i + 1} title`}
                    value={track.title}
                    onChange={e => updateTrack(i, e.target.value)} />
                  {tracks.length > 1 && (
                    <button type="button" onClick={() => removeTrack(i)}
                      className="font-mono text-[11px] text-red-400 shrink-0">✕</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ── Audio files ── */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <p style={{ ...eyebrow, marginBottom: 0 }}>
                Audio Files
                <span style={{ textTransform: 'none', letterSpacing: 0, color: '#a08060', marginLeft: '8px', fontSize: '10px' }}>
                  {audioFiles.filter(Boolean).length} / {tracks.length} uploaded
                </span>
              </p>
              <button type="button" onClick={() => audioInputRef.current.click()}
                className="font-mono text-[11px] text-earth uppercase tracking-widest bg-none border-none cursor-pointer">
                Upload
              </button>
            </div>
            <input ref={audioInputRef} type="file" accept="audio/*" multiple style={{ display: 'none' }}
              onChange={handleAudioChange} />
            <div className="flex flex-col gap-1">
              {tracks.map((track, i) => (
                <div key={i} className="flex items-center justify-between border border-warm-gray-light px-3 py-2">
                  <div>
                    <span className="font-mono text-[11px] text-warm-gray mr-2">{i + 1}.</span>
                    <span className="font-mono text-[12px] text-ink">{track.title || `Track ${i + 1}`}</span>
                  </div>
                  {audioFiles[i] ? (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[10px] text-warm-gray max-w-[140px] truncate">{audioFiles[i].name}</span>
                      <button type="button" onClick={() => removeAudio(i)} className="font-mono text-[10px] text-red-400">✕</button>
                    </div>
                  ) : (
                    <span className="font-mono text-[10px] text-warm-gray/40">No file</span>
                  )}
                </div>
              ))}
            </div>
            <p className="font-mono text-[10px] mt-2" style={{ background: 'rgba(36,20,8,0.78)', color: '#ece6d9', padding: '8px 14px', borderRadius: '6px', display: 'inline-block' }}>
              MP3 or WAV. One file per track. Upload multiple at once and they'll be matched in order.
            </p>
          </div>

          {/* ── Booklet type ── */}
          <div>
            <p style={eyebrow}>Booklet Type</p>
            <div style={{ display: 'flex', gap: '0', border: '1px solid #a08060', overflow: 'hidden', width: 'fit-content', marginBottom: '8px' }}>
              {[2, 4].map((n, i) => (
                <button key={n} type="button"
                  onClick={() => setPanelCount(n)}
                  style={{
                    fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase',
                    padding: '10px 24px', border: 'none', cursor: 'pointer',
                    borderRight: i === 0 ? '1px solid #a08060' : 'none',
                    background: panelCount === n ? '#1a1814' : 'transparent',
                    color:      panelCount === n ? '#f5f2ec' : '#7a5030',
                    transition: 'background 0.15s, color 0.15s',
                  }}>
                  {n}-Panel
                </button>
              ))}
            </div>
            <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#7a5030' }}>
              {panelCount === 2
                ? '2 pages — Front Cover + Back Cover / Tracklist'
                : '4 pages — Front Cover · Inside Left · Inside Right · Back Cover'}
            </p>
          </div>

          {/* ── Booklet images ── */}
          <div>
            <p style={eyebrow}>{panelCount}-Panel Booklet Images</p>
            <p className="font-mono text-[11px] mb-4" style={{ background: 'rgba(36,20,8,0.78)', color: '#ece6d9', padding: '8px 14px', borderRadius: '6px', display: 'inline-block' }}>
              Upload {panelCount} square images — one per panel. High resolution recommended (min 1200×1200px).
            </p>
            <div className={`grid gap-3 ${panelCount === 2 ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-4'}`}>
              {Array.from({ length: panelCount }, (_, i) => (
                <div key={i} className="flex flex-col gap-1">
                  <div
                    className="aspect-square border border-warm-gray-light relative overflow-hidden cursor-pointer hover:border-ink transition-colors"
                    onClick={() => imgInputRefs[i].current.click()}
                  >
                    {imgPreviews[i] ? (
                      <>
                        <img src={imgPreviews[i]} className="w-full h-full object-cover" alt={PANEL_LABELS[panelCount][i]} />
                        <button type="button"
                          onClick={e => { e.stopPropagation(); removeImage(i) }}
                          className="absolute top-1 right-1 w-5 h-5 bg-ink text-cream font-mono text-[10px] flex items-center justify-center">
                          ✕
                        </button>
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center h-full gap-1 px-2 text-center">
                        <span className="font-mono text-[18px] text-warm-gray/40">+</span>
                        <span className="font-mono text-[9px] text-warm-gray/40 uppercase tracking-widest leading-tight">{PANEL_LABELS[panelCount][i]}</span>
                      </div>
                    )}
                  </div>
                  <p className="font-mono text-[9px] text-warm-gray text-center uppercase tracking-widest">{PANEL_LABELS[panelCount][i]}</p>
                  <input ref={imgInputRefs[i]} type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => handleImgSelect(e, i)} />
                </div>
              ))}
            </div>
          </div>

          {/* ── Extra images drop bucket ── */}
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '6px', flexWrap: 'wrap', gap: '8px' }}>
              <p style={{ ...eyebrow, marginBottom: 0 }}>
                Extra Reference Images
                <span style={{ textTransform: 'none', letterSpacing: 0, color: '#a08060', marginLeft: '8px', fontSize: '10px' }}>
                  {extraFiles.length} / {extraMax} uploaded
                </span>
              </p>
              {extraFiles.length < extraMax && (
                <button type="button" onClick={() => extraInputRef.current.click()}
                  className="font-mono text-[11px] text-earth uppercase tracking-widest bg-none border-none cursor-pointer">
                  + Add Image
                </button>
              )}
            </div>
            <p className="font-mono text-[11px] mb-4" style={{ background: 'rgba(36,20,8,0.78)', color: '#ece6d9', padding: '8px 14px', borderRadius: '6px', display: 'inline-block' }}>
              Drop up to {extraMax} reference images — inspiration, additional artwork, or photos to incorporate. These won't be cropped.
            </p>
            <input ref={extraInputRef} type="file" accept="image/*" multiple style={{ display: 'none' }}
              onChange={handleExtraFiles} />
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {/* Filled slots */}
              {extraFiles.map((file, i) => (
                <div key={i} className="relative aspect-square border border-warm-gray-light overflow-hidden">
                  <img src={extraPreviews[i]} alt={file.name} className="w-full h-full object-cover" />
                  <button type="button" onClick={() => removeExtra(i)}
                    className="absolute top-1 right-1 w-5 h-5 bg-ink text-cream font-mono text-[10px] flex items-center justify-center">
                    ✕
                  </button>
                </div>
              ))}
              {/* Empty slots */}
              {extraFiles.length < extraMax && Array.from({ length: Math.min(3, extraMax - extraFiles.length) }, (_, i) => (
                <div key={`empty-${i}`}
                  className="aspect-square border border-dashed border-warm-gray-light flex flex-col items-center justify-center gap-1 cursor-pointer hover:border-ink transition-colors"
                  onClick={() => extraInputRef.current.click()}>
                  <span className="font-mono text-[18px] text-warm-gray/30">+</span>
                </div>
              ))}
            </div>
          </div>
          </>}

          {/* ── Notes ── */}
          <div>
            <p style={eyebrow}>Notes</p>
            <textarea style={{ ...inp, minHeight: '80px', resize: 'vertical' }}
              placeholder="Special requests, disc art notes, color preferences, etc."
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          {/* ── Summary + submit ── */}
          <div className="border border-warm-gray-light p-5">
            <p style={eyebrow}>Order Summary</p>
            <div className="flex flex-col gap-1 font-mono text-[13px] mb-5">
              <div className="flex justify-between">
                <span className="text-warm-gray">Quantity</span>
                <span className="text-ink">{qty} discs</span>
              </div>
              {!isDiscOnly && (
                <div className="flex justify-between">
                  <span className="text-warm-gray">Booklet</span>
                  <span className="text-ink">{panelCount}-panel</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-warm-gray">Rate</span>
                <span className="text-ink">${perDisc.toFixed(2)} / disc</span>
              </div>
              <div className="flex justify-between border-t border-warm-gray-light pt-2 mt-1">
                <span className="text-warm-gray">Estimated total</span>
                <span className="text-ink font-medium">${total.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-warm-gray">50% deposit due</span>
                <span className="text-earth">${deposit.toFixed(2)}</span>
              </div>
            </div>
            <p className="font-mono text-[10px] mb-4" style={{ background: 'rgba(36,20,8,0.78)', color: '#ece6d9', padding: '8px 14px', borderRadius: '6px', display: 'inline-block' }}>
              Final pricing confirmed after review. You'll receive a payment link for the deposit before production begins.
            </p>

            {/* Terms & Conditions */}
            <div className="font-mono text-[10px] mb-6" style={{ background: 'rgba(36,20,8,0.78)', color: '#ece6d9', padding: '14px 16px', borderRadius: '6px', lineHeight: '1.7' }}>
              <p style={{ color: '#d4b870', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '8px', fontSize: '9px' }}>Terms & Conditions</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <li>· A digital mock-up will be sent for your approval before production begins. <strong style={{ color: '#d4b870' }}>The 7–14 day turnaround does not start until the mock-up is approved.</strong></li>
                <li>· A 50% deposit is required to secure your order. The remaining balance is due upon pickup or before shipping.</li>
                <li>· Once a mock-up is approved and production has started, changes cannot be made to artwork or track listing.</li>
                <li>· Art Saturated is not responsible for errors (typos, color differences, layout issues) approved by the client in the mock-up.</li>
                <li>· All files submitted must be owned by or licensed to the client. Art Saturated reserves the right to decline orders that violate copyright.</li>
                <li>· Deposits are non-refundable once production has begun.</li>
                <li>· <strong style={{ color: '#d4b870' }}>"Printed at Art Saturated"</strong> will appear at the base of the inside cover by default. To remove this, add <strong style={{ color: '#d4b870' }}>+$0.25 per disc</strong> to your order and note it in the comments.</li>
              </ul>
            </div>

            {error && (
              <p className="font-mono text-[12px] text-red-500 mb-4">{error}</p>
            )}

            <button type="submit" disabled={uploading} className="btn-outline w-full text-center">
              {uploading ? <span className="flex items-center justify-center gap-2"><Spinner />{uploadMsg || 'Uploading…'}</span> : 'Submit Quote Request'}
            </button>
          </div>
        </form>
      </div>

      {cropFile !== null && (
        <ImageCropperModal
          file={cropFile}
          index={cropIndex}
          onDone={handleCropDone}
          onCancel={() => { setCropFile(null); setCropIndex(null) }}
        />
      )}

      <Footer />
    </main>
  )
}
