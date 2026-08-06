import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import ProductGrid from '../components/ProductGrid'
import Footer from '../components/Footer'
import FloraRoots from '../components/FloraRoots'
import DrawingCanvas from '../components/DrawingCanvas'
import CommissionForm from '../components/CommissionForm'
import EnigmaPreorderSpotlight from '../components/EnigmaPreorderSpotlight'
import { CATEGORIES } from '../data/products'
import { fetchShopProducts } from '../data/storage'
import { setPageMeta, resetPageMeta } from '../lib/meta'

const ART_MEDIUMS     = ['All Art', 'Pen', 'Crayon', 'Mixed', 'Prints']
const PLANTER_SERIES  = ['All Get On The Flora', 'Ruins of Drumwind', 'Tree of Life']
const VINTAGE_TYPES   = ['All Vintage Tech', 'VHS Players', 'Vintage Cameras', 'Cassette Players', 'Record Players', 'DVD Players', 'Multi Media Players']
const MEDIA_TYPES     = ['All Physical Media', 'Local Legends', 'New Arrivals', 'Vinyl', 'CDs', 'Cassette Tapes', '8 Tracks', 'VHS Tapes']
const THREADS_TYPES   = ['All Room 40 Threads', 'Tops', 'Bottoms', 'Accessories', 'Custom / One of One']

