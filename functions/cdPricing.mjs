// CD printing — the one place prices live.
//
// Imported by the order page (src/pages/QuoteRequestPage.jsx) to show a live
// total, and by the Cloud Function that builds the Stripe session, which
// recomputes the price from the saved order config. The client's own total is
// never trusted. It lives under functions/ because only this folder is
// uploaded on a functions deploy.
//
// All amounts are in CENTS.

export const CD_PRICING = {
  setupFee: 2500,                 // per order: file prep, test burn, print calibration

  // Tuned so 100 disc-only CDs come to $300 before tax: $2.75/disc after the
  // 15% volume discount, plus the $25 setup fee.
  disc: 294,                      // blank CD-R, burn, printed disc face

  packaging: {
    sleeve: 30,                   // disc in a paper sleeve, no printed cover
    slim:   75,                   // slim case
    jewel:  125,                  // jewel case
  },

  // Printed covers. Slim and jewel both get a front and a back cover, each
  // one print (jewel: booklet + tray card; slim: front + back panel).
  printsPerCover: 2,
  print: {
    standard:  75,                // per print
    cardstock: 125,               // per print
  },

  removeCredit: 25,               // drop the "Printed at Art Saturated" line

  // Volume discount on the per-disc price (not the setup fee or shipping).
  // Highest matching row wins.
  volume: [
    { min: 25,  pct: 5 },
    { min: 50,  pct: 10 },
    { min: 100, pct: 15 },
  ],

  // Shipping is a live carrier rate (Shippo) the customer picks at checkout,
  // priced from the packed weight (cdParcels below). US only; outside the US
  // is by inquiry.

  // Rush: ready in under rushDays instead of the standard 7–14. Charged as a
  // percentage of production (discs + setup fee), not shipping.
  rushPct: 20,
  rushDays: 7,

  // Indiana sales tax, on the goods (discs + setup + rush) — shipping is not taxed,
  // matching the shop cart (CartPage.jsx).
  taxRate: 0.07,

  // Orders at or above this quantity pay a deposit upfront and the rest when
  // the order is ready. Below it, the whole order is paid at checkout.
  depositThreshold: 50,
  depositPct: 50,

  maxQty: 1000,

  // Files are kept this long after a project's most recent paid order. A
  // reorder inside the window skips the setup fee and keeps the previous
  // run's per-disc rate (or today's rate, if that is lower).
  retentionDays: 183,
}

// ── Promo codes ──────────────────────────────────────────────────────────────
// Stored as SHA-256 hashes of the upper-cased code, so the code itself can't be
// read out of the page source. To add or change a code, hash it with:
//   node -e "console.log(require('crypto').createHash('sha256').update('CODE').digest('hex'))"
// A promo is all-in: perDiscAllIn covers the disc, sleeve, setup and sales tax.
// Only shipping is added. It can't be combined with rush or a reorder.
export const CD_PROMOS = [
  {
    id:           'testpress',
    hash:         '38d9d48cf5aa89b79af4b841f19279dd1be3a9ea31f1b30bc2e02105cb318411',  // TESTPRESS
    label:        'Test press',
    packaging:    'sleeve',
    minQty:       25,
    maxQty:       50,
    perDiscAllIn: 200,
  },
]

export const normalizePromoCode = code => String(code || '').trim().toUpperCase().replace(/\s+/g, '')
export const findPromoByHash   = hash => CD_PROMOS.find(pr => pr.hash === hash) || null

// Why a promo doesn't fit this config, or null when it does.
export function promoProblem(promo, raw) {
  if (!promo) return 'That code isn’t valid.'
  const c = normalizeCdConfig(raw)
  if (c.packaging !== promo.packaging) return `${promo.label} is for ${PACKAGING_LABELS[promo.packaging].toLowerCase()} orders.`
  if (c.qty < promo.minQty || c.qty > promo.maxQty) return `${promo.label} is for ${promo.minQty}–${promo.maxQty} discs.`
  return null
}

export const PACKAGING_LABELS = {
  sleeve: 'Disc only (paper sleeve)',
  slim:   'Slim case',
  jewel:  'Jewel case',
}

export const STOCK_LABELS = {
  standard:  'Standard paper',
  cardstock: 'Cardstock',
}

// Normalise whatever was submitted into a valid config. The function calls
// this on data read back from Firestore, so it must never throw.
export function normalizeCdConfig(raw = {}) {
  const packaging = ['sleeve', 'slim', 'jewel'].includes(raw.packaging) ? raw.packaging : 'jewel'
  const printed   = packaging !== 'sleeve'
  const qty = Math.min(CD_PRICING.maxQty, Math.max(1, Math.floor(Number(raw.qty) || 1)))
  return {
    qty,
    packaging,
    panelCount:   printed ? (Number(raw.panelCount) === 2 ? 2 : 4) : 0,
    stock:        printed && raw.stock === 'cardstock' ? 'cardstock' : 'standard',
    removeCredit: printed && !!raw.removeCredit,
    delivery:     'ship',   // online only — every order ships (no pickup)
    rush:         !!raw.rush,
  }
}

// Itemised price for a config. Returns cents throughout.
//
// opts.shippingCents: the chosen carrier rate, in cents (the checkout function
// passes the server-verified amount; the page passes the rate it shows).
// opts.reorderRate: the per-disc rate (cents) of the run being reordered. When
// set, the setup fee is waived and the per-disc price is capped at that rate.
// opts.promo: a promo from CD_PROMOS (already matched by code). If it fits the
// config the order is priced all-in at the promo rate; otherwise it's ignored
// and promoProblem says why.
const shippingOf = opts => Math.max(0, Math.round(Number(opts.shippingCents) || 0))

