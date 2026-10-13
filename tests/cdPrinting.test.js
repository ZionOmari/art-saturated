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
import { CD_PRICING, priceCdOrder, normalizeCdConfig, reorderWindow } from '../functions/cdPricing.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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

  it('adds gloss at $0.25 per cover', () => {
    const plain = priceCdOrder({ qty: 1, packaging: 'jewel' }).perDisc
    expect(priceCdOrder({ qty: 1, packaging: 'jewel', gloss: true }).perDisc - plain).toBe(25)
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

  it('ships every order (online only — a pickup request is ignored)', () => {
    const p = priceCdOrder({ qty: 10, packaging: 'slim', delivery: 'pickup' })
    expect(p.config.delivery).toBe('ship')
    expect(p.shipping).toBe(CD_PRICING.shippingFlat)
  })

  it('ignores cover options on a disc-only order', () => {
    const plain = priceCdOrder({ qty: 5, packaging: 'sleeve' })
    const noisy = priceCdOrder({ qty: 5, packaging: 'sleeve', stock: 'cardstock', gloss: true, panelCount: 4, removeCredit: true })
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
    for (const name of ['quoteRequests', 'checkoutRequests']) {
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
    await db.doc('quoteRequests/re1').set({
      uid: 'u1', email: 'band@example.com', qty: 20, packaging: 'jewel', delivery: 'pickup',
      reorderOf: 'src', status: 'pending_payment', paymentStatus: 'unpaid',
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
    await db.doc('quoteRequests/re2').set({
      uid: 'u1', email: 'band@example.com', qty: 20, packaging: 'sleeve', delivery: 'pickup',
      reorderOf: 'src', status: 'pending_payment', paymentStatus: 'unpaid',
    })
    const req = await runCheckout('re2')
    expect(req.status).toBe('error')
    expect(created).toHaveLength(0)
  })

  it("refuses a reorder of someone else's project", async () => {
    await seedSource(30, { uid: 'someoneElse' })
    await db.doc('quoteRequests/re3').set({
      uid: 'u1', email: 'band@example.com', qty: 20, packaging: 'sleeve', delivery: 'pickup',
      reorderOf: 'src', status: 'pending_payment', paymentStatus: 'unpaid',
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

describe('onCheckoutRequestCreated — flat shipping', () => {
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
    for (const name of ['quoteRequests', 'checkoutRequests', 'orders', 'products']) {
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

  it('charges a CD order the flat US rate and has Stripe collect a US address', async () => {
    await db.doc('quoteRequests/o1').set({
      uid: 'u1', email: 'band@example.com', name: 'Band', qty: 200, packaging: 'jewel', panelCount: 4,
      delivery: 'ship', status: 'pending_payment', paymentStatus: 'unpaid',
    })
    expect((await run({ type: 'cd_order', orderId: 'o1', uid: 'u1' })).status).toBe('ready')
    const ship = created[0].line_items.find(l => /deposit/i.test(l.price_data.product_data.name))
    expect(ship).toBeTruthy()   // 200 discs → deposit order, single line
    const o = (await db.doc('quoteRequests/o1').get()).data()
    expect(o.totalCents).toBe(priceCdOrder({ qty: 200, packaging: 'jewel', panelCount: 4, delivery: 'ship' }).total)
    expect(created[0].shipping_address_collection).toEqual({ allowed_countries: ['US'] })
  })

  it('charges a shop order $5 shipping no matter what the browser sends', async () => {
    await db.doc('products/p1').set({ name: 'Enigma', price: 15, category: 'Physical Media' })
    await db.doc('orders/ord1').set({ uid: 'u1', status: 'pending', paymentStatus: 'pending' })
    await run({
      type: 'order', uid: 'u1', orderId: 'ord1', customerEmail: 'b@example.com',
      items: [{ id: 'p1', name: 'Enigma', price: 1, qty: 1 }],
      shippingMethod: 'ship', shippingCost: 0, taxAmount: 1.05,
    })
    const lines = created[0].line_items
    expect(lines.find(l => l.price_data.product_data.name === 'Enigma').price_data.unit_amount).toBe(1500)
    expect(lines.find(l => /Shipping/.test(l.price_data.product_data.name)).price_data.unit_amount).toBe(500)
  })

  it('still charges shipping on a physical order that claims pickup (online only)', async () => {
    await db.doc('products/p1').set({ name: 'Enigma', price: 15, category: 'Physical Media' })
    await db.doc('orders/ord2').set({ uid: 'u1', status: 'pending', paymentStatus: 'pending' })
    await run({
      type: 'order', uid: 'u1', orderId: 'ord2', customerEmail: 'b@example.com',
      items: [{ id: 'p1', name: 'Enigma', qty: 1 }], shippingMethod: 'pickup', shippingCost: 0,
    })
    expect(created[0].line_items.find(l => /Shipping/.test(l.price_data.product_data.name)).price_data.unit_amount).toBe(500)
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

  it('does not let a customer request rates or labels, or forge a reply', async () => {
    await assertFails(setDoc(doc(buyer(), 'shippingRequests/a'), Q))
    await assertFails(setDoc(doc(buyer(), 'shippingRequests/b'), { ...Q, action: 'buy_label' }))
    await assertFails(setDoc(doc(buyer(), 'shippingRequests/c'), { ...Q, result: { rates: [] } }))
    await assertFails(setDoc(doc(buyer(), 'shippingRequests/d'), { ...Q, status: 'ready' }))
  })

  it('lets the owner request labels', async () => {
    await assertSucceeds(setDoc(doc(owner(), 'shippingRequests/e'), { uid: 'ownerUid', action: 'buy_label', status: 'pending' }))
  })
})
