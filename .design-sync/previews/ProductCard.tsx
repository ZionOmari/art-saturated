import { ProductCard } from 'art-saturated'

// ProductCard is a clickable product tile with four visual modes
// (default / artMode / glassMode / vintageMode). It fills its container's
// width, so each story constrains the width and — for the glass/vintage modes
// — supplies the dark backdrop those modes are designed to sit on.

const art = { id: '1', slug: 'coffee-ring-study-4', name: 'Coffee Ring Study No. 4', category: 'Original Art', price: 180, emoji: '🎨', unique: true }
const vinyl = { id: '2', slug: 'sunset-sessions-lp', name: 'Sunset Sessions — LP', category: 'Physical Media', price: 28, emoji: '🎵' }
const mug = { id: '3', slug: 'hand-thrown-mug', name: 'Hand-thrown Stoneware Mug', category: 'Handmade Goods', price: 45, emoji: '🍵', sold: true }
const camera = { id: '4', slug: 'minolta-x700', name: 'Minolta X-700 (1981)', category: 'Vintage Tech', price: 145, emoji: '📷', localLegend: true }

const Frame = ({ children, bg }: any) => (
  <div style={{ width: 260, padding: 16, background: bg }}>{children}</div>
)

export const Default = () => (
  <Frame>
    <ProductCard product={art} />
  </Frame>
)

export const SoldOut = () => (
  <Frame>
    <ProductCard product={mug} />
  </Frame>
)

export const ArtMode = () => (
  <Frame>
    <ProductCard product={art} artMode />
  </Frame>
)

export const GlassMode = () => (
  <Frame bg="linear-gradient(135deg, #6b4a2a, #241a0e)">
    <ProductCard product={vinyl} glassMode />
  </Frame>
)

export const VintageMode = () => (
  <Frame bg="#0e0e0e">
    <ProductCard product={camera} vintageMode />
  </Frame>
)
