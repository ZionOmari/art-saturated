import { useState } from 'react'
import { useCart } from '../context/CartContext'
import { useToast } from '../hooks/useToast'
import Toast from './Toast'

const SIZES = [
  { label: 'Small', price: 10 },
  { label: 'Large', price: 15 },
]

const COLORS = [
  { label: 'Redwood',       swatch: '#8B3A2A', hint: 'Deep warm red' },
  { label: 'Desert Flower', swatch: '#C4A882', hint: 'Light dusty brown' },
  { label: 'Evergreen',     swatch: '#3D2B1F', hint: 'Dark rich brown' },
]

const PLANTS = [
  'Dark Purple Opal Basil',
  'Culinary Basil',
  'Dieffenbachia',
  'Spinach',
  'Kale',
  'Lemon Balm',
  'Catnip',
]

const pill = (active) => ({
  display: 'inline-block',
  fontFamily: 'monospace',
  fontSize: '11px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '10px 20px',
  cursor: 'pointer',
  border: '1px solid',
  transition: 'all 0.18s',
  background: active ? '#f2ebe0' : '#2a1a0e',
  borderColor: active ? '#2a1a0e' : 'rgba(255,255,255,0.15)',
  color: active ? '#2a1a0e' : '#f2ebe0',
})

export default function TreeOfLifeConfigurator() {
  const { addToCart } = useCart()
  const { toast, showToast } = useToast()

  const [size,       setSize]       = useState(null)
  const [color,      setColor]      = useState(null)
  const [withPlant,  setWithPlant]  = useState(null)   // true | false | null
  const [plant,      setPlant]      = useState(null)
  const [added,      setAdded]      = useState(false)

  const basePrice   = size ? SIZES.find(s => s.label === size).price : null
  const plantAddon  = withPlant ? 5 : 0
  const total       = basePrice !== null ? basePrice + plantAddon : null
  const canShip     = withPlant === false
  const ready       = size && color && withPlant !== null && (withPlant === false || plant)

  function handleAdd() {
    if (!ready) return
    const name = `Tree of Life — ${size} · ${color}${plant ? ` · ${plant}` : ' · Empty'}`
    addToCart({
      id: `build-tree-${size}-${color}-${plant ?? 'empty'}`.replace(/\s+/g, '-').toLowerCase(),
      slug: 'build-your-own-tree-of-life',
      name,
      price: total,
      category: 'Get On The Flora',
      emoji: '🌳',
      image: null,
      details: [
        `Size: ${size}`,
        `Color: ${color}`,
        plant ? `Plant: ${plant} (Local Pickup Only)` : 'No plant — shippable',
      ],
    })
    showToast('Added to cart')
    setAdded(true)
    setTimeout(() => setAdded(false), 1600)
  }

  return (
    <div style={{ color: '#2a1a0e' }}>

      {/* ── Size ─────────────────────────────────────────── */}
      <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#2a1a0e', marginBottom: '12px' }}>
        Size
      </p>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '28px', flexWrap: 'wrap' }}>
        {SIZES.map(s => (
          <button key={s.label} style={pill(size === s.label)} onClick={() => setSize(s.label)}>
            {s.label} — ${s.price}
          </button>
        ))}
      </div>

      {/* ── Color ────────────────────────────────────────── */}
      <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#2a1a0e', marginBottom: '12px' }}>
        Wood Color
      </p>
      <div style={{ display: 'flex', gap: '10px', marginBottom: '28px', flexWrap: 'wrap' }}>
        {COLORS.map(c => (
          <button key={c.label} style={pill(color === c.label)} onClick={() => setColor(c.label)}>
            <span style={{
              display: 'inline-block',
              width: '10px', height: '10px',
              borderRadius: '50%',
              background: c.swatch,
              marginRight: '8px',
              verticalAlign: 'middle',
              border: '1px solid rgba(255,255,255,0.3)',
            }} />
            {c.label}
          </button>
        ))}
      </div>

      {/* ── Plant ────────────────────────────────────────── */}
      <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#2a1a0e', marginBottom: '12px' }}>
        Plant
      </p>
      <div style={{ display: 'flex', gap: '10px', marginBottom: withPlant ? '16px' : '28px', flexWrap: 'wrap' }}>
        <button style={pill(withPlant === false)} onClick={() => { setWithPlant(false); setPlant(null) }}>
          Empty — shippable
        </button>
        <button style={pill(withPlant === true)} onClick={() => setWithPlant(true)}>
          Choose Life +$5 · Local Pickup Only
        </button>
      </div>

      {/* ── Plant picker ─────────────────────────────────── */}
      {withPlant && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '28px' }}>
          {PLANTS.map(p => (
            <button key={p} style={pill(plant === p)} onClick={() => setPlant(p)}>
              {p}
            </button>
          ))}
        </div>
      )}

      {/* ── Shipping notice ──────────────────────────────── */}
      {withPlant !== null && (
        <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#2a1a0e', marginBottom: '24px', letterSpacing: '0.08em' }}>
          {canShip
            ? '↳ Can be shipped — buyer pays shipping at checkout'
            : '↳ Local pickup only when a plant is included'}
        </p>
      )}

      {/* ── Total ────────────────────────────────────────── */}
      {total !== null && (
        <p style={{ fontFamily: 'monospace', fontSize: '1.1rem', color: '#2a1a0e', marginBottom: '24px' }}>
          ${total}
        </p>
      )}

      {/* ── Add to Cart ──────────────────────────────────── */}
      <button
        onClick={handleAdd}
        disabled={!ready}
        style={{
          width: '100%',
          fontFamily: 'monospace',
          fontSize: '11px',
          letterSpacing: '0.15em',
          textTransform: 'uppercase',
          border: '1px solid',
          padding: '16px',
          cursor: ready ? 'pointer' : 'not-allowed',
          transition: 'all 0.2s',
          background: added ? '#2a1a0e' : ready ? 'rgba(42,26,14,0.08)' : 'transparent',
          borderColor: added ? '#2a1a0e' : ready ? '#2a1a0e' : 'rgba(42,26,14,0.25)',
          color: added ? '#f2ebe0' : ready ? '#2a1a0e' : 'rgba(42,26,14,0.35)',
          marginBottom: '10px',
        }}
      >
        {added ? 'Added ✓' : !ready ? 'Make your selections above' : 'Add to Cart'}
      </button>

      <Toast message={toast.message} visible={toast.visible} />
    </div>
  )
}
