/**
 * Art Saturated — Product Catalog
 *
 * Categories: 'Art' | 'Get On The Flora' | 'Vintage Tech' | 'Physical Media' | 'Clothing'
 */

export const products = []

// What the public shop shows right now (owner, Nov 2026: art only for now).
// Other categories stay in Firestore and the admin, hidden everywhere public:
// shop, home page, artist pages, product pages and the sitemap. To bring
// records back, add 'Physical Media' here.
export const LIVE_CATEGORIES = ['Art']

export const isLiveCategory = (product) => LIVE_CATEGORIES.includes(normalizeCategory(product?.category))

/** All filterable category labels, including the catch-all */
export const CATEGORIES = ['Art', 'Get On The Flora', 'Vintage Tech', 'Physical Media', 'Clothing']

// 'Room 40 Threads' was the shop's own clothing line; it is retired and the
// category is now plain 'Clothing', open to anyone selling garments. Product
// docs written before the rename still carry the old string, so reads normalize
// instead of depending on a migration having been run. Safe to delete this map
// once `scripts/rename-threads-category.mjs` has run against production.
const LEGACY_CATEGORIES = { 'Room 40 Threads': 'Clothing' }

export function normalizeCategory(category) {
  return LEGACY_CATEGORIES[category] || category
}

/** Product with its category normalized. Returns the same object when nothing changed. */
export function normalizeProduct(p) {
  const category = normalizeCategory(p.category)
  return category === p.category ? p : { ...p, category }
}

/** Utility — get a single product by its slug */
export function getProductBySlug(slug) {
  return products.find((p) => p.slug === slug) ?? null
}
