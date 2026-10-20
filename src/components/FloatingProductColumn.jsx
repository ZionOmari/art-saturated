import { useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const SLOTS = 4

// Whole-dollar prices read cleaner ($60); anything else keeps its cents ($38.50).
const fmtPrice = (n) => {
  const v = Number(n || 0)
  return Number.isInteger(v) ? `$${v}` : `$${v.toFixed(2)}`
}

export default function FloatingProductColumn({
  products    = [],
  label       = '',
  duration    = 20,
  cardWidth   = 128,
  colHeight   = 520,
}) {
  const navigate  = useNavigate()
  const wrapRef   = useRef(null)
  const cardsRef  = useRef([])
  const rafRef    = useRef(null)
  const progRef   = useRef(null)
  const lastTsRef = useRef(null)
  const speedRef  = useRef(1)

  if (!progRef.current) {
    progRef.current = Array.from({ length: SLOTS }, (_, i) => (duration / SLOTS) * i)
  }

  // Proximity → speed (0.15 when cursor is close, 1.0 when far)
  useEffect(() => {
    function onMove(e) {
      if (!wrapRef.current) return
      const r  = wrapRef.current.getBoundingClientRect()
      const cx = (r.left + r.right)  / 2
      const cy = (r.top  + r.bottom) / 2
      const d  = Math.sqrt((e.clientX - cx) ** 2 + (e.clientY - cy) ** 2)
      speedRef.current = Math.min(1, 0.15 + 0.85 * (d / 220))
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // rAF loop — drives animationDelay on each paused card
  useEffect(() => {
    function tick(ts) {
      if (lastTsRef.current !== null) {
        const dt  = Math.min((ts - lastTsRef.current) / 1000, 0.05)
        const adv = dt * speedRef.current
        progRef.current = progRef.current.map(p => (p + adv) % duration)
        cardsRef.current.forEach((el, i) => {
          if (el) el.style.animationDelay = `-${progRef.current[i]}s`
        })
      }
      lastTsRef.current = ts
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [duration])

  // Products arrive after the first render, so this check must come after every
  // hook — returning earlier changes the hook count between renders and React
  // throws ("Rendered more hooks than during the previous render").
  if (products.length === 0) return null
  const slots = Array.from({ length: SLOTS }, (_, i) => products[i % products.length])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: `${cardWidth}px` }}>
      {label && (
        <p style={{
          fontFamily: 'monospace', fontSize: '8px', letterSpacing: '0.18em',
          textTransform: 'uppercase', color: '#a08060', marginBottom: '8px',
          whiteSpace: 'nowrap',
        }}>
          {label}
        </p>
      )}

      {/* Clipping window — mask creates feathered top/bottom fade */}
      <div
        ref={wrapRef}
        style={{
          position:        'relative',
          height:          `${colHeight}px`,
          width:           `${cardWidth}px`,
          overflow:        'hidden',
          maskImage:       'linear-gradient(to bottom, transparent 0%, black 28%, black 72%, transparent 100%)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 28%, black 72%, transparent 100%)',
        }}
      >
        {slots.map((p, i) => {
          const img  = Array.isArray(p.imageURLs) ? p.imageURLs[0]
                     : Array.isArray(p.images)    ? p.images[0]
                     : (p.imageURL || p.image || null)
          const slug = p.slug || null

          return (
            <div
              key={`${p.id}-${i}`}
              ref={el => { cardsRef.current[i] = el }}
              onClick={() => slug && navigate(`/shop/${slug}`)}
              className="float-card"
              style={{
                position:                'absolute',
                top:                     0,
                left:                    0,
                zIndex:                  1,
                width:                   `${cardWidth}px`,
                cursor:                  slug ? 'pointer' : 'default',
                animationName:           'floatCard',
                animationDuration:       `${duration}s`,
                animationTimingFunction: 'cubic-bezier(0.42,0,0.9,1)',
                animationIterationCount: 'infinite',
                willChange:              'transform',
              }}
            >
              <div style={{
                width:        `${cardWidth}px`,
                height:       `${cardWidth}px`,
                overflow:     'hidden',
                background:   '#e8e0d4',
                border:       '1px solid rgba(160,128,96,0.18)',
                marginBottom: '4px',
              }}>
                {img
                  ? <img src={img} alt={p.name || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                  : <div style={{ width: '100%', height: '100%', background: '#ddd5c8' }} />
                }
              </div>
              <p style={{
                fontFamily:    'monospace',
                fontSize:      cardWidth < 100 ? '8px' : '9px',
                color:         '#5a3820',
                letterSpacing: '0.05em',
                margin:        0,
                overflow:      'hidden',
                textOverflow:  'ellipsis',
                whiteSpace:    'nowrap',
              }}>
                {p.name || p.title || ''}
              </p>
              <p style={{ fontFamily: 'monospace', fontSize: cardWidth < 100 ? '8px' : '9px', color: '#a08060', margin: '1px 0 0' }}>
                {fmtPrice(p.price)}
              </p>
            </div>
          )
        })}
      </div>
    </div>
  )
}
