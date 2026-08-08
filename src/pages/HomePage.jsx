import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Footer from '../components/Footer'
import ArtCarousel from '../components/ArtCarousel'
import FloatingProductColumn from '../components/FloatingProductColumn'
import { fetchAllProducts } from '../data/storage'

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const FLORA_DARK = '#1a1208'

function DarkHoverBtn({ children, onClick, fullWidth = false }) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed]  = useState(false)
  const active = hovered || pressed
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false) }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        display: fullWidth ? 'block' : 'inline-block',
        width: fullWidth ? '100%' : undefined,
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: '11px',
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        border: `1px solid ${active ? FLORA_DARK : 'currentColor'}`,
        padding: '0.875rem 2rem',
        cursor: 'pointer',
        transition: 'all 0.2s',
        background: active ? FLORA_DARK : 'transparent',
        color: active ? '#f2ebe0' : 'inherit',
        textAlign: 'center',
      }}
    >
      {children}
    </button>
  )
}

function FilledBtn({ children, onClick, fullWidth = false }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: fullWidth ? 'block' : 'inline-block',
        width: fullWidth ? '100%' : undefined,
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: '11px',
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        border: `1px solid ${FLORA_DARK}`,
        padding: '0.875rem 2rem',
        cursor: 'pointer',
        transition: 'all 0.2s',
        background: hovered ? 'transparent' : FLORA_DARK,
        color: hovered ? FLORA_DARK : '#f2ebe0',
        textAlign: 'center',
      }}
    >
      {children}
    </button>
  )
}

export default function HomePage() {
  const navigate  = useNavigate()

  const [localLegends,   setLocalLegends]   = useState([])
  const [randomProducts, setRandomProducts] = useState([])

  useEffect(() => {
    fetchAllProducts().then(all => {
      const active = all.filter(p => p.active !== false && !p.inBucket && p.category !== 'Mystery')
      setLocalLegends(active.filter(p => p.localLegend).slice(0, 8))
      setRandomProducts(shuffle(active.filter(p => !p.localLegend)).slice(0, 8))
    }).catch(() => {})
  }, [])

  return (
    <main className="pt-[60px]">

      {/* ── Hero (with side columns at xl+) ──────────────────── */}
      <div style={{ position: 'relative' }}>

        {/* Left column — Local Legends */}
        {localLegends.length > 0 && (
          <div className="hidden xl:flex" style={{
            position: 'absolute', left: '20px', top: 0, bottom: 0,
            alignItems: 'flex-start', paddingTop: '80px', zIndex: 1,
          }}>
            <FloatingProductColumn products={localLegends} label="Local Legends" duration={24} />
          </div>
        )}

        {/* Right column — Random shop, with Enigma preorder backdrop + hover reveal */}
        {randomProducts.length > 0 && (
          <div className="hidden xl:flex" style={{
            position: 'absolute', right: '20px', top: 0, bottom: 0,
            alignItems: 'flex-start', paddingTop: '80px', zIndex: 1,
          }}>
            <FloatingProductColumn products={randomProducts} label="New Arrivals" duration={17} />
          </div>
        )}

      <section className="max-w-4xl mx-auto px-6 pt-24 pb-20 border-b border-warm-gray-light">
        <p className="eyebrow mb-8">Fort Wayne, Indiana · Est. Here. Now.</p>

        <h1 style={{
          fontFamily: "'Inter', sans-serif", fontWeight: 700,
          fontSize: 'clamp(3.5rem,10vw,7rem)', lineHeight: 0.93,
          letterSpacing: '-0.03em', marginBottom: '1.5rem',
        }}>
          Art<br />Saturated
        </h1>

        <p className="font-mono text-[11px] tracking-[0.15em] uppercase text-warm-gray mb-12">
          A marketplace for independent creators
        </p>

        <blockquote className="font-serif italic text-[clamp(1.4rem,3.5vw,2rem)] text-ink leading-snug
                               pl-6 border-l-2 border-earth mb-14 max-w-xl">
          "You can't make everything,<br />but you can make anything."
        </blockquote>

        <div className="flex items-center gap-4 flex-wrap">
          <FilledBtn onClick={() => navigate('/shop')}>Browse the Shop</FilledBtn>
          <DarkHoverBtn onClick={() => navigate('/consult')}>Book a Consultation</DarkHoverBtn>
        </div>

        {/* Mobile columns — shown below CTA buttons on small screens */}
        {(localLegends.length > 0 || randomProducts.length > 0) && (
          <div className="flex xl:hidden justify-center items-start gap-5 mt-10">
            {localLegends.length > 0 && (
              <FloatingProductColumn products={localLegends} label="Local Legends" duration={24} cardWidth={88} colHeight={260} />
            )}
            {randomProducts.length > 0 && (
              <FloatingProductColumn products={randomProducts} label="New Arrivals" duration={17} cardWidth={88} colHeight={260} />
            )}
          </div>
        )}
      </section>
      </div>{/* end hero wrapper */}

      {/* ── Featured art slideshow ───────────────────────────── */}
      <ArtCarousel />

      {/* Creator recruitment and Events sections retired Aug 2026 — the site is now
          shop + consultations only. The beta "building in public / rough edges"
          panel was removed too: it warned first-time buyers of rough edges right
          before checkout and listed several now-retired features as "Live". */}

      <Footer />
    </main>
  )
}
