/**
 * Art Saturated — Product Catalog
 *
 * Categories: 'Art' | 'Get On The Flora' | 'Vintage Tech' | 'Physical Media'
 */

export const products = []

/** All filterable category labels, including the catch-all */
export const CATEGORIES = ['Art', 'Get On The Flora', 'Vintage Tech', 'Physical Media', 'Room 40 Threads']

/** Utility — get a single product by its slug */
export function getProductBySlug(slug) {
  return products.find((p) => p.slug === slug) ?? null
}
