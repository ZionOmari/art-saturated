import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchRecentArt } from '../data/storage'

const ROTATE_MS    = 4500   // time per rotation step
const ANIM_MS      = 700    // slide animation duration

// Responsive tile count — fewer on smaller screens
function useTileCount() {
  const [n, setN] = useState(typeof window !== 'undefined' && window.innerWidth < 640 ? 2 : (window.innerWidth < 1024 ? 3 : 5))
  useEffect(() => {
    function update() {
      const w = window.innerWidth
      setN(w < 640 ? 2 : w < 1024 ? 3 : 5)
    }
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return n
}

export default function ArtCarousel() {
  const navigate = useNavigate()
  const TILES    = useTileCount()

  const [art,     setArt]     = useState([])
  const [loading, setLoading] = useState(true)
  const [step,    setStep]    = useState(0)
  const [paused,  setPaused]  = useState(false)
  const [animate, setAnimate] = useState(true)

  useEffect(() => {
    fetchRecentArt(10)
      .then(result => {
        console.log('[ArtCarousel] loaded', result.length, 'pieces')
        setArt(result)
      })
      .catch(err => { console.error('[ArtCarousel] fetch failed', err); setArt([]) })
      .finally(() => setLoading(false))
  }, [])

  // Auto-advance
  useEffect(() => {
    if (paused || art.length <= TILES) return
    const id = setInterval(() => setStep(s => s + 1), ROTATE_MS)
    return () => clearInterval(id)
  }, [paused, art.length, TILES])

  // Seamless loop — when step passes the array length, snap back without animation
  useEffect(() => {
    if (step >= art.length && art.length > 0) {
      const t = setTimeout(() => {
        setAnimate(false)
        setStep(s => s - art.length)
        requestAnimationFrame(() => requestAnimationFrame(() => setAnimate(true)))
      }, ANIM_MS)
      return () => clearTimeout(t)
    }
  }, [step, art.length])

  if (!loading && art.length === 0) return null

  // Duplicate art so we can scroll past the end without visual gap
  const items = art.length > 0 ? [...art, ...art] : []

  return (
    <section
      className="border-b border-warm-gray-light"
      style={{ background: 'rgb(var(--color-paper))' }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Header */}
      <div className="max-w-5xl mx-auto px-6 pt-14 pb-6 flex items-baseline justify-between flex-wrap gap-4">
        <div className="flex items-baseline gap-5">
          <h2 className="font-serif text-[1.5rem] font-normal">Featured Art</h2>
          <span className="eyebrow">Recent submissions</span>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <button
            onClick={() => navigate('/submit-art')}
            className="font-mono text-[11px] tracking-[0.1em] uppercase transition-colors"
            style={{ color: '#b97a30' }}
          >
            List yours →
          </button>
          <button
            onClick={() => navigate('/shop?cat=Art')}
            className="font-mono text-[11px] tracking-[0.1em] uppercase text-warm-gray hover:text-ink transition-colors"
          >
            See all →
          </button>
        </div>
      </div>

      {/* Carousel track */}
      <div className="max-w-5xl mx-auto px-6 pb-14">
        {loading ? (
          <div style={{ height: '260px', display: 'flex', alignItems: 'center' }}>
            <p className="font-mono text-[13px] text-warm-gray">Loading…</p>
          </div>
        ) : (
          <div style={{ overflow: 'hidden', position: 'relative' }}>
            <div
              style={{
                display: 'flex',
                gap: '14px',
                transform: `translateX(calc(-1 * (100% / ${TILES} + 14px / ${TILES}) * ${step}))`,
                transition: animate ? `transform ${ANIM_MS}ms cubic-bezier(0.55,0.05,0.4,1)` : 'none',
                willChange: 'transform',
              }}
            >
              {items.map((p, i) => (
                <article
                  key={`${p.id}-${i}`}
                  onClick={() => navigate(`/shop/${p.slug}`)}
                  style={{
                    flex: `0 0 calc((100% - ${(TILES - 1) * 14}px) / ${TILES})`,
                    cursor: 'pointer',
                    background: 'rgb(var(--color-cream))',
                    border: '1px solid rgba(0,0,0,0.08)',
                    transition: 'transform 0.2s, box-shadow 0.2s',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateY(-4px)'
                    e.currentTarget.style.boxShadow = '0 8px 24px rgba(60,40,16,0.12)'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.transform = 'translateY(0)'
                    e.currentTarget.style.boxShadow = 'none'
                  }}
                >
                  {/* Image */}
                  <div style={{ width: '100%', aspectRatio: '1', overflow: 'hidden', background: 'rgb(var(--color-offwhite))', position: 'relative' }}>
                    {p.image ? (
                      <img
                        src={p.image}
                        alt={p.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        loading="lazy"
                      />
                    ) : (
                      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.5rem' }}>🖼️</div>
                    )}
                    {p.sold && (
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,18,8,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#f5f0e8', border: '1px solid rgba(245,240,232,0.6)', padding: '4px 10px' }}>Sold</span>
                      </div>
                    )}
                  </div>
                  {/* Info */}
                  <div style={{ padding: '11px 12px 13px' }}>
                    {p.medium && (
                      <p style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#b97a30', margin: '0 0 3px' }}>
                        {p.medium}
                      </p>
                    )}
                    <p style={{
                      fontFamily: 'serif', fontSize: '0.95rem', color: 'rgb(var(--color-ink))',
                      margin: '0 0 3px', lineHeight: 1.3,
                      overflow: 'hidden', display: '-webkit-box',
                      WebkitLineClamp: 1, WebkitBoxOrient: 'vertical',
                    }}>
                      {p.name}
                    </p>
                    {p.artistName && (
                      <p style={{ fontFamily: 'monospace', fontSize: '10px', color: 'rgb(var(--color-warm-gray))', margin: '0 0 4px' }}>
                        {p.artistName}
                      </p>
                    )}
                    <p style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-earth))', margin: 0 }}>
                      ${p.price}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        )}

        {/* Progress dots — show position in the rotation */}
        {!loading && art.length > TILES && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '6px', marginTop: '20px' }}>
            {art.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                aria-label={`Go to slide ${i + 1}`}
                style={{
                  width: (step % art.length) === i ? '18px' : '6px',
                  height: '4px',
                  background: (step % art.length) === i ? '#b97a30' : 'rgba(60,40,16,0.18)',
                  border: 'none', cursor: 'pointer', padding: 0,
                  transition: 'width 0.3s, background 0.3s',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
