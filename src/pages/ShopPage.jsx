import { useState, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import ProductGrid from '../components/ProductGrid'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'
import FloraRoots from '../components/FloraRoots'
import DrawingCanvas from '../components/DrawingCanvas'
import { CATEGORIES } from '../data/products'
import { fetchShopProducts } from '../data/storage'
import { getArtistsWithWork } from '../data/artists'
import { setPageMeta, resetPageMeta } from '../lib/meta'

const ART_MEDIUMS     = ['All Art', 'Sculpture', 'Pen', 'Crayon', 'Mixed', 'Prints']
const PLANTER_SERIES  = ['All Get On The Flora', 'Ruins of Drumwind', 'Tree of Life']
const VINTAGE_TYPES   = ['All Vintage Tech', 'VHS Players', 'Vintage Cameras', 'Cassette Players', 'Record Players', 'DVD Players', 'Multi Media Players']
const MEDIA_TYPES     = ['All Physical Media', 'Local Legends', 'New Arrivals', 'Vinyl', 'CDs', 'Cassette Tapes', '8 Tracks', 'VHS Tapes']
const CLOTHING_TYPES  = ['All Clothing', 'Tops', 'Bottoms', 'Accessories', 'Custom / One of One']

const SHOP_VIEWS = ['Categories', 'By Artist', 'By Art']

function ShopViewToggle({ active, onChange }) {
  return (
    <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', marginBottom: '2rem' }}>
      {SHOP_VIEWS.map(v => (
        <button
          key={v}
          onClick={() => onChange(v)}
          style={{
            fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em',
            textTransform: 'uppercase', padding: '8px 18px',
            border: '1px solid',
            borderColor: active === v ? 'rgb(var(--color-ink))' : 'rgb(var(--color-warm-gray-light))',
            background: active === v ? 'rgb(var(--color-ink))' : 'transparent',
            color: active === v ? 'rgb(var(--color-cream))' : 'rgb(var(--color-warm-gray))',
            cursor: 'pointer', transition: 'all 0.15s',
          }}
        >
          {v}
        </button>
      ))}
    </div>
  )
}

function ArtistShopCard({ artist }) {
  const navigate = useNavigate()
  const preview = (artist.work || []).slice(0, 3)
  const initials = (artist.name || 'A').charAt(0).toUpperCase()

  return (
    <button
      onClick={() => navigate(`/artists/${artist.slug || artist.uid}`)}
      style={{
        display: 'flex', flexDirection: 'column', textAlign: 'left',
        background: 'rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.1)',
        cursor: 'pointer', padding: 0, transition: 'transform 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(26,18,8,0.1)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}
    >
      {/* Preview images */}
      <div style={{ display: 'grid', gridTemplateColumns: preview.length > 1 ? '1fr 1fr 1fr' : '1fr', aspectRatio: '16/7', overflow: 'hidden', background: 'rgb(var(--color-warm-gray-light))' }}>
        {preview.length > 0 ? preview.map((w, i) => (
          <img key={i} src={w.imageURL} alt={w.title || ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        )) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '2rem', opacity: 0.25 }}>🎨</span>
          </div>
        )}
      </div>

      {/* Info */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px' }}>
        <div style={{
          width: '36px', height: '36px', borderRadius: '50%', overflow: 'hidden', flexShrink: 0,
          background: 'rgb(var(--color-warm-gray-light))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {artist.photoURL
            ? <img src={artist.photoURL} alt={artist.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <span style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-earth))', fontWeight: 600 }}>{initials}</span>
          }
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: 'serif', fontSize: '1rem', color: 'rgb(var(--color-ink))', margin: 0, lineHeight: 1.2 }}>
            {artist.name || 'Artist'}
          </p>
          <p style={{ fontFamily: 'monospace', fontSize: '10px', color: 'rgb(var(--color-earth))', margin: '3px 0 0', letterSpacing: '0.06em' }}>
            {artist.work?.length || 0} {artist.work?.length === 1 ? 'piece' : 'pieces'}
          </p>
        </div>
        <span style={{ fontFamily: 'monospace', fontSize: '10px', color: 'rgb(var(--color-warm-gray))', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
          View →
        </span>
      </div>
    </button>
  )
}

export default function ShopPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [products, setProducts] = useState([])
  const [loadState, setLoadState] = useState('loading')  // 'loading' | 'ready' | 'error'
  const [searchQuery, setSearchQuery] = useState('')
  const [shopView, setShopView] = useState('Categories')
  const [artists, setArtists] = useState([])
  const [artistsLoading, setArtistsLoading] = useState(false)

  const activeFilter  = searchParams.get('cat') || null

  // Without a load state the shop shows an empty page while the catalog loads and
  // — because the error was swallowed — stayed blank forever if the fetch failed.
  const loadProducts = useCallback(() => {
    setLoadState('loading')
    fetchShopProducts()
      .then(p => { setProducts(p); setLoadState('ready') })
      .catch(() => setLoadState('error'))
  }, [])

  useEffect(() => { loadProducts() }, [loadProducts])

  useEffect(() => {
    if (shopView !== 'By Artist' || artists.length > 0) return
    setArtistsLoading(true)
    getArtistsWithWork()
      .then(setArtists)
      .catch(() => setArtists([]))
      .finally(() => setArtistsLoading(false))
  }, [shopView, artists.length])

  // Only surface categories that actually have listings. (Physical Media used to
  // be pinned open for the Enigma preorder spotlight; the album is a normal
  // listing now, so it follows the same rule as everything else.)
  const ALWAYS_SHOW = []
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

  const artMedium     = searchParams.get('medium')  || 'All Art'
  const planterSeries = searchParams.get('series')  || 'All Get On The Flora'
  const vintageType   = searchParams.get('vintage') || 'All Vintage Tech'
  const mediaType     = searchParams.get('media')   || 'All Physical Media'
  const clothingType  = searchParams.get('garment') || 'All Clothing'

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

  // Sold / out-of-stock items still show (a strike-through "Sold" card is social
  // proof that pieces move), but they sink below what's actually buyable so the
  // top of every category is things a visitor can still purchase. Array.sort is
  // stable, so each category's existing order is preserved within each group.
  const isUnavailable = (p) =>
    p.sold === true || (p.stock != null && p.stock !== '' && Number(p.stock) <= 0)

  const filtered = (() => {
    if (!activeFilter) return []
    if (activeFilter === 'Art') {
      const art = products.filter((p) => p.category === 'Art')
      // Sculpture sits in Art rather than owning a top-level category, so it is
      // told apart by listingType — `medium` stays the seller's own words
      // ('bronze', 'raku clay') instead of being overwritten with a filter label.
      if (artMedium === 'All Art')   return art
      if (artMedium === 'Sculpture') return art.filter((p) => p.listingType === 'sculpture')
      return art.filter((p) => p.medium === artMedium)
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
    if (activeFilter === 'Clothing') {
      const clothing = products.filter((p) => p.category === 'Clothing')
      return clothingType === 'All Clothing' ? clothing : clothing.filter((p) => p.garmentType === clothingType)
    }
    return products.filter((p) => p.category === activeFilter)
  })()
    // Available first, sold last — stable, so within each group order is untouched.
    .slice()
    .sort((a, b) => (isUnavailable(a) ? 1 : 0) - (isUnavailable(b) ? 1 : 0))

  function handleCategoryClick(cat) {
    setSearchParams({ cat }, { replace: true })
  }

  const isFlora   = activeFilter === 'Get On The Flora'
  const isArt     = activeFilter === 'Art'
  const isVintage = activeFilter === 'Vintage Tech'
  const isMedia   = activeFilter === 'Physical Media'
  const isClothing = activeFilter === 'Clothing'

  const mainBg = isFlora ? '#4a2e14' : isArt ? '#f2ebe0' : isVintage ? '#0e0e0e' : isMedia ? '#c4956a' : isClothing ? '#0e0c14' : undefined

  // On dark backgrounds pills need light text/borders
  const darkBg = isFlora || isVintage || isClothing
  const pillStyle       = darkBg ? { color: 'rgba(255,255,255,0.65)', borderColor: 'rgba(255,255,255,0.22)' } : {}
  const pillActiveStyle = darkBg ? { background: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.95)', borderColor: 'rgba(255,255,255,0.5)' } : {}

  const allArt = products
    .filter(p => p.artistUid)
    .slice()
    .sort((a, b) => (isUnavailable(a) ? 1 : 0) - (isUnavailable(b) ? 1 : 0))

  if (!activeFilter) {
    return (
      <main className="pt-[60px]" style={{ minHeight: '100vh' }}>
        <section className="max-w-5xl mx-auto px-6 pt-16 pb-24">
          <div className="mb-10 text-center">
            <h1 className="font-serif text-[2.8rem] font-normal mb-3">Shop</h1>
            <p className="eyebrow tracking-[0.2em]">choose your path</p>
          </div>

          <ShopViewToggle active={shopView} onChange={setShopView} />

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

          {/* ── Categories view ──────────────────────────────── */}
          {shopView === 'Categories' && !searchResults && (
            <>
              {loadState === 'loading' && visibleCategories.length === 0 && (
                <div className="flex justify-center py-20"><Spinner size={22} color="#3d2810" /></div>
              )}

              {loadState === 'error' && (
                <div className="flex flex-col items-center gap-5 py-20 text-center">
                  <p className="font-mono text-[13px] text-warm-gray">The shop couldn't load. Check your connection and try again.</p>
                  <button onClick={loadProducts} className="btn-outline">Retry</button>
                </div>
              )}

              {loadState !== 'error' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                </div>
              )}
            </>
          )}

          {/* ── Browse by Artist view ────────────────────────── */}
          {shopView === 'By Artist' && !searchResults && (
            <>
              <div className="text-center mb-8">
                <p className="font-mono text-[11px] text-warm-gray tracking-wide">
                  Explore work by the artists who make it.
                </p>
              </div>

              {artistsLoading ? (
                <div className="flex justify-center py-20"><Spinner size={22} color="#3d2810" /></div>
              ) : artists.length === 0 ? (
                <p className="font-mono text-[13px] text-warm-gray text-center py-16">No artists listed yet.</p>
              ) : (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                    {artists.map(a => <ArtistShopCard key={a.uid} artist={a} />)}
                  </div>
                  <div className="text-center mt-10">
                    <button
                      onClick={() => navigate('/artists')}
                      style={{
                        fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em',
                        textTransform: 'uppercase', padding: '10px 24px',
                        border: '1px solid rgb(var(--color-warm-gray-light))',
                        background: 'transparent', color: 'rgb(var(--color-ink))',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'rgb(var(--color-ink))'; e.currentTarget.style.color = 'rgb(var(--color-cream))' }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgb(var(--color-ink))' }}
                    >
                      View all artists →
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── Browse by Art view ───────────────────────────── */}
          {shopView === 'By Art' && !searchResults && (
            <>
              <div className="text-center mb-8">
                <p className="font-mono text-[11px] text-warm-gray tracking-wide">
                  All artwork across every artist — one gallery.
                </p>
              </div>

              {loadState === 'loading' ? (
                <div className="flex justify-center py-20"><Spinner size={22} color="#3d2810" /></div>
              ) : allArt.length === 0 ? (
                <p className="font-mono text-[13px] text-warm-gray text-center py-16">No artwork listed yet.</p>
              ) : (
                <ProductGrid products={allArt} pageSize={24} />
              )}
            </>
          )}
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
            style={(isFlora || isVintage || isClothing) ? { color: 'rgba(255,255,255,0.9)', WebkitTextFillColor: 'rgba(255,255,255,0.9)' } : isMedia ? { color: '#2a1a08', WebkitTextFillColor: '#2a1a08' } : undefined}
          >
            Shop
          </button>
          <span className="eyebrow" style={(isFlora || isVintage || isClothing) ? { color: 'rgba(255,255,255,0.45)' } : isMedia ? { color: 'rgba(42,26,8,0.6)' } : undefined}>
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

        {/* ── Clothing type subtabs ────────────────────────── */}
        {activeFilter === 'Clothing' && (
          <div className="flex flex-wrap gap-2 pb-6">
            {CLOTHING_TYPES.map((t) => (
              <button
                key={t}
                onClick={() => setParam('garment', t === 'All Clothing' ? null : t)}
                className={`filter-pill text-[10px] ${clothingType === t ? 'filter-pill-active' : ''}`}
                style={clothingType === t ? pillActiveStyle : pillStyle}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {!CATEGORIES.includes(activeFilter) && <div className="pb-6" />}
      </section>

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
