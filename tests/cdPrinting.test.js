/**
 * CD printing — pricing, payment settlement, and the rules around the order doc.
 * Firestore emulator only (see the `test` script); no Stripe or email leaves.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore'
import { createHash } from 'node:crypto'
import { CD_PRICING, CD_PROMOS, priceCdOrder, normalizeCdConfig, reorderWindow, normalizePromoCode, findPromoByHash, promoProblem } from '../functions/cdPricing.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// A live-rate quote as onShippingRequestCreated writes it. Checkout re-reads
// it by id, so every shipped order in these tests points at one.
const RATE    = { objectId: 'rate_1', carrier: 'UPS', service: 'Ground', token: 'ups_ground', days: 3, amountCents: 1234, amount: '12.34', currency: 'USD' }
const SHIP_TO = { name: 'Band', street1: '1 Main St', city: 'Fort Wayne', state: 'IN', zip: '46802' }
const SHIP    = { shippingQuoteId: 'sq', shippingRateId: 'rate_1' }
async function seedQuote(db, result, { id = 'sq', uid = 'u1' } = {}) {
  await db.doc(`shippingRequests/${id}`).set({ uid, action: 'quote', status: 'ready', address: SHIP_TO, result: { rates: [RATE], ...result } })
}

// ── Pricing ───────────────────────────────────────────────────────────────────
describe('priceCdOrder', () => {
  it('adds the setup fee once per order, not per disc', () => {
    const one = priceCdOrder({ qty: 1, packaging: 'jewel' })
    const two = priceCdOrder({ qty: 2, packaging: 'jewel' })
    expect(two.subtotal - one.subtotal).toBe(one.perDisc)
    expect(one.subtotal).toBe(one.perDisc + CD_PRICING.setupFee)
  })

  it('prices covers per print: $0.75 standard, $1.25 cardstock, front and back', () => {
    const std  = priceCdOrder({ qty: 1, packaging: 'slim' }).perDisc
    const card = priceCdOrder({ qty: 1, packaging: 'slim', stock: 'cardstock' }).perDisc
    const bare = priceCdOrder({ qty: 1, packaging: 'sleeve' }).perDisc - CD_PRICING.packaging.sleeve + CD_PRICING.packaging.slim
    expect(std - bare).toBe(75 * 2)
    expect(card - bare).toBe(125 * 2)
  })

  it('has no gloss option any more (a stray flag changes nothing)', () => {
    const plain = priceCdOrder({ qty: 1, packaging: 'jewel' })
    expect(priceCdOrder({ qty: 1, packaging: 'jewel', gloss: true }).total).toBe(plain.total)
    expect('gloss' in normalizeCdConfig({ gloss: true })).toBe(false)
  })

  it('adds 20% rush on production (discs + setup), taxed, but not on shipping', () => {
    const std  = priceCdOrder({ qty: 30, packaging: 'jewel', delivery: 'ship' })
    const rush = priceCdOrder({ qty: 30, packaging: 'jewel', delivery: 'ship', rush: true })
    expect(rush.rushFee).toBe(Math.round((std.setupFee + std.discsTotal) * 0.2))
    expect(rush.shipping).toBe(std.shipping)
    expect(rush.tax).toBe(Math.round((std.subtotal + rush.rushFee) * CD_PRICING.taxRate))
  })

  it('charges rush on a reorder only on the discs (no setup fee to mark up)', () => {
    const r = priceCdOrder({ qty: 10, packaging: 'sleeve', rush: true }, { reorderRate: 275 })
    expect(r.rushFee).toBe(Math.round(2750 * 0.2))
  })

  it('prices 100 disc-only CDs at $300 before tax', () => {
    expect(priceCdOrder({ qty: 100, packaging: 'sleeve' }).subtotal).toBe(30000)
  })

  it('gives a reorder no setup fee and the previous rate', () => {
    const first = priceCdOrder({ qty: 100, packaging: 'jewel' })
    const again = priceCdOrder({ qty: 10, packaging: 'jewel' }, { reorderRate: first.perDisc })
    expect(again.setupFee).toBe(0)
    expect(again.perDisc).toBe(first.perDisc)
    expect(again.subtotal).toBe(first.perDisc * 10)
  })

  it("gives a reorder today's rate when that is lower", () => {
    const small = priceCdOrder({ qty: 10, packaging: 'jewel' })
    const big   = priceCdOrder({ qty: 200, packaging: 'jewel' }, { reorderRate: small.perDisc })
    expect(big.perDisc).toBe(priceCdOrder({ qty: 200, packaging: 'jewel' }).perDisc)
  })

  it('keeps the reorder window open for 6 months after payment', () => {
    const paid = Date.UTC(2026, 0, 1)
    const day = 24 * 60 * 60 * 1000
    expect(reorderWindow(paid, paid + 180 * day).open).toBe(true)
    expect(reorderWindow(paid, paid + 190 * day).open).toBe(false)
    expect(reorderWindow(null).open).toBe(false)
  })

  it('charges 7% sales tax on goods but not on shipping', () => {
    const p = priceCdOrder({ qty: 10, packaging: 'slim' })
    expect(p.tax).toBe(Math.round(p.subtotal * 0.07))
    expect(p.total).toBe(p.subtotal + p.tax + p.shipping)
  })

  it('ships every order at the chosen carrier rate (a pickup request is ignored)', () => {
    const p = priceCdOrder({ qty: 10, packaging: 'slim', delivery: 'pickup' }, { shippingCents: 1234 })
    expect(p.config.delivery).toBe('ship')
    expect(p.shipping).toBe(1234)
    expect(priceCdOrder({ qty: 10, packaging: 'slim' }).shipping).toBe(0)   // no rate picked yet
  })

  it('ignores cover options on a disc-only order', () => {
    const plain = priceCdOrder({ qty: 5, packaging: 'sleeve' })
    const noisy = priceCdOrder({ qty: 5, packaging: 'sleeve', stock: 'cardstock', panelCount: 4, removeCredit: true })
    expect(noisy.total).toBe(plain.total)
  })

  it('takes full payment below the deposit threshold and a deposit at or above it', () => {
    const below = priceCdOrder({ qty: CD_PRICING.depositThreshold - 1 })
    const at    = priceCdOrder({ qty: CD_PRICING.depositThreshold })
    expect(below.dueNow).toBe(below.total)
    expect(below.balance).toBe(0)
    expect(at.isDeposit).toBe(true)
    expect(at.dueNow + at.balance).toBe(at.total)
  })

  it('never lets a larger order cost less per disc', () => {
    let last = Infinity
    for (let q = 1; q <= 200; q++) {
      const p = priceCdOrder({ qty: q, packaging: 'jewel' })
      expect(p.perDisc).toBeLessThanOrEqual(last)
      last = p.perDisc
    }
  })

  it('clamps nonsense input instead of throwing', () => {
    expect(normalizeCdConfig({ qty: -4, packaging: 'crate' })).toMatchObject({ qty: 1, packaging: 'jewel' })
    expect(normalizeCdConfig({ qty: 1e9 }).qty).toBe(CD_PRICING.maxQty)
  })
})

// ── Settlement ────────────────────────────────────────────────────────────────
describe('handlePaidSession — cd_order', () => {
  let admin, db, handlePaidSession, sentMail

  beforeAll(async () => {
    admin = (await import('firebase-admin')).default
    const fns = await import('../functions/index.js')
    handlePaidSession = fns.handlePaidSession
    sentMail = fns.__sentMail
    db = admin.firestore()
  })

  beforeEach(async () => {
    sentMail.length = 0
    for (const name of ['quoteRequests', 'stripeSessions', 'orphanedPayments']) {
      const snap = await db.collection(name).get()
      await Promise.all(snap.docs.map(d => d.ref.delete()))
    }
  })

  const session = (amount, meta) => ({
    id: 'cs_test_' + Math.random().toString(36).slice(2, 10),
    payment_status: 'paid',
    amount_total: amount,
    customer_details: { email: 'band@example.com' },
    metadata: { type: 'cd_order', ...meta },
  })

  async function seed(id, extra) {
    await db.doc(`quoteRequests/${id}`).set({
      uid: 'u1', name: 'Band', email: 'band@example.com', qty: 20, packaging: 'jewel',
      panelCount: 4, stock: 'standard', delivery: 'pickup', trackList: ['A', 'B'],
      status: 'pending_payment', paymentStatus: 'unpaid', ...extra,
    })
  }

  it('marks a full payment paid and emails customer and owner once', async () => {
    await seed('cd1', { totalCents: 10000 })
    const s = session(10000, { orderId: 'cd1', stage: 'initial' })
    await handlePaidSession(s)
    await handlePaidSession(s)   // redelivery must be a no-op

    const o = (await db.doc('quoteRequests/cd1').get()).data()
    expect(o).toMatchObject({ status: 'paid', paymentStatus: 'paid', amountPaidCents: 10000 })
    expect(sentMail.map(m => m.to)).toEqual(['band@example.com', 'zionomari@artsaturated.com'])
  })

  it('records a deposit, then settles the balance', async () => {
    await seed('cd2', { qty: 60, totalCents: 30000 })
    await handlePaidSession(session(15000, { orderId: 'cd2', stage: 'initial' }))
    let o = (await db.doc('quoteRequests/cd2').get()).data()
    expect(o).toMatchObject({ status: 'paid', paymentStatus: 'deposit_paid', amountPaidCents: 15000 })

    await db.doc('quoteRequests/cd2').update({ status: 'ready' })
    await handlePaidSession(session(15000, { orderId: 'cd2', stage: 'balance' }))
    o = (await db.doc('quoteRequests/cd2').get()).data()
    expect(o).toMatchObject({ status: 'ready', paymentStatus: 'paid', amountPaidCents: 30000 })
  })

  it('records a payment for a missing order as an orphan and alerts the owner', async () => {
    const s = session(5000, { orderId: 'ghost', stage: 'initial' })
    await handlePaidSession(s)
    expect((await db.doc(`orphanedPayments/${s.id}`).get()).exists).toBe(true)
    expect(sentMail[0].to).toBe('zionomari@artsaturated.com')
  })
})

// ── Rules ─────────────────────────────────────────────────────────────────────
describe('firestore.rules — quoteRequests', () => {
  let testEnv
  const NEW = {
    uid: 'buyer1', email: 'b@example.com', qty: 10, packaging: 'slim',
    status: 'pending_payment', paymentStatus: 'unpaid',
  }

  beforeAll(async () => {
    const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':')
    testEnv = await initializeTestEnvironment({
      projectId: 'art-saturated-cd-rules-test',
      firestore: { rules: readFileSync(resolve(root, 'firestore.rules'), 'utf8'), host, port: Number(port) },
    })
  })
  afterAll(async () => { await testEnv?.cleanup() })
  beforeEach(async () => { await testEnv.clearFirestore() })

  const buyer = () => testEnv.authenticatedContext('buyer1', { email: 'b@example.com' }).firestore()
  const other = () => testEnv.authenticatedContext('other1', { email: 'o@example.com' }).firestore()
  const anon  = () => testEnv.unauthenticatedContext().firestore()

  it('lets a signed-in customer create their own unpaid order', async () => {
    await assertSucceeds(setDoc(doc(buyer(), 'quoteRequests/q1'), NEW))
  })

  it('rejects anonymous, forged-uid, and pre-paid creates', async () => {
    await assertFails(setDoc(doc(anon(),  'quoteRequests/q1'), NEW))
    await assertFails(setDoc(doc(other(), 'quoteRequests/q1'), NEW))
    await assertFails(setDoc(doc(buyer(), 'quoteRequests/q1'), { ...NEW, paymentStatus: 'paid' }))
    await assertFails(setDoc(doc(buyer(), 'quoteRequests/q1'), { ...NEW, status: 'paid' }))
    await assertFails(setDoc(doc(buyer(), 'quoteRequests/q1'), { ...NEW, amountPaidCents: 99999 }))
  })

  it('lets only the customer read it, and nobody but the admin update it', async () => {
    await testEnv.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'quoteRequests/q1'), NEW))
    await assertSucceeds(getDoc(doc(buyer(), 'quoteRequests/q1')))
    await assertFails(getDoc(doc(other(), 'quoteRequests/q1')))
    await assertFails(updateDoc(doc(buyer(), 'quoteRequests/q1'), { paymentStatus: 'paid' }))
  })
})

// ── Checkout: reorders ────────────────────────────────────────────────────────
// Runs the real onCheckoutRequestCreated trigger with Stripe stubbed out.
describe('onCheckoutRequestCreated — cd_order reorders', () => {
  let admin, db, fns, created

  beforeAll(async () => {
    admin = (await import('firebase-admin')).default
    fns = await import('../functions/index.js')
    db = admin.firestore()
    fns.__setStripeStub({
      checkout: { sessions: {
        create: async (params) => { created.push(params); return { id: 'cs_stub', url: 'https://stripe.test/pay' } },
        listLineItems: async () => ({ data: [] }),
      } },
    })
  })

  beforeEach(async () => {
    created = []
    for (const name of ['quoteRequests', 'checkoutRequests', 'shippingRequests']) {
      const snap = await db.collection(name).get()
      await Promise.all(snap.docs.map(d => d.ref.delete()))
    }
  })

  const DAY = 24 * 60 * 60 * 1000
  async function seedSource(paidDaysAgo, extra = {}) {
    await db.doc('quoteRequests/src').set({
      uid: 'u1', name: 'Band', email: 'band@example.com', artistName: 'Band', albumTitle: 'LP',
      qty: 100, packaging: 'sleeve', delivery: 'pickup', trackList: ['A'], audioFiles: [], artwork: { disc: 'https://x/disc.jpg' },
      status: 'completed', paymentStatus: 'paid', perDiscCents: 275,
      paidAt: admin.firestore.Timestamp.fromMillis(Date.now() - paidDaysAgo * DAY), ...extra,
    })
  }

  async function runCheckout(orderId) {
    const ref = db.collection('checkoutRequests').doc()
    const data = { type: 'cd_order', orderId, uid: 'u1', customerEmail: 'band@example.com' }
    await ref.set(data)
    await fns.onCheckoutRequestCreated.run({ data: () => data, ref }, { params: { docId: ref.id } })
    return (await ref.get()).data()
  }

  it('charges no setup fee, keeps the rate, and locks files and options to the source', async () => {
    await seedSource(30)
    // The client tries to upgrade to a jewel case at the old disc-only rate.
    await seedQuote(db, { kind: 'cd', qty: 20, packaging: 'jewel' })
    await db.doc('quoteRequests/re1').set({
      uid: 'u1', email: 'band@example.com', qty: 20, packaging: 'jewel', delivery: 'pickup',
      reorderOf: 'src', status: 'pending_payment', paymentStatus: 'unpaid', ...SHIP,
    })
    const req = await runCheckout('re1')
    expect(req.status).toBe('ready')

    const o = (await db.doc('quoteRequests/re1').get()).data()
    expect(o.packaging).toBe('sleeve')
    expect(o.perDiscCents).toBe(275)
    expect(o.artwork).toEqual({ disc: 'https://x/disc.jpg' })
    expect(o.projectId).toBe('src')

    const names = created[0].line_items.map(l => l.price_data.product_data.name)
    expect(names).not.toContain('Setup fee')
    expect(created[0].line_items[0].price_data.unit_amount).toBe(275)
  })

  it('refuses a reorder after the 6-month window', async () => {
    await seedSource(200)
    await seedQuote(db, { kind: 'cd', qty: 20, packaging: 'sleeve' })
    await db.doc('quoteRequests/re2').set({
      uid: 'u1', email: 'band@example.com', qty: 20, packaging: 'sleeve', delivery: 'pickup',
      reorderOf: 'src', status: 'pending_payment', paymentStatus: 'unpaid', ...SHIP,
    })
    const req = await runCheckout('re2')
    expect(req.status).toBe('error')
    expect(created).toHaveLength(0)
  })

  it("refuses a reorder of someone else's project", async () => {
    await seedSource(30, { uid: 'someoneElse' })
    await seedQuote(db, { kind: 'cd', qty: 20, packaging: 'sleeve' })
    await db.doc('quoteRequests/re3').set({
      uid: 'u1', email: 'band@example.com', qty: 20, packaging: 'sleeve', delivery: 'pickup',
      reorderOf: 'src', status: 'pending_payment', paymentStatus: 'unpaid', ...SHIP,
    })
    expect((await runCheckout('re3')).status).toBe('error')
    expect(created).toHaveLength(0)
  })
})

// ── Shipping ─────────────────────────────────────────────────────────────────
describe('cdParcels', () => {
  it('keeps every box under the weight cap and ships every disc', async () => {
    const { cdParcels, CD_PACKING } = await import('../functions/cdPricing.mjs')
    for (const packaging of ['sleeve', 'slim', 'jewel']) {
      for (const qty of [1, 25, 100, 500, 1000]) {
        const boxes = cdParcels({ qty, packaging })
        for (const b of boxes) expect(b.weight).toBeLessThanOrEqual(CD_PACKING.maxParcelLb)
        const unitOz = CD_PACKING.unit[packaging].oz
        const discs = boxes.reduce((s, b) => s + Math.round((b.weight * 16 - CD_PACKING.tareOz) / unitOz), 0)
        expect(discs).toBe(qty)
      }
    }
  })
})

describe('cart package weights', () => {
  it('falls back to a typical weight per type and never ships anything weightless', async () => {
    const { itemPackedOz, MIN_ITEM_OZ, TYPE_WEIGHT_OZ } = await import('../functions/shippingCalc.mjs')
    expect(itemPackedOz({ type: 'Vinyl' })).toBe(TYPE_WEIGHT_OZ.Vinyl)
    expect(itemPackedOz({ type: 'CDs', weightOz: '' })).toBe(TYPE_WEIGHT_OZ.CDs)
    expect(itemPackedOz({ weightOz: '0.1' })).toBe(MIN_ITEM_OZ)
    expect(itemPackedOz({ weightOz: 160 })).toBe(160)
  })

  it('ships records in an LP mailer and splits heavy orders under the weight cap', async () => {
    const { cartParcels, MAX_PARCEL_LB } = await import('../functions/shippingCalc.mjs')
    const lp = cartParcels([{ product: { type: 'Vinyl' }, qty: 2 }])
    expect(lp).toHaveLength(1)
    expect(lp[0].length).toBe(13.5)
    const heavy = cartParcels([{ product: { weightOz: 160 }, qty: 6 }])   // 60 lb of art
    expect(heavy.length).toBeGreaterThan(1)
    for (const b of heavy) expect(b.weight).toBeLessThanOrEqual(MAX_PARCEL_LB)
  })
})

describe('onCheckoutRequestCreated — live shipping rates', () => {
  let admin, db, fns, created

  beforeAll(async () => {
    admin = (await import('firebase-admin')).default
    fns = await import('../functions/index.js')
    db = admin.firestore()
    fns.__setStripeStub({
      checkout: { sessions: {
        create: async (params) => { created.push(params); return { id: 'cs_stub', url: 'https://stripe.test/pay' } },
        listLineItems: async () => ({ data: [] }),
      } },
    })
  })

  beforeEach(async () => {
    created = []
    for (const name of ['quoteRequests', 'checkoutRequests', 'orders', 'products', 'shippingRequests']) {
      const snap = await db.collection(name).get()
      await Promise.all(snap.docs.map(d => d.ref.delete()))
    }
  })

  async function run(data) {
    const ref = db.collection('checkoutRequests').doc()
    await ref.set(data)
    await fns.onCheckoutRequestCreated.run({ data: () => data, ref }, { params: { docId: ref.id } })
    return (await ref.get()).data()
  }

  it('charges a CD order the quoted rate and keeps the quoted address and service', async () => {
    await seedQuote(db, { kind: 'cd', qty: 200, packaging: 'jewel' })
    await db.doc('quoteRequests/o1').set({
      uid: 'u1', email: 'band@example.com', name: 'Band', qty: 200, packaging: 'jewel', panelCount: 4,
      status: 'pending_payment', paymentStatus: 'unpaid', ...SHIP,
      shippingAddress: { ...SHIP_TO, street1: 'forged' },
    })
    expect((await run({ type: 'cd_order', orderId: 'o1', uid: 'u1' })).status).toBe('ready')
    const o = (await db.doc('quoteRequests/o1').get()).data()
    expect(o.totalCents).toBe(priceCdOrder({ qty: 200, packaging: 'jewel', panelCount: 4 }, { shippingCents: 1234 }).total)
    expect(o.shippingCents).toBe(1234)
    expect(o.shippingAddress.street1).toBe('1 Main St')
    expect(o.shippingService.token).toBe('ups_ground')
    expect(created[0].shipping_address_collection).toBeUndefined()
  })

  it("refuses a CD order with no quote, someone else's quote, or a quote for another quantity", async () => {
    const base = { uid: 'u1', email: 'b@example.com', qty: 20, packaging: 'slim', status: 'pending_payment', paymentStatus: 'unpaid' }
    await db.doc('quoteRequests/n1').set(base)
    expect((await run({ type: 'cd_order', orderId: 'n1', uid: 'u1' })).status).toBe('error')
    await seedQuote(db, { kind: 'cd', qty: 20, packaging: 'slim' }, { uid: 'other' })
    await db.doc('quoteRequests/n2').set({ ...base, ...SHIP })
    expect((await run({ type: 'cd_order', orderId: 'n2', uid: 'u1' })).status).toBe('error')
    await seedQuote(db, { kind: 'cd', qty: 50, packaging: 'slim' })
    await db.doc('quoteRequests/n3').set({ ...base, ...SHIP })
    expect((await run({ type: 'cd_order', orderId: 'n3', uid: 'u1' })).status).toBe('error')
    expect(created).toHaveLength(0)
  })

  it('charges a shop order the quoted rate, whatever the browser sends, and records it', async () => {
    await db.doc('products/p1').set({ name: 'Enigma', price: 15, category: 'Physical Media' })
    await db.doc('orders/ord1').set({ uid: 'u1', status: 'pending', paymentStatus: 'pending' })
    await seedQuote(db, { kind: 'cart', itemsKey: 'p1×1' })
    await run({
      type: 'order', uid: 'u1', orderId: 'ord1', customerEmail: 'b@example.com',
      items: [{ id: 'p1', name: 'Enigma', price: 1, qty: 1 }],
      shippingMethod: 'ship', shippingCost: 0, taxAmount: 1.05, ...SHIP,
    })
    const lines = created[0].line_items
    expect(lines.find(l => l.price_data.product_data.name === 'Enigma').price_data.unit_amount).toBe(1500)
    const ship = lines.find(l => /^Shipping/.test(l.price_data.product_data.name))
    expect(ship.price_data.unit_amount).toBe(1234)
    expect(ship.price_data.product_data.name).toBe('Shipping — UPS Ground')
    const o = (await db.doc('orders/ord1').get()).data()
    expect(o).toMatchObject({ shippingCost: 12.34, shippingAddress: SHIP_TO })
  })

  it('refuses a physical shop order without a matching quote (even one claiming pickup)', async () => {
    await db.doc('products/p1').set({ name: 'Enigma', price: 15, category: 'Physical Media' })
    await db.doc('orders/ord2').set({ uid: 'u1', status: 'pending', paymentStatus: 'pending' })
    expect((await run({
      type: 'order', uid: 'u1', orderId: 'ord2', customerEmail: 'b@example.com',
      items: [{ id: 'p1', name: 'Enigma', qty: 1 }], shippingMethod: 'pickup', shippingCost: 0,
    })).status).toBe('error')
    await seedQuote(db, { kind: 'cart', itemsKey: 'p1×1' })   // quoted for 1, ordering 2
    expect((await run({
      type: 'order', uid: 'u1', orderId: 'ord2', customerEmail: 'b@example.com',
      items: [{ id: 'p1', name: 'Enigma', qty: 2 }], shippingMethod: 'ship', ...SHIP,
    })).status).toBe('error')
    expect(created).toHaveLength(0)
  })

  it('refuses to sell a hidden, taken-down or bucketed listing', async () => {
    // A cart lives in localStorage and product URLs get shared, so a buyer can
    // still reach a listing after the artist hides it or the owner takes it down.
    // The page check is cosmetic; this is the one that holds.
    const cases = {
      hidden:  { active: false },
      removed: { active: false, moderation: 'removed' },
      bucket:  { inBucket: true },
    }
    for (const [id, extra] of Object.entries(cases)) {
      await db.doc(`products/${id}`).set({ name: id, price: 15, category: 'Art', stock: 1, ...extra })
      await db.doc(`orders/o-${id}`).set({ uid: 'u1', status: 'pending', paymentStatus: 'pending' })
      await seedQuote(db, { kind: 'cart', itemsKey: `${id}×1` })
      const res = await run({
        type: 'order', uid: 'u1', orderId: `o-${id}`, customerEmail: 'b@example.com',
        items: [{ id, name: id, qty: 1 }], shippingMethod: 'ship', ...SHIP,
      })
      expect(res.status, id).toBe('error')
      expect(res.error, id).toMatch(/no longer available/)
    }
    expect(created).toHaveLength(0)
  })

  it('charges no shipping on a download-only order', async () => {
    await db.doc('products/d1').set({ name: 'Album (download)', price: 8, category: 'Physical Media', downloadPath: 'releases/album.zip' })
    await db.doc('orders/ord3').set({ uid: 'u1', status: 'pending', paymentStatus: 'pending' })
    await run({
      type: 'order', uid: 'u1', orderId: 'ord3', customerEmail: 'b@example.com',
      items: [{ id: 'd1', name: 'Album (download)', qty: 1 }], shippingMethod: 'digital', shippingCost: 5,
    })
    expect(created[0].line_items.some(l => /Shipping/.test(l.price_data.product_data.name))).toBe(false)
  })
})

describe('onShippingRequestCreated', () => {
  it('asks for the full address before quoting (no Shippo call)', async () => {
    const admin = (await import('firebase-admin')).default
    const fns = await import('../functions/index.js')
    const ref = admin.firestore().collection('shippingRequests').doc()
    const data = { action: 'quote', kind: 'cd', config: { qty: 10, packaging: 'slim' }, address: { name: 'X' }, uid: 'u1', status: 'pending' }
    await ref.set(data)
    await fns.onShippingRequestCreated.run({ data: () => data, ref }, { params: { id: ref.id } })
    expect((await ref.get()).data()).toMatchObject({ status: 'error', error: 'Please fill in the full shipping address.' })
  })

  it('refuses to buy a label for a non-admin', async () => {
    const admin = (await import('firebase-admin')).default
    const fns = await import('../functions/index.js')
    const ref = admin.firestore().collection('shippingRequests').doc()
    const data = { action: 'buy_label', kind: 'cd', orderId: 'x', uid: 'someone', status: 'pending' }
    await ref.set(data)
    await fns.onShippingRequestCreated.run({ data: () => data, ref }, { params: { id: ref.id } })
    expect((await ref.get()).data()).toMatchObject({ status: 'error', error: 'Admins only.' })
  })
})

describe('firestore.rules — shippingRequests', () => {
  let testEnv
  beforeAll(async () => {
    const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':')
    testEnv = await initializeTestEnvironment({
      projectId: 'art-saturated-ship-rules-test',
      firestore: { rules: readFileSync(resolve(root, 'firestore.rules'), 'utf8'), host, port: Number(port) },
    })
  })
  afterAll(async () => { await testEnv?.cleanup() })
  beforeEach(async () => { await testEnv.clearFirestore() })

  const buyer = () => testEnv.authenticatedContext('buyer1', { email: 'b@example.com' }).firestore()
  const owner = () => testEnv.authenticatedContext('ownerUid', { email: 'zionomari@artsaturated.com' }).firestore()
  const Q = { uid: 'buyer1', action: 'order_rates', status: 'pending' }

  it('lets a customer ask for a quote, but not order rates or labels, and never forge a reply', async () => {
    await assertSucceeds(setDoc(doc(buyer(), 'shippingRequests/q'), { ...Q, action: 'quote' }))
    await assertFails(setDoc(doc(buyer(), 'shippingRequests/q2'), { ...Q, action: 'quote', uid: 'someoneElse' }))
    await assertFails(setDoc(doc(buyer(), 'shippingRequests/a'), Q))
    await assertFails(setDoc(doc(buyer(), 'shippingRequests/b'), { ...Q, action: 'buy_label' }))
    await assertFails(setDoc(doc(buyer(), 'shippingRequests/c'), { ...Q, result: { rates: [] } }))
    await assertFails(setDoc(doc(buyer(), 'shippingRequests/d'), { ...Q, status: 'ready' }))
  })

  it('lets the owner request labels', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'shippingRequests/e'), { uid: 'ownerUid', action: 'buy_label', status: 'pending' }))
  })
})

// ── Test press promo ─────────────────────────────────────────────────────────
describe('test press promo', () => {
  const hash = code => createHash('sha256').update(normalizePromoCode(code)).digest('hex')
  const promo = findPromoByHash(hash('TESTPRESS'))

  it('matches the code case- and space-insensitively, and nothing else', () => {
    expect(promo?.id).toBe('testpress')
    expect(findPromoByHash(hash('  testpress '))?.id).toBe('testpress')
    expect(findPromoByHash(hash('TESTPRES'))).toBeNull()
    // The code itself never appears in the price table.
    expect(JSON.stringify(CD_PROMOS)).not.toMatch(/TESTPRESS"/)
  })

  it('prices 25–50 disc-only at $2 all-in: no setup fee, tax included, plus the shipping rate', () => {
    for (const qty of [25, 40, 50]) {
      const p = priceCdOrder({ qty, packaging: 'sleeve' }, { promo, shippingCents: 900 })
      expect(p.promoId).toBe('testpress')
      expect(p.setupFee).toBe(0)
      expect(p.tax).toBe(0)
      expect(p.total).toBe(qty * 200 + 900)
      expect(p.isDeposit).toBe(false)   // 50 discs still pays in full
      expect(p.taxIncluded).toBe(Math.round(qty * 200 - (qty * 200) / 1.07))
    }
  })

  it('does not apply outside 25–50, to cases, with rush, or on a reorder', () => {
    expect(priceCdOrder({ qty: 24, packaging: 'sleeve' }, { promo }).promoId).toBeUndefined()
    expect(priceCdOrder({ qty: 51, packaging: 'sleeve' }, { promo }).promoId).toBeUndefined()
    expect(priceCdOrder({ qty: 30, packaging: 'jewel' }, { promo }).promoId).toBeUndefined()
    expect(promoProblem(promo, { qty: 30, packaging: 'slim' })).toMatch(/disc only/)
    const rushed = priceCdOrder({ qty: 30, packaging: 'sleeve', rush: true }, { promo })
    expect(rushed.rushFee).toBe(0)
    expect(rushed.config.rush).toBe(false)
    expect(priceCdOrder({ qty: 30, packaging: 'sleeve' }, { promo, reorderRate: 200 }).promoId).toBeUndefined()
  })
})

describe('onCheckoutRequestCreated — test press promo', () => {
  let admin, db, fns, created

  beforeAll(async () => {
    admin = (await import('firebase-admin')).default
    fns = await import('../functions/index.js')
    db = admin.firestore()
    fns.__setStripeStub({
      checkout: { sessions: {
        create: async (params) => { created.push(params); return { id: 'cs_stub', url: 'https://stripe.test/pay' } },
        listLineItems: async () => ({ data: [] }),
      } },
    })
  })

  beforeEach(async () => {
    created = []
    for (const name of ['quoteRequests', 'checkoutRequests', 'shippingRequests']) {
      const snap = await db.collection(name).get()
      await Promise.all(snap.docs.map(d => d.ref.delete()))
    }
  })

  async function order(extra) {
    await seedQuote(db, { kind: 'cd', qty: extra.qty ?? 30, packaging: extra.packaging ?? 'sleeve' })
    await db.doc('quoteRequests/tp1').set({
      uid: 'u1', email: 'band@example.com', name: 'Band', qty: 30, packaging: 'sleeve',
      status: 'pending_payment', paymentStatus: 'unpaid', ...SHIP, ...extra,
    })
    const ref = db.collection('checkoutRequests').doc()
    const data = { type: 'cd_order', orderId: 'tp1', uid: 'u1' }
    await ref.set(data)
    await fns.onCheckoutRequestCreated.run({ data: () => data, ref }, { params: { docId: ref.id } })
    return (await ref.get()).data()
  }

  it('charges $2 a disc with no setup or tax lines, plus the shipping rate', async () => {
    expect((await order({ promoCode: 'testpress' })).status).toBe('ready')
    const names = created[0].line_items.map(l => l.price_data.product_data.name)
    expect(names).not.toContain('Setup fee')
    expect(names).not.toContain('Indiana sales tax')
    expect(names[0]).toMatch(/Test press — setup & sales tax included/)
    const discs = created[0].line_items[0]
    expect(discs.price_data.unit_amount).toBe(200)
    expect(discs.quantity).toBe(30)
    const total = created[0].line_items.reduce((t, l) => t + l.price_data.unit_amount * l.quantity, 0)
    expect(total).toBe(30 * 200 + 1234)
    const o = (await db.doc('quoteRequests/tp1').get()).data()
    expect(o).toMatchObject({ promoId: 'testpress', totalCents: 7234, perDiscCents: 200 })
  })

  it('refuses a bad code or an order the promo does not cover', async () => {
    expect((await order({ promoCode: 'FREECDS' })).status).toBe('error')
    expect((await order({ promoCode: 'TESTPRESS', qty: 80 })).status).toBe('error')
    expect((await order({ promoCode: 'TESTPRESS', packaging: 'jewel' })).status).toBe('error')
    expect(created).toHaveLength(0)
  })
})

// ── Artists ship their own pieces ────────────────────────────────────────────
describe('artist shipping', () => {
  let admin, db, fns, created, sentMail

  beforeAll(async () => {
    admin = (await import('firebase-admin')).default
    fns = await import('../functions/index.js')
    db = admin.firestore()
    sentMail = fns.__sentMail
    fns.__setStripeStub({
      checkout: { sessions: {
        create: async (params) => { created.push(params); return { id: 'cs_stub', url: 'https://stripe.test/pay' } },
        listLineItems: async () => ({ data: [] }),
      } },
    })
  })

  beforeEach(async () => {
    created = []
    sentMail.length = 0
    for (const name of ['orders', 'products', 'checkoutRequests', 'shippingRequests', 'stripeSessions', 'users']) {
      const snap = await db.collection(name).get()
      await Promise.all(snap.docs.map(d => d.ref.delete()))
    }
  })

  it('ships owner-listed work from the store and seller uploads from the artist', async () => {
    const { originOf } = await import('../functions/shippingCalc.mjs')
    expect(originOf({ source: 'admin_form', artistUid: 'amira' })).toBe('store')
    expect(originOf({ source: 'seller_upload', sellerId: 'amira' })).toBe('amira')
    expect(originOf({})).toBe('store')
  })

  it('splits a mixed cart into store and artist shipments and lets the artist read the order', async () => {
    await db.doc('products/s1').set({ name: 'Store LP', price: 10, category: 'Physical Media', source: 'admin_form' })
    await db.doc('products/a1').set({ name: 'Amira print', price: 40, category: 'Art', source: 'seller_upload', sellerId: 'amira' })
    await db.doc('orders/m1').set({ uid: 'u1', status: 'pending', paymentStatus: 'pending' })
    const parts = [
      { origin: 'store', objectId: 'r_s', carrier: 'USPS', service: 'Ground Advantage', token: 'usps_ground_advantage', amountCents: 600 },
      { origin: 'amira', objectId: 'r_a', carrier: 'USPS', service: 'Ground Advantage', token: 'usps_ground_advantage', amountCents: 700 },
    ]
    await db.doc('shippingRequests/sq').set({
      uid: 'u1', action: 'quote', status: 'ready', address: SHIP_TO,
      result: {
        kind: 'cart', itemsKey: 'a1×1,s1×1',
        groups: [{ origin: 'store', itemIds: ['s1'] }, { origin: 'amira', itemIds: ['a1'] }],
        rates: [{ objectId: 'combo:USPS|usps_ground_advantage', carrier: 'USPS', service: 'Ground Advantage', token: 'usps_ground_advantage', amountCents: 1300, parts }],
      },
    })
    const ref = db.collection('checkoutRequests').doc()
    const data = { type: 'order', uid: 'u1', orderId: 'm1', customerEmail: 'b@example.com',
      items: [{ id: 's1', qty: 1 }, { id: 'a1', qty: 1 }], shippingMethod: 'ship',
      shippingQuoteId: 'sq', shippingRateId: 'combo:USPS|usps_ground_advantage' }
    await ref.set(data)
    await fns.onCheckoutRequestCreated.run({ data: () => data, ref }, { params: { docId: ref.id } })
    expect((await ref.get()).data().status).toBe('ready')

    const o = (await db.doc('orders/m1').get()).data()
    expect(o.sellerIds).toEqual(['amira'])
    expect(o.shipments.map(s => [s.from, s.itemIds, s.amountCents])).toEqual([['store', ['s1'], 600], ['amira', ['a1'], 700]])
    expect(created[0].line_items.find(l => /^Shipping/.test(l.price_data.product_data.name)).price_data.unit_amount).toBe(1300)
  })

  it('emails the artist what to ship once the order is paid', async () => {
    await db.doc('users/amira').set({ email: 'amira@example.com', name: 'Amira' })
    const order = {
      uid: 'u1', email: 'b@example.com', name: 'Buyer', total: 53, status: 'pending', paymentStatus: 'paid',
      items: [{ id: 's1', name: 'Store LP', price: 10, qty: 1 }, { id: 'a1', name: 'Amira print', price: 40, qty: 1 }],
      shippingAddress: SHIP_TO,
      shipments: [
        { from: 'store', itemIds: ['s1'], carrier: 'USPS', service: 'Ground Advantage', status: 'pending' },
        { from: 'amira', itemIds: ['a1'], carrier: 'USPS', service: 'Ground Advantage', status: 'pending' },
      ],
    }
    await fns.notifyOrderPaid('m2', order)
    const toArtist = sentMail.find(m => m.to === 'amira@example.com')
    expect(toArtist).toBeTruthy()
    expect(toArtist.text).toMatch(/Amira print/)
    expect(toArtist.text).not.toMatch(/Store LP/)
    expect(toArtist.text).toMatch(/1 Main St/)
    // ...and nothing to an artist on an unpaid deposit
    sentMail.length = 0
    await fns.notifyOrderPaid('m2', { ...order, paymentStatus: 'deposit_paid' })
    expect(sentMail.some(m => m.to === 'amira@example.com')).toBe(false)
  })

  async function artistLabel(orderId, uid) {
    const ref = db.collection('shippingRequests').doc()
    const data = { action: 'buy_label', kind: 'artist', orderId, uid, status: 'pending' }
    await ref.set(data)
    await fns.onShippingRequestCreated.run({ data: () => data, ref }, { params: { id: ref.id } })
    return (await ref.get()).data()
  }

  it("won't buy an artist label for someone else's package, an unpaid order, or without a return address", async () => {
    await db.doc('orders/m3').set({
      uid: 'u1', email: 'b@example.com', paymentStatus: 'pending', shippingAddress: SHIP_TO,
      items: [{ id: 'a1', name: 'Amira print', qty: 1 }],
      shipments: [{ from: 'amira', itemIds: ['a1'], carrier: 'USPS', token: 'usps_ground_advantage', status: 'pending' }],
    })
    expect(await artistLabel('m3', 'someoneElse')).toMatchObject({ status: 'error', error: 'None of this order ships from you.' })
    expect((await artistLabel('m3', 'amira')).error).toMatch(/hasn't been paid/)
    await db.doc('orders/m3').update({ paymentStatus: 'paid' })
    expect((await artistLabel('m3', 'amira')).error).toMatch(/return address/)
  })
})

describe('firestore.rules — artist shipping', () => {
  let testEnv
  beforeAll(async () => {
    const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':')
    testEnv = await initializeTestEnvironment({
      projectId: 'art-saturated-artist-ship-test',
      firestore: { rules: readFileSync(resolve(root, 'firestore.rules'), 'utf8'), host, port: Number(port) },
    })
  })
  afterAll(async () => { await testEnv?.cleanup() })
  beforeEach(async () => { await testEnv.clearFirestore() })

  const as = uid => testEnv.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore()

  it('keeps an artist return address private to them', async () => {
    await assertSucceeds(setDoc(doc(as('amira'), 'users/amira/private/shipping'), { shipFrom: SHIP_TO }))
    await assertSucceeds(getDoc(doc(as('amira'), 'users/amira/private/shipping')))
    await assertFails(getDoc(doc(as('stranger'), 'users/amira/private/shipping')))
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'users/amira/private/shipping')))
  })

  it('lets an artist on sellerIds read the order, but nobody else', async () => {
    await testEnv.withSecurityRulesDisabled(ctx => setDoc(doc(ctx.firestore(), 'orders/o'), { uid: 'buyer', sellerIds: ['amira'] }))
    await assertSucceeds(getDoc(doc(as('amira'), 'orders/o')))
    await assertFails(getDoc(doc(as('stranger'), 'orders/o')))
  })

  it('lets a signed-in user request an artist label for themselves (the function checks ownership), nothing else', async () => {
    await assertSucceeds(setDoc(doc(as('amira'), 'shippingRequests/a'), { uid: 'amira', action: 'buy_label', kind: 'artist', orderId: 'o', status: 'pending' }))
    await assertFails(setDoc(doc(as('amira'), 'shippingRequests/b'), { uid: 'amira', action: 'buy_label', kind: 'order', orderId: 'o', status: 'pending' }))
    await assertFails(setDoc(doc(as('amira'), 'shippingRequests/c'), { uid: 'someoneElse', action: 'buy_label', kind: 'artist', orderId: 'o', status: 'pending' }))
  })
})