export default function ShopPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [showCommission, setShowCommission] = useState(false)
  const [products, setProducts] = useState([])
  const [searchQuery, setSearchQuery] = useState('')

  const activeFilter  = searchParams.get('cat') || null

  useEffect(() => { fetchShopProducts().then(setProducts).catch(() => {}) }, [])

  // Only surface categories that actually have listings. Physical Media stays
  // visible regardless because it hosts the Enigma preorder spotlight.
  const ALWAYS_SHOW = ['Physical Media']
  const visibleCategories = CATEGORIES.filter(
    cat => ALWAYS_SHOW.includes(cat) || products.some(p => p.category === cat)
  )
  // The currently-open category should always appear in the pill row, even if
  // it has no listings yet (e.g. landed via a direct link).
  const pillCategories = activeFilter && !visibleCategories.includes(activeFilter)
    ? [...visibleCategories, activeFilter]
    : visibleCategories

  useEffect(() => {
    const title = activeFilter ? `${activeFilter} — Art Saturated` : 'Shop — Art Saturated'
    const desc  = activeFilter
      ? `Browse ${activeFilter} at Art Saturated — handmade and curated goods.`
      : 'Shop original art, physical media, vintage tech, and handmade planters at Art Saturated.'
    setPageMeta({ title, description: desc, url: window.location.href })
    return () => resetPageMeta()
  }, [activeFilter])

  useEffect(() => {
    if (!showCommission) return
    function onKey(e) { if (e.key === 'Escape') setShowCommission(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showCommission])
  const artMedium     = searchParams.get('medium')  || 'All Art'
  const planterSeries = searchParams.get('series')  || 'All Get On The Flora'
  const vintageType   = searchParams.get('vintage') || 'All Vintage Tech'
  const mediaType     = searchParams.get('media')   || 'All Physical Media'
  const threadsType   = searchParams.get('threads') || 'All Room 40 Threads'

  function setParam(key, value) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (value) next.set(key, value); else next.delete(key)
      return next
    }, { replace: true })
  }

  function setActiveFilter(cat) {
    if (!cat) {
      setSearchParams({}, { replace: true })
    } else {
      setSearchParams({ cat }, { replace: true })
    }
  }

  const searchResults = searchQuery.trim().length > 1
    ? products.filter(p => {
        const q = searchQuery.toLowerCase()
        return (p.name || '').toLowerCase().includes(q)
          || (p.description || '').toLowerCase().includes(q)
          || (p.category || '').toLowerCase().includes(q)
          || (p.type || '').toLowerCase().includes(q)
          || (p.artist || '').toLowerCase().includes(q)
          || (p.albumTitle || '').toLowerCase().includes(q)
      })
    : null

  const filtered = (() => {
    if (!activeFilter) return []
    if (activeFilter === 'Art') {
      const art = products.filter((p) => p.category === 'Art')
      return artMedium === 'All Art' ? art : art.filter((p) => p.medium === artMedium)
    }
    if (activeFilter === 'Get On The Flora') {
      const planters = products.filter((p) => p.category === 'Get On The Flora')
      return planterSeries === 'All Get On The Flora' ? planters : planters.filter((p) => p.series === planterSeries)
    }
    if (activeFilter === 'Vintage Tech') {
      const vintage = products.filter((p) => p.category === 'Vintage Tech')
      return vintageType === 'All Vintage Tech' ? vintage : vintage.filter((p) => p.type === vintageType)
    }
    if (activeFilter === 'Physical Media') {
      const media = products.filter((p) => p.category === 'Physical Media')
      if (mediaType === 'All Physical Media') return media
      if (mediaType === 'New Arrivals')  return media.filter((p) => p.newArrival)
      if (mediaType === 'Local Legends') return media.filter((p) => p.localLegend)
      // Within a specific format: local legends always float to the top
      const typed = media.filter((p) => p.type === mediaType)
      return [...typed.filter(p => p.localLegend), ...typed.filter(p => !p.localLegend)]
    }
    if (activeFilter === 'Room 40 Threads') {
      const threads = products.filter((p) => p.category === 'Room 40 Threads')
      return threadsType === 'All Room 40 Threads' ? threads : threads.filter((p) => p.garmentType === threadsType)
    }
    return products.filter((p) => p.category === activeFilter)
  })()

  function handleCategoryClick(cat) {
    setSearchParams({ cat }, { replace: true })
  }

  const isFlora   = activeFilter === 'Get On The Flora'
  const isArt     = activeFilter === 'Art'
  const isVintage = activeFilter === 'Vintage Tech'
  const isMedia   = activeFilter === 'Physical Media'
  const isThreads = activeFilter === 'Room 40 Threads'

  const mainBg = isFlora ? '#4a2e14' : isArt ? '#f2ebe0' : isVintage ? '#0e0e0e' : isMedia ? '#c4956a' : isThreads ? '#0e0c14' : undefined

  // On dark backgrounds pills need light text/borders
  const darkBg = isFlora || isVintage || isThreads
  const pillStyle       = darkBg ? { color: 'rgba(255,255,255,0.65)', borderColor: 'rgba(255,255,255,0.22)' } : {}
  const pillActiveStyle = darkBg ? { background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.95)', borderColor: 'rgba(255,255,255,0.5)' } : {}

  if (!activeFilter) {
    return (
      <main className="pt-[60px]" style={{ minHeight: '100vh' }}>
        <section className="max-w-5xl mx-auto px-6 pt-16 pb-24">
          <div className="mb-14 text-center">
            <h1 className="font-serif text-[2.8rem] font-normal mb-3">Shop</h1>
            <p className="eyebrow tracking-[0.2em]">choose your path</p>
          </div>

          {/* Search */}
          <div className="mb-10 max-w-md mx-auto">
            <input
              type="search"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search all products…"
              className="w-full border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[13px] text-ink focus:outline-none focus:border-ink"
            />
            {searchResults && (
              <div className="mt-6">
                {searchResults.length === 0
                  ? <p className="font-mono text-[12px] text-warm-gray text-center">No products found for "{searchQuery}".</p>
                  : <ProductGrid products={searchResults} />
                }
              </div>
            )}
          </div>

          {!searchResults && <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {visibleCategories.map((cat) => (
              <button
                key={cat}
                onClick={() => handleCategoryClick(cat)}
                className="group text-left"
                style={{
                  padding: '3rem 2.5rem',
                  border: '1px solid rgba(0,0,0,0.1)',
                  background: 'rgba(0,0,0,0.02)',
                  transition: 'background 0.2s, border-color 0.2s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(0,0,0,0.05)'
                  e.currentTarget.style.borderColor = 'rgba(0,0,0,0.25)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'rgba(0,0,0,0.02)'
                  e.currentTarget.style.borderColor = 'rgba(0,0,0,0.1)'
                }}
              >
                <span className="block font-serif text-[1.9rem] font-normal leading-tight mb-2">
                  {cat}
                </span>
                <span className="block font-mono text-[11px] tracking-widest uppercase" style={{ color: 'rgba(0,0,0,0.35)' }}>
                  explore →
                </span>
              </button>
            ))}
          </div>}
        </section>
        <Footer />
      </main>
    )
  }

  return (
    <main
      className="pt-[60px]"
      style={{ background: mainBg, minHeight: '100vh', transition: 'background 0.4s' }}
    >
      {/* ── Header ───────────────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-6 pt-12 pb-0" style={{ position: 'relative', zIndex: 2 }}>
        <div className="flex items-baseline gap-5 mb-8">
          <button
            onClick={() => setActiveFilter(null)}
            className="font-serif text-[2rem] font-normal hover:opacity-60 transition-opacity"
            style={(isFlora || isVintage || isThreads) ? { color: 'rgba(255,255,255,0.9)', WebkitTextFillColor: 'rgba(255,255,255,0.9)' } : isMedia ? { color: '#2a1a08', WebkitTextFillColor: '#2a1a08' } : undefined}
          >
            Shop
          </button>
          <span className="eyebrow" style={(isFlora || isVintage || isThreads) ? { color: 'rgba(255,255,255,0.45)' } : isMedia ? { color: 'rgba(42,26,8,0.6)' } : undefined}>
            {activeFilter} · {filtered.length} items
          </span>
        </div>

        {/* ── Category filters ──────────────────────────────── */}
        <div className="flex flex-wrap gap-2 pb-4">
          {pillCategories.map((cat) => (
            <button
              key={cat}
              onClick={() => handleCategoryClick(cat)}
              className={`filter-pill ${activeFilter === cat ? 'filter-pill-active' : ''}`}
              style={activeFilter === cat
                ? pillActiveStyle
                : { ...pillStyle, opacity: 0.6 }}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* ── Art medium subtabs ────────────────────────────── */}
        {activeFilter === 'Art' && (
          <div className="flex flex-wrap gap-2 pb-6">
            {ART_MEDIUMS.map((m) => (
              <button
                key={m}
                onClick={() => setParam('medium', m === 'All Art' ? null : m)}
                className={`filter-pill text-[10px] ${artMedium === m ? 'filter-pill-active' : ''}`}
              >
                {m}
              </button>
            ))}
          </div>
        )}

        {/* ── Planter series subtabs ────────────────────────── */}
        {activeFilter === 'Get On The Flora' && (
          <div className="flex flex-wrap gap-2 pb-6">
            {PLANTER_SERIES.map((s) => (
              <button
                key={s}
                onClick={() => setParam('series', s === 'All Get On The Flora' ? null : s)}
                className={`filter-pill text-[10px] ${planterSeries === s ? 'filter-pill-active' : ''}`}
                style={planterSeries === s ? pillActiveStyle : pillStyle}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {/* ── Vintage Tech type subtabs ─────────────────────── */}
        {activeFilter === 'Vintage Tech' && (
          <div className="flex flex-wrap gap-2 pb-6">
            {VINTAGE_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setParam('vintage', t === 'All Vintage Tech' ? null : t)}
                className={`filter-pill text-[10px] ${vintageType === t ? 'filter-pill-active' : ''}`}
                style={vintageType === t ? pillActiveStyle : pillStyle}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* ── Physical Media type subtabs ───────────────────── */}
        {activeFilter === 'Physical Media' && (
          <div className="flex flex-wrap gap-2 pb-6">
            {MEDIA_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setParam('media', t === 'All Physical Media' ? null : t)}
                className={`filter-pill text-[10px] ${mediaType === t ? 'filter-pill-active' : ''}`}
                style={{ color: mediaType === t ? undefined : 'rgba(42,26,8,0.55)', borderColor: mediaType === t ? undefined : 'rgba(42,26,8,0.25)' }}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {/* ── Room 40 Threads type subtabs ─────────────────── */}
        {activeFilter === 'Room 40 Threads' && (
          <div className="flex flex-wrap gap-2 pb-6">
            {THREADS_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setParam('threads', t === 'All Room 40 Threads' ? null : t)}
                className={`filter-pill text-[10px] ${threadsType === t ? 'filter-pill-active' : ''}`}
                style={threadsType === t ? pillActiveStyle : pillStyle}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {!['Art', 'Get On The Flora', 'Vintage Tech', 'Physical Media', 'Room 40 Threads'].includes(activeFilter) && <div className="pb-6" />}

        {/* ── Commission button (Art only) ─────────────────────── */}
        {activeFilter === 'Art' && (
          <div className="pb-6 pt-2">
            <button
              onClick={() => setShowCommission(true)}
              style={{
                fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em',
                textTransform: 'uppercase', padding: '12px 24px',
                border: '1px solid rgba(0,0,0,0.25)', background: 'transparent',
                color: '#1a1208', cursor: 'pointer', transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#1a1208'; e.currentTarget.style.color = '#f2ebe0' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#1a1208' }}
            >
              Request a Commission →
            </button>
          </div>
        )}
      </section>

      {/* ── Commission modal ─────────────────────────────────────── */}
      {showCommission && (
        <div
          onClick={e => { if (e.target === e.currentTarget) setShowCommission(false) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 100,
            background: 'rgba(242,235,224,0.92)', backdropFilter: 'blur(6px)',
            overflowY: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
            padding: '60px 16px 40px',
          }}
        >
          <div style={{
            background: '#faf8f4', border: '1px solid #d4c9bb',
            width: '100%', maxWidth: '560px', position: 'relative',
          }}>
            <button
              onClick={() => setShowCommission(false)}
              style={{
                position: 'absolute', top: '14px', right: '16px',
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a',
                letterSpacing: '0.1em', textTransform: 'uppercase',
              }}
            >
              ✕ close
            </button>
            <CommissionForm onClose={() => setShowCommission(false)} />
          </div>
        </div>
      )}

      {/* ── Canvas effects (behind everything) ───────────────── */}
      {isFlora && <FloraRoots />}
      {isArt   && <DrawingCanvas />}


      {/* ── Grid ─────────────────────────────────────────────── */}
      <div style={{ position: 'relative', zIndex: 1 }}>
        {isMedia && mediaType === 'All Physical Media' ? (() => {
          const localItems = filtered.filter(p => p.localLegend)
          const otherItems = filtered.filter(p => !p.localLegend)
          return (
            <>
              {/* Pinned preorder spotlight — top of Physical Media, above Local Legends */}
              <EnigmaPreorderSpotlight />
              {localItems.length > 0 && (
                <>
                  <div className="max-w-4xl mx-auto px-6 pt-10 pb-6" style={{ borderBottom: '1px solid rgba(42,26,8,0.12)' }}>
                    <p className="font-mono text-[9px] tracking-[0.25em] uppercase mb-2" style={{ color: '#b97a30' }}>★ Featured</p>
                    <h2 className="font-serif text-[2.2rem] font-normal leading-tight" style={{ color: '#2a1a08', WebkitTextFillColor: '#2a1a08' }}>
                      Local Legends
                    </h2>
                    <p className="font-mono text-[11px] mt-2" style={{ color: 'rgba(42,26,8,0.55)' }}>
                      Fort Wayne artists · Made here
                    </p>
                  </div>
                  <ProductGrid products={localItems} />
                </>
              )}
              {otherItems.length > 0 && (
                <>
                  {localItems.length > 0 && (
                    <div className="max-w-4xl mx-auto px-6 pt-10 pb-5" style={{ marginTop: '2.5rem' }}>
                      <p className="font-mono text-[9px] tracking-[0.2em] uppercase mb-1.5" style={{ color: 'rgba(42,26,8,0.4)' }}>Also in stock</p>
                      <h2 className="font-serif text-[1.6rem] font-normal" style={{ color: '#2a1a08', WebkitTextFillColor: '#2a1a08' }}>
                        More Physical Media
                      </h2>
                    </div>
                  )}
                  <ProductGrid products={otherItems} pageSize={24} />
                </>
              )}
              {filtered.length === 0 && (
                <p className="font-mono text-[13px] max-w-4xl mx-auto px-6 py-16" style={{ color: 'rgba(42,26,8,0.5)' }}>
                  No physical media listed yet.
                </p>
              )}
            </>
          )
        })() : (
          <ProductGrid products={filtered} glassMode={isFlora} artMode={isArt} vintageMode={isVintage} pageSize={24} />
        )}
      </div>

      <Footer />
    </main>
  )
}
