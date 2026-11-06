import { useEffect, useRef, useState } from 'react'
import { PIECES, aspectOf, dpiQuality, effectiveDpi, guides, sizePx } from '../../functions/cdSpecs.mjs'

// Crops a customer's image to a CD print piece (functions/cdSpecs.mjs) and
// outputs it at exact print size. The frame is the full file, bleed included;
// the overlay shows where it will be cut, the safe area for text, the tray
// spines and the disc hub. Guides are only an overlay — never in the output.

const mono = { fontFamily: 'monospace' }
const CUT = '#ffffff'
const SAFE = '#7fe0ff'
const MAX_ZOOM = 4

const QUALITY = {
  good:   { color: '#3a7a40', text: dpi => `Sharp: prints at about ${dpi} dpi.` },
  soft:   { color: '#a06a10', text: dpi => `Prints at about ${dpi} dpi and may look slightly soft. A larger image would be sharper.` },
  blurry: { color: '#b03020', text: dpi => `Too small: prints at about ${dpi} dpi and will look blurry. Use a larger image if you can.` },
}

function Box({ b, style }) {
  return <div style={{ position: 'absolute', left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%`, boxSizing: 'border-box', pointerEvents: 'none', ...style }} />
}

function Guides({ spec }) {
  const g = guides(spec)
  if (PIECES[spec].round) {
    const ring = (d, style) => (
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: `${d * 100}%`, height: `${d * 100}%`, transform: 'translate(-50%,-50%)', borderRadius: '50%', boxSizing: 'border-box', pointerEvents: 'none', ...style }} />
    )
    return (
      <>
        {ring(1, { boxShadow: '0 0 0 400px rgba(0,0,0,0.5)', border: `1.5px dashed ${CUT}` })}
        {ring(g.hub, { background: 'rgba(0,0,0,0.45)', border: `1px dashed ${SAFE}` })}
        {ring(g.hole, { background: 'rgba(0,0,0,0.75)' })}
      </>
    )
  }
  return (
    <>
      {/* Bleed: everything outside the cut line is trimmed off. */}
      <Box b={g.trim} style={{ boxShadow: '0 0 0 400px rgba(0,0,0,0.5)', border: `1.5px dashed ${CUT}` }} />
      <Box b={g.safe} style={{ border: `1px dashed ${SAFE}` }} />
      {(g.spines || []).map((x, i) => (
        <div key={x} style={{ position: 'absolute', top: `${g.trim.y * 100}%`, height: `${g.trim.h * 100}%`, left: `${(i === 0 ? g.trim.x : x) * 100}%`, width: `${(i === 0 ? x - g.trim.x : g.trim.x + g.trim.w - x) * 100}%`, background: 'rgba(0,0,0,0.5)', borderLeft: i ? `1px solid ${CUT}` : 'none', borderRight: i ? 'none' : `1px solid ${CUT}`, boxSizing: 'border-box', pointerEvents: 'none' }} />
      ))}
    </>
  )
}

export default function CdCropper({ file, title, spec, onDone, onCancel }) {
  const piece  = PIECES[spec]
  const aspect = aspectOf(spec)
  const { w: outW, h: outH } = sizePx(spec)
  const maxBox = Math.min(320, (typeof window !== 'undefined' ? window.innerWidth : 400) - 88)
  const boxW = aspect >= 1 ? maxBox : Math.round(maxBox * aspect)
  const boxH = aspect >= 1 ? Math.round(maxBox / aspect) : maxBox

  const [imgSrc,  setImgSrc]  = useState('')
  const [nat,     setNat]     = useState({ w: 0, h: 0 })
  const [zoom,    setZoom]    = useState(1)
  const [pos,     setPos]     = useState({ x: 0, y: 0 })
  const [drag,    setDrag]    = useState(null)      // last pointer position while dragging
  const [showGuides, setShowGuides] = useState(true)
  const [failed,  setFailed]  = useState(false)
  const imgRef = useRef()

  useEffect(() => {
    const url = URL.createObjectURL(file)
    setImgSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Zoom 1 = the image just covers the frame.
  const fit   = nat.w ? Math.max(boxW / nat.w, boxH / nat.h) : 1
  const scale = fit * zoom

  const clamp = (p, s = scale) => ({
    x: Math.min(0, Math.max(p.x, boxW - nat.w * s)),
    y: Math.min(0, Math.max(p.y, boxH - nat.h * s)),
  })

  function center(s = fit) {
    setPos({ x: (boxW - nat.w * s) / 2, y: (boxH - nat.h * s) / 2 })
  }

  function handleLoad(e) {
    const { naturalWidth: w, naturalHeight: h } = e.target
    const s = Math.max(boxW / w, boxH / h)
    setNat({ w, h })
    setPos({ x: (boxW - w * s) / 2, y: (boxH - h * s) / 2 })
  }

  // Zoom around the middle of the frame, so the subject stays put.
  function changeZoom(next) {
    const s = fit * next
    const cx = (boxW / 2 - pos.x) / scale
    const cy = (boxH / 2 - pos.y) / scale
    setZoom(next)
    setPos(clamp({ x: boxW / 2 - cx * s, y: boxH / 2 - cy * s }, s))
  }

  function resetView() { setZoom(1); center(fit) }

  function move(cx, cy) {
    if (!drag) return
    setPos(p => clamp({ x: p.x + cx - drag.x, y: p.y + cy - drag.y }))
    setDrag({ x: cx, y: cy })
  }

  const dpi     = nat.w ? effectiveDpi(spec, boxW / scale) : 0
  const quality = QUALITY[dpiQuality(dpi)]

  function handleDone() {
    const canvas = document.createElement('canvas')
    canvas.width = outW
    canvas.height = outH
    const ctx = canvas.getContext('2d')
    // JPEG has no transparency: without this, see-through areas print black.
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, outW, outH)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(imgRef.current, -pos.x / scale, -pos.y / scale, boxW / scale, boxH / scale, 0, 0, outW, outH)
    canvas.toBlob(blob => onDone(blob, dpi), 'image/jpeg', 0.95)
  }


  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
      <div style={{ background: '#f5f1e8', padding: '24px', maxWidth: '380px', width: '100%' }}>
        <p style={{ ...mono, fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#7a5030', marginBottom: '4px' }}>{title}</p>
        <p style={{ ...mono, fontSize: '11px', color: '#a08060', marginBottom: '14px' }}>Drag to position, slide to zoom.</p>

        {failed ? (
          <p role="alert" style={{ ...mono, fontSize: '12px', color: '#b03020', lineHeight: 1.6, margin: '0 0 8px' }}>
            That file couldn't be opened here. Please save it as a JPG or PNG and try again.
          </p>
        ) : (
          <>
            <div
              data-testid="crop-frame"
              style={{ width: boxW, height: boxH, overflow: 'hidden', position: 'relative', background: '#1a1814', cursor: drag ? 'grabbing' : 'grab', userSelect: 'none', touchAction: 'none', margin: '0 auto' }}
              onMouseDown={e => { e.preventDefault(); setDrag({ x: e.clientX, y: e.clientY }) }}
              onMouseMove={e => move(e.clientX, e.clientY)}
              onMouseUp={() => setDrag(null)} onMouseLeave={() => setDrag(null)}
              onTouchStart={e => setDrag({ x: e.touches[0].clientX, y: e.touches[0].clientY })}
              onTouchMove={e => move(e.touches[0].clientX, e.touches[0].clientY)}
              onTouchEnd={() => setDrag(null)}
            >
              {imgSrc && (
                <img ref={imgRef} src={imgSrc} onLoad={handleLoad} onError={() => setFailed(true)} draggable={false} alt=""
                  style={{ position: 'absolute', left: pos.x, top: pos.y, width: nat.w * scale, height: nat.h * scale, maxWidth: 'none', pointerEvents: 'none' }} />
              )}
              {showGuides && <Guides spec={spec} />}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px' }}>
              <input aria-label="Zoom" type="range" min="1" max={MAX_ZOOM} step="0.01" value={zoom}
                onChange={e => changeZoom(Number(e.target.value))} style={{ flex: 1, minWidth: 0 }} />
              <button type="button" onClick={resetView} style={{ ...mono, fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '6px 10px', background: 'none', border: '1px solid #a08060', color: '#7a5030', cursor: 'pointer' }}>
                Center
              </button>
            </div>

            <div style={{ ...mono, fontSize: '10px', color: '#6a5a48', lineHeight: 1.7, marginTop: '10px' }}>
              <p style={{ margin: 0 }}><span style={{ borderBottom: '2px dashed #333', paddingRight: '14px', marginRight: '6px' }} />
                {piece.round ? 'Edge of the disc' : 'Cut line: the shaded area gets trimmed off, so let your art run past it'}
              </p>
              <p style={{ margin: 0 }}><span style={{ borderBottom: '2px dashed #2a9ac0', paddingRight: '14px', marginRight: '6px' }} />
                {piece.round ? 'Clear center: nothing prints inside this ring' : 'Keep text and faces inside this line'}
              </p>
              {piece.spineW && <p style={{ margin: 0 }}>Shaded end strips are the spines. Your spine text goes there automatically.</p>}
            </div>

            {nat.w > 0 && <p data-testid="crop-dpi" style={{ ...mono, fontSize: '11px', color: quality.color, lineHeight: 1.5, margin: '10px 0 0' }}>{quality.text(dpi)}</p>}

            <label style={{ ...mono, fontSize: '10px', color: '#7a5030', display: 'flex', alignItems: 'center', gap: '6px', marginTop: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={showGuides} onChange={e => setShowGuides(e.target.checked)} />
              Show guides (they won't print)
            </label>
          </>
        )}

        <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
          {!failed && (
            <button onClick={handleDone} disabled={!nat.w} style={{ flex: 1, ...mono, fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '11px', background: '#1a1814', color: '#f5f2ec', border: 'none', cursor: 'pointer' }}>
              Use this crop
            </button>
          )}
          <button onClick={onCancel} style={{ ...mono, fontSize: '11px', color: '#7a5030', background: 'none', border: '1px solid #a08060', padding: '11px 16px', cursor: 'pointer' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
