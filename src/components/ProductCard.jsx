import { memo } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * ProductCard
 * Reusable card component used on the Home and Shop pages.
 *
 * Props:
 *   product  – single product object from data/products.js
 */
function SoldBadge() {
  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 10,
      background: 'rgba(26,18,8,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none',
    }}>
      <span style={{
        fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.18em',
        textTransform: 'uppercase', color: '#f5f0e8',
        border: '1px solid rgba(245,240,232,0.6)', padding: '4px 10px',
        background: 'rgba(26,18,8,0.7)',
      }}>Sold</span>
    </div>
  )
}

function ProductCard({ product, glassMode = false, artMode = false, vintageMode = false }) {
  const navigate = useNavigate()

  const go = () => navigate(`/shop/${product.slug}`)
  // Keyboard + screen-reader access: cards behave as links (Enter/Space activate).
  const cardProps = {
    onClick: go,
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() } },
    role: 'link',
    tabIndex: 0,
    'aria-label': product.name,
  }

  if (artMode) {
    return (
      <article
        {...cardProps}
        className="group cursor-pointer overflow-hidden"
        style={{
          position: 'relative',
          background: 'rgba(255, 250, 240, 0.55)',
          border: '1px solid rgba(160, 120, 80, 0.3)',
          boxShadow: 'inset 0 0 0 1px rgba(255,240,210,0.4), 0 2px 10px rgba(80,50,20,0.08)',
        }}
      >
        <div
          className="w-full aspect-square flex items-center justify-center relative overflow-hidden"
          style={{ background: 'rgba(255, 248, 230, 0.35)', borderBottom: '1px solid rgba(160,120,80,0.2)' }}
        >
          {product.image ? (
            <img src={product.image} alt={product.name} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="flex flex-col items-center gap-2 select-none">
              <span className="text-5xl" aria-hidden="true">{product.emoji}</span>
              <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'rgba(120,80,40,0.45)' }}>
                No image
              </span>
            </div>
          )}
          {product.sold && <SoldBadge />}
        </div>
        <div className="p-5">
          <p className="eyebrow mb-1" style={{ color: 'rgba(120,80,40,0.6)' }}>{product.category}</p>
          <h3 className="font-serif text-[1rem] font-normal leading-snug mb-2" style={{ color: 'rgba(40,20,5,0.85)' }}>
            {product.name}
          </h3>
          <p className="font-mono text-[13px]" style={{ color: 'rgba(80,50,20,0.65)', textDecoration: product.sold ? 'line-through' : 'none' }}>${product.price}</p>
          {product.unique && (
            <p className="font-mono text-[10px] tracking-[0.1em] uppercase mt-1.5" style={{ color: 'rgba(140,90,30,0.6)' }}>
              One of a kind
            </p>
          )}
        </div>
      </article>
    )
  }

  if (glassMode) {
    return (
      <article
        {...cardProps}
        className="group cursor-pointer overflow-hidden"
        style={{
          position: 'relative',
          background: 'rgba(255,255,255,0.07)',
          border: '1px solid rgba(255,255,255,0.35)',
          boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12), 0 2px 12px rgba(0,0,0,0.15)',
        }}
      >
        {/* Image placeholder — transparent so roots show through */}
        <div
          className="w-full aspect-square flex items-center justify-center relative overflow-hidden"
          style={{ background: 'rgba(255,255,255,0.04)', borderBottom: '1px solid rgba(255,255,255,0.2)' }}
        >
          {product.image ? (
            <img
              src={product.image}
              alt={product.name}
              className="w-full h-full object-cover"
              loading="lazy"
              style={{ opacity: 0.92 }}
            />
          ) : (
            <div className="flex flex-col items-center gap-2 select-none">
              <span className="text-5xl" aria-hidden="true">{product.emoji}</span>
              <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.4)' }}>
                No image
              </span>
            </div>
          )}
          {product.sold && <SoldBadge />}
        </div>

        {/* Info */}
        <div className="p-5">
          <p className="eyebrow mb-1" style={{ color: 'rgba(255,255,255,0.5)' }}>{product.category}</p>
          <h3
            className="font-serif text-[1rem] font-normal leading-snug mb-2 transition-colors duration-200"
            style={{ color: 'rgba(255,255,255,0.9)' }}
          >
            {product.name}
          </h3>
          <p className="font-mono text-[13px]" style={{ color: 'rgba(255,255,255,0.6)' }}>${product.price}</p>
          {product.unique && (
            <p className="font-mono text-[10px] tracking-[0.1em] uppercase mt-1.5" style={{ color: 'rgba(160,200,140,0.7)' }}>
              One of a kind
            </p>
          )}
        </div>
      </article>
    )
  }

  if (vintageMode) {
    return (
      <article
        {...cardProps}
        data-vintage-card="true"
        className="group cursor-pointer overflow-hidden relative"
        style={{
          background: 'rgba(18,18,18,0.92)',
          border: '1px solid rgba(255,255,255,0.08)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.04), 0 4px 20px rgba(0,0,0,0.5)',
        }}
      >
        {/* SVG noise grain overlay */}
        <svg
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            pointerEvents: 'none', zIndex: 2, opacity: 0.06, mixBlendMode: 'screen',
          }}
        >
          <filter id={`vt-grain-${product.id}`}>
            <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" stitchTiles="stitch" />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter={`url(#vt-grain-${product.id})`} />
        </svg>

        {/* Scanline overlay */}
        <div
          aria-hidden="true"
          style={{
            position: 'absolute', inset: 0, zIndex: 3, pointerEvents: 'none',
            backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0px, rgba(0,0,0,0.18) 1px, transparent 1px, transparent 3px)',
          }}
        />

        <div
          className="w-full aspect-square flex items-center justify-center relative overflow-hidden"
          style={{ background: 'rgba(0,0,0,0.35)', borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          {product.image ? (
            <img src={product.image} alt={product.name} className="w-full h-full object-cover" loading="lazy" style={{ opacity: 0.85, filter: 'contrast(1.05) brightness(0.9)' }} />
          ) : (
            <div className="flex flex-col items-center gap-2 select-none">
              <span className="text-5xl" aria-hidden="true">{product.emoji}</span>
              <span className="font-mono text-[10px] tracking-widest uppercase" style={{ color: 'rgba(255,255,255,0.3)' }}>
                No image
              </span>
            </div>
          )}
          {product.sold && <SoldBadge />}
        </div>

        <div className="p-5" style={{ position: 'relative', zIndex: 4 }}>
          <p className="eyebrow mb-1" style={{ color: 'rgba(255,255,255,0.35)' }}>{product.category}</p>
          <h3 className="font-serif text-[1rem] font-normal leading-snug mb-2" style={{ color: 'rgba(230,230,230,0.9)' }}>
            {product.name}
          </h3>
          <p className="font-mono text-[13px]" style={{ color: 'rgba(180,180,180,0.6)' }}>${product.price}</p>
          {product.unique && (
            <p className="font-mono text-[10px] tracking-[0.1em] uppercase mt-1.5" style={{ color: 'rgba(120,200,120,0.6)' }}>
              One of a kind
            </p>
          )}
        </div>
      </article>
    )
  }

  return (
    <article
      {...cardProps}
      className="group bg-cream hover:bg-paper transition-colors duration-200 cursor-pointer overflow-hidden"
    >
      {/* Product image / placeholder */}
      <div className="w-full aspect-square bg-paper flex items-center justify-center relative overflow-hidden">
        {product.image ? (
          <img
            src={product.image}
            alt={product.name}
            className="w-full h-full"
            style={{ objectFit: product.category === 'Physical Media' ? 'contain' : 'cover' }}
            loading="lazy"
          />
        ) : (
          <span className="text-6xl select-none" aria-hidden="true">
            {product.emoji}
          </span>
        )}
        {product.sold && <SoldBadge />}
      </div>

      {/* Info */}
      <div className="p-5">
        <p className="eyebrow mb-1">{product.category}</p>
        <h3 className="font-serif text-[1rem] font-normal leading-snug mb-2 group-hover:text-earth transition-colors duration-200">
          {product.name}
        </h3>
        <p className="font-mono text-[13px] text-warm-gray" style={{ textDecoration: product.sold ? 'line-through' : 'none' }}>
          ${product.price}
        </p>
        {product.unique && !product.sold && (
          <p className="font-mono text-[10px] tracking-[0.1em] uppercase text-earth-light mt-1.5">
            One of a kind
          </p>
        )}
        {product.localLegend && (
          <p className="font-mono text-[9px] tracking-[0.15em] uppercase mt-1.5" style={{ color: '#b97a30' }}>
            ★ Local Legend
          </p>
        )}
      </div>
    </article>
  )
}

export default memo(ProductCard)
