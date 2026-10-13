// Package size and weight for shop-cart orders, for live Shippo rate quotes.
// (CD printing orders use cdParcels in cdPricing.mjs.)
//
// Weights come from the product record (weightOz). Many listings have none, so
// each type has a typical packed weight to fall back on, and every item gets a
// minimum so a print entered as "0.1 oz" isn't quoted as weightless.

export const TYPE_WEIGHT_OZ = {
  'Vinyl':          24,   // LP in a mailer
  'CDs':            6,
  'Cassette Tapes': 4,
  '8 Tracks':       10,
  'VHS Tapes':      12,
}
export const DEFAULT_ITEM_OZ = 16   // anything else without a weight
export const MIN_ITEM_OZ     = 4    // smallest packed item (a print in a rigid mailer)
export const BOX_TARE_OZ     = 6    // box + padding
export const MAX_PARCEL_LB   = 40

export function itemPackedOz(product = {}) {
  const w = Number(product.weightOz)
  const base = w > 0 ? w : (TYPE_WEIGHT_OZ[product.type] ?? DEFAULT_ITEM_OZ)
  return Math.max(base, MIN_ITEM_OZ)
}

// lines: [{ product, qty }] for physical items only.
// Records ship flat in a 13" square LP mailer; everything else in a
// general box sized by weight. Heavy orders split into equal boxes.
export function cartParcels(lines) {
  const totalOz = lines.reduce((s, l) => s + itemPackedOz(l.product) * (l.qty || 1), 0)
  const records = lines.filter(l => l.product?.type === 'Vinyl').reduce((s, l) => s + (l.qty || 1), 0)
  const maxOz = MAX_PARCEL_LB * 16 - BOX_TARE_OZ
  const boxes = Math.max(1, Math.ceil(totalOz / maxOz))
  const perBoxOz = totalOz / boxes
  const lb = (perBoxOz + BOX_TARE_OZ) / 16

  const dims = records > 0
    ? { length: 13.5, width: 13.5, height: Math.min(12, 1 + 0.5 * Math.ceil(records / boxes)) }
    : lb <= 1  ? { length: 10, width: 8,  height: 2 }
    : lb <= 5  ? { length: 12, width: 9,  height: 4 }
    : lb <= 15 ? { length: 16, width: 12, height: 8 }
    :            { length: 20, width: 16, height: 12 }

  return Array.from({ length: boxes }, () => ({
    ...Object.fromEntries(Object.entries(dims).map(([k, v]) => [k, +v.toFixed(1)])),
    distance_unit: 'in',
    weight: +lb.toFixed(2),
    mass_unit: 'lb',
  }))
}

// Canonical form of a cart's physical items, to check a quote still matches
// the order at checkout: sorted "id×qty" pairs.
export const itemsKey = items =>
  (items || []).map(i => `${i.id}×${Number(i.qty) || 1}`).sort().join(',')
