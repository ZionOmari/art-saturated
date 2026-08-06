import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import ProductCard from './ProductCard'

/**
 * ProductGrid
 * Renders a CSS grid of ProductCard components.
 *
 * Props:
 *   products  – array of product objects
 *   pageSize  – optional. When set, only the first `pageSize` products render,
 *               with a "Load more" button to reveal more in increments.
 *               Omit to render everything at once (default).
 */
export default function ProductGrid({ products, glassMode = false, artMode = false, vintageMode = false, pageSize = null }) {
  const spaced   = glassMode || artMode
  const navigate = useNavigate()

  const paginated = pageSize != null && products.length > pageSize
  const [visible, setVisible] = useState(pageSize || products.length)

  // Reset the window only when the product SET actually changes (e.g. switching
  // filters/search) — not on every parent re-render. ShopPage recomputes its
  // `filtered` array each render, so we key off a cheap content signature rather
  // than array identity to avoid collapsing an expanded grid spuriously.
  const sig = `${products.length}:${products[0]?.id || ''}:${products[products.length - 1]?.id || ''}`
  useEffect(() => {
    setVisible(pageSize || products.length)
  }, [sig, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!products.length) {
    return (
      <div className="flex flex-col items-center py-16 gap-4">
        <p className="font-mono text-[13px] text-warm-gray tracking-wide">Nothing here yet.</p>
        <button
          onClick={() => navigate('/shop')}
          className="font-mono text-[11px] tracking-[0.12em] uppercase px-5 py-2.5 border border-warm-gray-light text-warm-gray bg-transparent hover:border-ink hover:text-ink transition-colors"
        >
          Browse All Categories →
        </button>
      </div>
    )
  }

  const shown     = paginated ? products.slice(0, visible) : products
  const hasMore   = paginated && visible < products.length
  const remaining = products.length - visible

  // On dark category backgrounds the "Load more" button needs light text
  const darkBtn = glassMode || vintageMode

  return (
    <>
      <div
        className="grid"
        style={{
          gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
          gap:        spaced ? '16px' : '1px',
          padding:    spaced ? '16px' : '0',
          background: spaced ? 'transparent' : undefined,
          borderTop:    spaced ? 'none' : undefined,
          borderBottom: spaced ? 'none' : undefined,
        }}
      >
        {shown.map((product) => (
          <ProductCard key={product.id} product={product} glassMode={glassMode} artMode={artMode} vintageMode={vintageMode} />
        ))}
      </div>

      {hasMore && (
        <div style={{ textAlign: 'center', margin: '2.5rem 0 0.5rem' }}>
          <button
            onClick={() => setVisible(v => v + pageSize)}
            className="font-mono text-[11px] tracking-[0.12em] uppercase px-6 py-3 border bg-transparent transition-colors"
            style={darkBtn
              ? { color: 'rgba(255,255,255,0.85)', borderColor: 'rgba(255,255,255,0.4)' }
              : { color: 'rgb(var(--color-warm-gray))', borderColor: 'rgb(var(--color-warm-gray-light))' }}
          >
            Load more — {remaining} more
          </button>
        </div>
      )}
    </>
  )
}
