import { ProductGrid } from 'art-saturated'

// ProductGrid lays ProductCards into a responsive auto-fill grid and renders an
// empty state with a browse CTA. Modes (default/art/glass/vintage) match
// ProductCard.

const products = [
  { id: '1', slug: 'coffee-ring-study-4', name: 'Coffee Ring Study No. 4', category: 'Original Art', price: 180, emoji: '🎨', unique: true },
  { id: '2', slug: 'sunset-sessions-lp', name: 'Sunset Sessions — LP', category: 'Physical Media', price: 28, emoji: '🎵' },
  { id: '3', slug: 'hand-thrown-mug', name: 'Hand-thrown Mug', category: 'Handmade Goods', price: 45, emoji: '🍵' },
  { id: '4', slug: 'minolta-x700', name: 'Minolta X-700', category: 'Vintage Tech', price: 145, emoji: '📷', localLegend: true },
  { id: '5', slug: 'risograph-print', name: 'Risograph Print — Dusk', category: 'Original Art', price: 35, emoji: '🖼️' },
  { id: '6', slug: 'cassette-mixtape', name: 'Summer Mixtape ’24', category: 'Physical Media', price: 14, emoji: '📼', sold: true },
]

export const Grid = () => (
  <div style={{ padding: 16 }}>
    <ProductGrid products={products} />
  </div>
)

export const ArtMode = () => (
  <div style={{ padding: 16 }}>
    <ProductGrid products={products.slice(0, 4)} artMode />
  </div>
)

export const Empty = () => (
  <div style={{ padding: 16 }}>
    <ProductGrid products={[]} />
  </div>
)
