import { FloatingProductColumn } from 'art-saturated'

// A narrow vertical banner of slowly drifting product tiles (hero side rails).
// Enigma mode swaps the listings for the preorder teaser over the specks field.

const products = [
  { id: '1', slug: 'coffee-ring-study-4', name: 'Coffee Ring Study', price: 180 },
  { id: '2', slug: 'sunset-sessions-lp', name: 'Sunset Sessions', price: 28 },
  { id: '3', slug: 'risograph-print', name: 'Dusk Risograph', price: 35 },
  { id: '4', slug: 'minolta-x700', name: 'Minolta X-700', price: 145 },
]

export const Listings = () => (
  <div style={{ padding: 16, height: 560 }}>
    <FloatingProductColumn products={products} label="New in shop" colHeight={500} />
  </div>
)

export const EnigmaMode = () => (
  <div style={{ padding: 16, height: 560 }}>
    <FloatingProductColumn enigma label="Preorder" colHeight={500} />
  </div>
)
