/**
 * CropModal — pan/zoom crop with loupe magnifier
 *
 * Mobile-first approach: the crop frame is FIXED, the IMAGE moves beneath it.
 * No draggable handles = no accidental resets on touch.
 *
 * • Drag/swipe  → pan image
 * • Pinch       → zoom image
 * • Rotate 90°  → rotate image
 * • Loupe       → magnified circle appears in opposite corner while dragging
 * • Apply       → canvas extracts whatever sits inside the crop frame
 */
import { useState, useRef, useEffect, useCallback } from 'react'

// ── Constants ─────────────────────────────────────────────────────────────────
const FRAME_MAX  = 320   // max crop-frame px (responsive: capped by viewport)
const OUT_PX     = 1200  // output canvas long-edge px

// ── Aspect presets ────────────────────────────────────────────────────────────
const ASPECTS = [
  { label: 'Free', w: 1, h: 1, free: true },
  { label: '1:1',  w: 1, h: 1  },
  { label: '4:3',  w: 4, h: 3  },
  { label: '3:4',  w: 3, h: 4  },
  { label: '2:1',  w: 2, h: 1  },
  { label: '16:9', w: 16, h: 9 },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }
function dist2(a, b) {
  const dx = a.clientX - b.clientX, dy = a.clientY - b.clientY
  return Math.sqrt(dx * dx + dy * dy)
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function CropModal({ file, preview, title, onConfirm, onCancel, defaultAspect }) {
  // Map defaultAspect number → closest preset index
  const defaultAspectIdx = ASPECTS.findIndex(a =>
    !a.free && Math.abs((a.w / a.h) - (defaultAspect ?? 1)) < 0.01
  )
  const [aspectIdx,  setAspectIdx]  = useState(defaultAspectIdx > 0 ? defaultAspectIdx : 1)
  const [rotation,   setRotation]   = useState(0)       // 0 | 90 | 180 | 270
  const [pan,        setPan]        = useState({ x: 0, y: 0 })
  const [zoom,       setZoom]       = useState(1)
  const [imgNat,     setImgNat]     = useState({ w: 1, h: 1 })
  const [frameSize,  setFrameSize]  = useState({ w: FRAME_MAX, h: FRAME_MAX })
  const [brightness, setBrightness] = useState(100)     // 50–200 %
  const [applying,   setApplying]   = useState(false)
  const [rotating,   setRotating]   = useState(false)
  const [applyError, setApplyError] = useState('')

  const containerRef = useRef()
  const cropDivRef   = useRef()        // ref on the crop viewport div for direct DOM listeners
  const drag         = useRef(null)
  const pinch        = useRef(null)
  const imgLoadedRef = useRef(false)
  const imgElRef     = useRef(new Image())

  // Single ref that always mirrors current state — safe to read inside DOM event handlers
  const minZoomRef = useRef(0.1)   // updated by resetZoom to the actual fill-zoom floor
  const stateRef   = useRef({ zoom, pan, rotation, frameSize, imgNat, minZoom: 0.1 })
  useEffect(() => { stateRef.current = { zoom, pan, rotation, frameSize, imgNat, minZoom: minZoomRef.current } })

  // Overhead = header + controls + brightness slider + hint + footer (px, conservative)
  const OVERHEAD_PX = 230

  const aspect = ASPECTS[aspectIdx]

  // ── Compute frame size from container + aspect ──────────────────────────────
  useEffect(() => {
    function measure() {
      const el = containerRef.current
      if (!el) return
      // Cap frame by both container width AND remaining viewport height (mobile fix)
      const maxByVH = Math.max(120, Math.floor(window.innerHeight * 0.94 - OVERHEAD_PX))
      const avail   = Math.min(el.clientWidth - 32, FRAME_MAX, maxByVH)
      const ratio   = aspect.free ? 1 : aspect.w / aspect.h
      if (ratio >= 1) setFrameSize({ w: avail,                    h: Math.round(avail / ratio) })
      else            setFrameSize({ w: Math.round(avail * ratio), h: avail })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [aspectIdx, aspect])

  // ── Load image natural size + set initial fill zoom ─────────────────────────
  // This image is for visual display + zoom/pan math ONLY — no crossOrigin needed.
  // crossOrigin is applied separately in handleApply when drawing to canvas.
  useEffect(() => {
    const img = imgElRef.current
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight
      setImgNat({ w, h })
      imgLoadedRef.current = true
      resetZoom(w, h, frameSize, rotation)
    }
    img.src = preview
  }, [preview]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset zoom/pan whenever frame or rotation changes (after image loaded)
  useEffect(() => {
    if (imgLoadedRef.current) resetZoom(imgNat.w, imgNat.h, frameSize, rotation)
  }, [frameSize, rotation]) // eslint-disable-line react-hooks/exhaustive-deps

  function resetZoom(nw, nh, fs, rot) {
    const swap     = rot === 90 || rot === 270
    const iw       = swap ? nh : nw
    const ih       = swap ? nw : nh
    const fillZoom = Math.max(fs.w / iw, fs.h / ih)
    minZoomRef.current = fillZoom   // floor = image exactly fills the frame
    setZoom(fillZoom)
    setPan({ x: 0, y: 0 })
  }

  function clampPan(px, py, z, rot, fs) {
    const swap = rot === 90 || rot === 270
    const iw   = (swap ? imgNat.h : imgNat.w) * z
    const ih   = (swap ? imgNat.w : imgNat.h) * z
    const maxX = Math.max(0, (iw - fs.w) / 2)
    const maxY = Math.max(0, (ih - fs.h) / 2)
    return { x: clamp(px, -maxX, maxX), y: clamp(py, -maxY, maxY) }
  }

  // ── Pointer events (drag to pan) ────────────────────────────────────────────
  function onPointerDown(e) {
    if (e.touches?.length === 2) return    // let pinch handle it
    e.currentTarget?.setPointerCapture?.(e.pointerId)
    const cx = e.clientX ?? e.touches?.[0]?.clientX
    const cy = e.clientY ?? e.touches?.[0]?.clientY
    drag.current = { startX: cx, startY: cy, panX: pan.x, panY: pan.y }
  }
  function onPointerMove(e) {
    if (!drag.current || pinch.current) return
    const cx = e.clientX ?? e.touches?.[0]?.clientX
    const cy = e.clientY ?? e.touches?.[0]?.clientY
    if (cx == null) return
    const nx = drag.current.panX + (cx - drag.current.startX)
    const ny = drag.current.panY + (cy - drag.current.startY)
    const clamped = clampPan(nx, ny, zoom, rotation, frameSize)
    setPan(clamped)
  }
  function onPointerUp() {
    drag.current = null
  }

  // ── Touch pinch zoom — attached directly as non-passive so preventDefault works ──
  useEffect(() => {
    const el = cropDivRef.current
    if (!el) return

    function onTouchStart(e) {
      if (e.touches.length !== 2) return
      e.preventDefault()
      drag.current = null
      const d = dist2(e.touches[0], e.touches[1])
      if (d < 10) return
      pinch.current = { dist: d }
    }

    function onTouchMove(e) {
      if (!pinch.current || e.touches.length !== 2) return
      e.preventDefault()
      const d = dist2(e.touches[0], e.touches[1])
      const delta = d / pinch.current.dist        // incremental ratio this frame
      const { zoom: z, pan: p, rotation: r, frameSize: fs, imgNat: nat, minZoom } = stateRef.current
      const newZ = clamp(z * delta, minZoom, 5)

      // Inline clampPan using live stateRef values
      const swap = r === 90 || r === 270
      const iw   = (swap ? nat.h : nat.w) * newZ
      const ih   = (swap ? nat.w : nat.h) * newZ
      const maxX = Math.max(0, (iw - fs.w) / 2)
      const maxY = Math.max(0, (ih - fs.h) / 2)
      const newPan = { x: clamp(p.x, -maxX, maxX), y: clamp(p.y, -maxY, maxY) }

      // Update stateRef immediately so the NEXT touchmove sees the new zoom
      stateRef.current = { ...stateRef.current, zoom: newZ, pan: newPan }
      pinch.current.dist = d
      setZoom(newZ)
      setPan(newPan)
    }

    function onTouchEnd(e) {
      if (e.touches.length < 2) pinch.current = null
    }

    el.addEventListener('touchstart', onTouchStart, { passive: false })
    el.addEventListener('touchmove',  onTouchMove,  { passive: false })
    el.addEventListener('touchend',   onTouchEnd,   { passive: true  })
    return () => {
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove',  onTouchMove)
      el.removeEventListener('touchend',   onTouchEnd)
    }
  }, []) // mount once — all values read from stateRef

  // ── Scroll zoom ──────────────────────────────────────────────────────────────
  function onWheel(e) {
    e.preventDefault()
    const newZ    = clamp(zoom * (1 - e.deltaY * 0.002), minZoomRef.current, 5)
    const clamped = clampPan(pan.x, pan.y, newZ, rotation, frameSize)
    setZoom(newZ)
    setPan(clamped)
  }

  // ── Rotation ─────────────────────────────────────────────────────────────────
  async function handleRotate() {
    setRotating(true)
    const next = (rotation + 90) % 360
    setRotation(next)
    setRotating(false)
  }

  // ── Apply: draw image → canvas → blob → File ─────────────────────────────────
  async function handleApply() {
    setApplying(true)
    setApplyError('')
    try {
      const { w: fw, h: fh } = frameSize

      // Canvas requires a CORS-safe image source to avoid a SecurityError on toBlob().
      // Blob/data URLs are same-origin — reuse the already-loaded imgElRef.
      // Remote URLs (Firebase Storage) need a fresh Image with crossOrigin='anonymous'
      // plus a cache-bust param so the browser doesn't serve a cached non-CORS entry.
      const isLocal = preview.startsWith('blob:') || preview.startsWith('data:')
      const drawImg = isLocal
        ? imgElRef.current
        : await new Promise((resolve, reject) => {
            const ci = new Image()
            ci.crossOrigin = 'anonymous'
            ci.onload  = () => resolve(ci)
            ci.onerror = () => reject(new Error('cors'))
            ci.src = `${preview}${preview.includes('?') ? '&' : '?'}_cb=${Date.now()}`
          })

      const scale = OUT_PX / Math.max(fw, fh)
      const outW  = Math.round(fw * scale)
      const outH  = Math.round(fh * scale)
      const s     = scale

      const canvas = document.createElement('canvas')
      canvas.width  = outW
      canvas.height = outH
      const ctx = canvas.getContext('2d')

      ctx.beginPath()
      ctx.rect(0, 0, outW, outH)
      ctx.clip()

      ctx.save()
      if (brightness !== 100) ctx.filter = `brightness(${brightness}%)`
      ctx.translate((fw / 2 + pan.x) * s, (fh / 2 + pan.y) * s)
      ctx.rotate((rotation * Math.PI) / 180)
      ctx.scale(zoom * s, zoom * s)
      ctx.drawImage(drawImg, -drawImg.naturalWidth / 2, -drawImg.naturalHeight / 2)
      ctx.restore()

      canvas.toBlob(blob => {
        if (!blob) { setApplyError('Export failed — try again.'); setApplying(false); return }
        const outFile    = new File([blob], file?.name ?? 'photo.jpg', { type: 'image/jpeg' })
        const outPreview = URL.createObjectURL(outFile)
        setApplying(false)
        onConfirm(outFile, outPreview)
      }, 'image/jpeg', 0.93)
    } catch (err) {
      console.error('Crop apply error', err)
      setApplyError(
        err.message === 'cors'
          ? 'CORS not configured — run: gsutil cors set cors.json gs://art-saturated.firebasestorage.app'
          : 'Failed to apply — try again.'
      )
      setApplying(false)
    }
  }

  // ── Derived image CSS transform ───────────────────────────────────────────────
  const imgStyle = {
    position: 'absolute',
    top: '50%', left: '50%',
    width:  `${imgNat.w}px`,
    height: `${imgNat.h}px`,
    transformOrigin: 'center',
    transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px)) rotate(${rotation}deg) scale(${zoom})`,
    filter: brightness !== 100 ? `brightness(${brightness}%)` : undefined,
    maxWidth: 'none',
    pointerEvents: 'none',
    userSelect: 'none',
    willChange: 'transform',
  }

  const btnPill = (active) => ({
    fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.08em',
    textTransform: 'uppercase', padding: '6px 11px', border: '1px solid',
    cursor: 'pointer', transition: 'all 0.12s',
    background:  active ? '#1a1208' : 'transparent',
    borderColor: active ? '#1a1208' : '#d4c9bb',
    color:       active ? '#f2ebe0' : '#8a5c3a',
  })

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(16,12,8,0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '12px',
      touchAction: 'none',
    }}>
      <div
        ref={containerRef}
        style={{
          background: '#faf8f4', width: '100%', maxWidth: '480px',
          maxHeight: '94vh', display: 'flex', flexDirection: 'column',
          borderRadius: '3px', overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderBottom: '1px solid #e8e0d4', flexShrink: 0 }}>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#1a1208', margin: 0 }}>{title || 'Crop & Rotate'}</p>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#8a5c3a', padding: 0, lineHeight: 1 }}>✕</button>
        </div>

        {/* Controls: rotate + aspect — horizontally scrollable so they never wrap on mobile */}
        <div style={{ display: 'flex', gap: '6px', padding: '8px 14px', borderBottom: '1px solid #e8e0d4', alignItems: 'center', flexShrink: 0, overflowX: 'auto', flexWrap: 'nowrap', WebkitOverflowScrolling: 'touch' }}>
          <button
            onClick={handleRotate}
            disabled={rotating}
            style={{
              fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.08em',
              textTransform: 'uppercase', padding: '6px 12px',
              border: '1px solid #a08060', background: '#f2ebe0', color: '#5a4030',
              cursor: rotating ? 'wait' : 'pointer', opacity: rotating ? 0.6 : 1,
              display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0,
            }}
          >
            ↺ {rotation}°
          </button>
          <div style={{ width: '1px', height: '20px', background: '#d4c9bb', flexShrink: 0 }} />
          {ASPECTS.map((a, i) => (
            <button key={a.label} style={{ ...btnPill(aspectIdx === i), flexShrink: 0 }} onClick={() => setAspectIdx(i)}>
              {a.label}
            </button>
          ))}
        </div>

        {/* Brightness slider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 14px 4px', borderBottom: '1px solid #e8e0d4', flexShrink: 0 }}>
          <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a5c3a', textTransform: 'uppercase', letterSpacing: '0.08em', whiteSpace: 'nowrap', userSelect: 'none' }}>
            ☀ Brightness
          </span>
          <input
            type="range"
            min="40" max="200"
            value={brightness}
            onChange={e => setBrightness(Number(e.target.value))}
            style={{ flex: 1, accentColor: '#a08060', cursor: 'pointer' }}
          />
          <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#1a1208', minWidth: '34px', textAlign: 'right', userSelect: 'none' }}>
            {brightness}%
          </span>
          {brightness !== 100 && (
            <button
              type="button"
              onClick={() => setBrightness(100)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: '9px', color: '#b97a30', padding: '0 0 0 2px', letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}
            >
              Reset
            </button>
          )}
        </div>

        {/* Crop viewport */}
        <div style={{ flex: 1, background: '#1a1208', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', overflow: 'hidden', flexShrink: 0 }}>
          <div
            ref={cropDivRef}
            style={{
              position: 'relative',
              width:  `${frameSize.w}px`,
              height: `${frameSize.h}px`,
              overflow: 'hidden',
              cursor: 'grab',
              touchAction: 'none',
              userSelect: 'none',
              outline: '2px solid rgba(212,184,112,0.85)',
              outlineOffset: '0px',
              flexShrink: 0,
            }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          >
            {/* Image */}
            <img src={preview} alt="" style={imgStyle} draggable={false} />

            {/* Rule-of-thirds grid */}
            <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
              {[33.33, 66.66].map(p => (
                <div key={`v${p}`} style={{ position: 'absolute', left: `${p}%`, top: 0, bottom: 0, borderLeft: '1px solid rgba(212,184,112,0.18)' }} />
              ))}
              {[33.33, 66.66].map(p => (
                <div key={`h${p}`} style={{ position: 'absolute', top: `${p}%`, left: 0, right: 0, borderTop: '1px solid rgba(212,184,112,0.18)' }} />
              ))}
            </div>

            {/* Corner markers */}
            {[[0,0],[1,0],[0,1],[1,1]].map(([cx, cy]) => (
              <div key={`${cx}${cy}`} style={{
                position: 'absolute',
                [cx ? 'right' : 'left']:   '0px',
                [cy ? 'bottom' : 'top']:   '0px',
                width: '16px', height: '16px',
                borderTop:    cy ? 'none' : '2px solid #d4b870',
                borderBottom: cy ? '2px solid #d4b870' : 'none',
                borderLeft:   cx ? 'none' : '2px solid #d4b870',
                borderRight:  cx ? '2px solid #d4b870' : 'none',
                pointerEvents: 'none',
              }} />
            ))}

          </div>
        </div>

        <p style={{ fontFamily: 'monospace', fontSize: '9px', color: '#9a7050', textAlign: 'center', padding: '4px 0 2px', letterSpacing: '0.08em', flexShrink: 0 }}>
          Drag to pan · Pinch or scroll to zoom · Swipe aspect row to see all
        </p>

        {/* Apply error */}
        {applyError && (
          <p style={{ fontFamily: 'monospace', fontSize: '9px', color: '#b94040', textAlign: 'center', padding: '4px 14px 2px', flexShrink: 0, letterSpacing: '0.04em' }}>
            {applyError}
          </p>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', gap: '10px', padding: '10px 14px', borderTop: '1px solid #e8e0d4', justifyContent: 'flex-end', flexShrink: 0 }}>
          <button onClick={onCancel} style={btnPill(false)}>Cancel</button>
          <button
            onClick={handleApply}
            disabled={applying || rotating}
            style={{ ...btnPill(true), opacity: (applying || rotating) ? 0.6 : 1 }}
          >
            {applying ? 'Applying…' : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}