export function priceCdOrder(raw, opts = {}) {
  const c = normalizeCdConfig(raw)
  const P = CD_PRICING
  const printed = c.packaging !== 'sleeve'

  if (opts.promo && !opts.reorderRate && !promoProblem(opts.promo, c)) {
    const pr = opts.promo
    const cfg = { ...c, rush: false }
    const discsTotal = pr.perDiscAllIn * cfg.qty
    const shipping = shippingOf(opts)
    const total = discsTotal + shipping
    return {
      config: cfg,
      lines: [{ label: `${pr.label}: disc, burn, printed face & sleeve — setup and tax included`, each: pr.perDiscAllIn }],
      perDiscBase: pr.perDiscAllIn,
      discountPct: 0,
      perDisc: pr.perDiscAllIn,
      discsTotal,
      setupFee: 0,
      rushFee: 0,
      isReorder: false,
      promoId: pr.id,
      promoLabel: pr.label,
      subtotal: discsTotal,
      tax: 0,
      // Sales tax inside the all-in price, for the books.
      taxIncluded: Math.round(discsTotal - discsTotal / (1 + P.taxRate)),
      shipping,
      total,
      isDeposit: false,
      dueNow: total,
      balance: 0,
    }
  }

  const lines = []   // per-disc components, for display
  lines.push({ label: 'Disc, burn & printed face', each: P.disc })
  lines.push({ label: PACKAGING_LABELS[c.packaging], each: P.packaging[c.packaging] })
  if (printed) {
    lines.push({ label: `Front & back covers, ${STOCK_LABELS[c.stock].toLowerCase()}`, each: P.print[c.stock] * P.printsPerCover })
    if (c.removeCredit) lines.push({ label: 'No "Printed at Art Saturated" credit', each: P.removeCredit })
  }

  const perDiscBase = lines.reduce((s, l) => s + l.each, 0)
  const tier = [...P.volume].reverse().find(v => c.qty >= v.min)
  const discountPct = tier ? tier.pct : 0
  const fresh = Math.round(perDiscBase * (100 - discountPct) / 100)
  const isReorder = Number.isFinite(opts.reorderRate) && opts.reorderRate > 0
  const perDisc = isReorder ? Math.min(fresh, opts.reorderRate) : fresh
  const setupFee = isReorder ? 0 : P.setupFee

  const discsTotal = perDisc * c.qty
  const rushFee = c.rush ? Math.round((setupFee + discsTotal) * P.rushPct / 100) : 0
  const subtotal = setupFee + discsTotal + rushFee
  const tax = Math.round(subtotal * P.taxRate)
  const shipping = shippingOf(opts)
  const total = subtotal + tax + shipping

  const isDeposit = c.qty >= P.depositThreshold
  const dueNow = isDeposit ? Math.round(total * P.depositPct / 100) : total

  return {
    config: c,
    lines,
    perDiscBase,
    discountPct,
    perDisc,
    discsTotal,
    setupFee,
    rushFee,
    isReorder,
    subtotal,
    tax,
    shipping,
    total,
    isDeposit,
    dueNow,
    balance: total - dueNow,
  }
}

// Is this paid order still inside the retention window at `now` (ms)?
// paidAtMs: when the order was paid. Returns the cut-off date too.
export function reorderWindow(paidAtMs, now = Date.now()) {
  if (!paidAtMs) return { open: false, until: null }
  const until = paidAtMs + CD_PRICING.retentionDays * 24 * 60 * 60 * 1000
  return { open: now <= until, until }
}

// ── Parcels ──────────────────────────────────────────────────────────────────
// Packed size and weight for Shippo (admin label purchase only). Units are stacked in columns inside one
// box; orders over maxParcelLb are split into equal boxes. Figures include the
// disc, case/sleeve and printed covers.
export const CD_PACKING = {
  unit: {
    sleeve: { oz: 0.9, thickIn: 0.08, footprint: [5.5, 5.5] },
    slim:   { oz: 2.4, thickIn: 0.21, footprint: [5.6, 4.9] },
    jewel:  { oz: 3.7, thickIn: 0.41, footprint: [5.6, 4.9] },
  },
  maxStackIn:  10,     // tallest column of cases in one box
  padIn:       1,      // added to each box dimension for padding
  tareOz:      6,      // box + padding weight
  maxParcelLb: 40,
}

export function cdParcels(raw) {
  const c = normalizeCdConfig(raw)
  const u = CD_PACKING.unit[c.packaging]
  const perStack  = Math.max(1, Math.floor(CD_PACKING.maxStackIn / u.thickIn))
  const maxPerBox = Math.max(1, Math.floor((CD_PACKING.maxParcelLb * 16 - CD_PACKING.tareOz) / u.oz))
  const boxes = Math.ceil(c.qty / maxPerBox)
  const parcels = []
  let left = c.qty
  for (let b = 0; b < boxes; b++) {
    const n = Math.ceil(left / (boxes - b))
    left -= n
    const stacks = Math.ceil(n / perStack)
    const cols = Math.min(stacks, 3)
    const rows = Math.ceil(stacks / cols)
    const height = Math.min(n, perStack) * u.thickIn
    parcels.push({
      length: +(cols * u.footprint[0] + CD_PACKING.padIn).toFixed(1),
      width:  +(rows * u.footprint[1] + CD_PACKING.padIn).toFixed(1),
      height: +(Math.max(height, 0.5) + CD_PACKING.padIn).toFixed(1),
      distance_unit: 'in',
      weight: +((n * u.oz + CD_PACKING.tareOz) / 16).toFixed(2),
      mass_unit: 'lb',
    })
  }
  return parcels
}

export const fmtCents = n => `$${(n / 100).toFixed(2)}`
