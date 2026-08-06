import { useRef, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import EnigmaField from './EnigmaField'

const SLOTS = 4

// Enigma mode fills the floating boxes with preorder teaser text instead of listings.
const ENIGMA_SLIDES = [
  { big: 'PREORDER',   small: 'Enigma' },
  { big: 'ENIGMA',     small: 'Zionomari' },
  { big: '$10',        small: 'Card only' },
  { big: 'OUT JUN 30', small: 'Ships Jul 1' },
]

export default function FloatingProductColumn({
  products    = [],
  label       = '',
  duration    = 20,
  cardWidth   = 128,
  colHeight   = 520,
  enigma      = false,        // render the Enigma preorder backdrop + hover reveal in this banner
  enigmaSlug  = 'enigma',
}) {
  const navigate  = useNavigate()
  const wrapRef   = useRef(null)
  const cardsRef  = useRef([])
  const rafRef    = useRef(null)
  const progRef   = useRef(null)
  const lastTsRef = useRef(null)
  const speedRef  = useRef(1)
  const bannerRef = useRef(null)
  const [revealed, setRevealed] = useState(false)

  if (!enigma && products.length === 0) return null
  const slots = enigma
    ? ENIGMA_SLIDES
    : Array.from({ length: SLOTS }, (_, i) => products[i % products.length])

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

  // Enigma reveal on touch devices: when the banner scrolls into view
  useEffect(() => {
    if (!enigma || !bannerRef.current) return
    const isTouch = window.matchMedia && window.matchMedia('(hover: none)').matches
    if (!isTouch) return
    const io = new IntersectionObserver(
      entries => { if (entries.some(e => e.isIntersecting && e.intersectionRatio >= 0.5)) setRevealed(true) },
      { threshold: [0, 0.5, 1] }
    )
    io.observe(bannerRef.current)
    return () => io.disconnect()
  }, [enigma])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: `${cardWidth}px` }}>
      {label && (
        <p style={{
          fontFamily: 'monospace', fontSize: '8px', letterSpacing: '0.18em',
          textTransform: 'uppercase', color: enigma ? '#7a6a52' : '#a08060', marginBottom: '8px',
          whiteSpace: 'nowrap',
        }}>
          {label}
        </p>
      )}

      {/* Banner — relative wrapper so the Enigma reveal can overlay the clip window */}
      <div
        ref={bannerRef}
        style={{ position: 'relative', width: `${cardWidth}px`, height: `${colHeight}px` }}
        onMouseEnter={enigma ? () => setRevealed(true) : undefined}
        onMouseLeave={enigma ? () => setRevealed(false) : undefined}
        onTouchStart={enigma ? () => setRevealed(true) : undefined}
      >
        {/* Clipping window — mask creates feathered top/bottom fade */}
        <div
          ref={wrapRef}
          style={{
            position:        'relative',
            height:          `${colHeight}px`,
            width:           `${cardWidth}px`,
            overflow:        'hidden',
            background:      enigma ? '#000' : undefined,
            maskImage:       'linear-gradient(to bottom, transparent 0%, black 28%, black 72%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 28%, black 72%, transparent 100%)',
          }}
        >
          {/* Enigma backdrop — drifting specks behind the floating shop cards */}
          {enigma && (
            <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
              <EnigmaField density={1.1} />
            </div>
          )}

          {slots.map((p, i) => {
            const img  = enigma ? null
                       : Array.isArray(p.imageURLs) ? p.imageURLs[0]
                       : Array.isArray(p.images)    ? p.images[0]
                       : (p.imageURL || p.image || null)
            const slug = enigma ? null : (p.slug || null)

            return (
              <div
                key={enigma ? `enigma-${i}` : `${p.id}-${i}`}
                ref={el => { cardsRef.current[i] = el }}
                onClick={() => enigma ? navigate(`/preorder/${enigmaSlug}`) : (slug && navigate(`/shop/${slug}`))}
                className="float-card"
                style={{
                  position:                'absolute',
                  top:                     0,
                  left:                    0,
                  zIndex:                  1,
                  width:                   `${cardWidth}px`,
                  cursor:                  (enigma || slug) ? 'pointer' : 'default',
                  animationName:           'floatCard',
                  animationDuration:       `${duration}s`,
                  animationTimingFunction: 'cubic-bezier(0.42,0,0.9,1)',
                  animationIterationCount: 'infinite',
                  willChange:              'transform',
                }}
              >
                {enigma ? (
                  /* Enigma preorder text tile — fills the box instead of listing info */
                  <div style={{
                    width:        `${cardWidth}px`,
                    height:       `${cardWidth}px`,
                    display:      'flex',
                    flexDirection:'column',
                    alignItems:   'center',
                    justifyContent:'center',
                    textAlign:    'center',
                    padding:      '6px',
                    marginBottom: '4px',
                    border:       '1px solid rgba(255,255,255,0.16)',
                    background:   'rgba(255,255,255,0.04)',
                  }}>
                    <span style={{ fontFamily: 'Georgia, serif', fontSize: cardWidth < 100 ? '13px' : '17px', letterSpacing: '0.1em', color: '#fff', lineHeight: 1.1 }}>
                      {p.big}
                    </span>
                    <span style={{ fontFamily: 'monospace', fontSize: cardWidth < 100 ? '7px' : '8px', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)', marginTop: '7px' }}>
                      {p.small}
                    </span>
                  </div>
                ) : (
                  <>
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
                      ${Number(p.price || 0).toFixed(0)}
                    </p>
                  </>
                )}
              </div>
            )
          })}
        </div>

        {/* Enigma reveal — Preorder + Enter Shop fade up over the banner on hover/touch */}
        {enigma && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 2,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '0 10px',
            background: revealed ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0)',
            opacity: revealed ? 1 : 0,
            transform: revealed ? 'translateY(0)' : 'translateY(6px)',
            transition: 'opacity 0.25s, transform 0.25s, background 0.25s',
            pointerEvents: revealed ? 'auto' : 'none',
          }}>
            <span style={{ fontFamily: 'Georgia, serif', fontSize: '15px', letterSpacing: '0.22em', color: '#fff', marginBottom: '2px' }}>
              ENIGMA
            </span>
            <button
              onClick={() => navigate(`/preorder/${enigmaSlug}`)}
              style={{
                fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase',
                padding: '8px 14px', width: '90%', background: '#fff', color: '#000', border: 'none', cursor: 'pointer',
              }}
            >
              Preorder
            </button>
            <button
              onClick={() => navigate('/shop')}
              style={{
                fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.14em', textTransform: 'uppercase',
                padding: '8px 14px', width: '90%', background: 'transparent', color: 'rgba(255,255,255,0.85)',
                border: '1px solid rgba(255,255,255,0.4)', cursor: 'pointer',
              }}
            >
              Enter Shop
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
