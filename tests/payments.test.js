/**
 * Settlement path tests — the code that turns a Stripe payment into a fulfilled
 * order. This is the logic that had never run against a real payment.
 *
 * Runs against the Firestore emulator ONLY (see the `test` script). The functions
 * emulator is deliberately not started: it would load functions/.env with live
 * Stripe and Gmail credentials and fire real triggers on these writes.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest'

// functions/index.js is CommonJS, so module mocks can't reach its `require`
// calls. It exposes test seams instead (inert unless FUNCTIONS_TEST is set):
// __sentMail captures email, __setStripeStub replaces the Stripe client.
const stripeLineItems = []
let admin, db, handlePaidSession, notifyOrderPaid, sentMail

beforeAll(async () => {
  admin = (await import('firebase-admin')).default
  const fns = await import('../functions/index.js')
  handlePaidSession = fns.handlePaidSession
  notifyOrderPaid   = fns.notifyOrderPaid
  sentMail          = fns.__sentMail

  fns.__setStripeStub({
    checkout: { sessions: { listLineItems: async () => ({ data: stripeLineItems }) } },
  })

  db = admin.firestore()
})

// Emulator state persists across tests; wipe the collections we touch.
async function wipe(...names) {
  for (const name of names) {
    const snap = await db.collection(name).get()
    await Promise.all(snap.docs.map(d => d.ref.delete()))
  }
}

beforeEach(async () => {
  sentMail.length = 0
  stripeLineItems.length = 0
  await wipe('orders', 'products', 'stripeSessions', 'orphanedPayments', 'submissions', 'blogSubmissions')
})

// Minimal shape of a Stripe Checkout Session as handlePaidSession reads it.
function session(overrides = {}) {
  return {
    id: 'cs_test_' + Math.random().toString(36).slice(2, 10),
    payment_status: 'paid',
    amount_total: 2140,
    customer_details: { email: 'buyer@example.com', name: 'Test Buyer' },
    metadata: {},
    ...overrides,
  }
}

async function seedOrder(orderId, items, extra = {}) {
  await db.doc(`orders/${orderId}`).set({
    uid: 'user123',
    email: 'buyer@example.com',
    name: 'Test Buyer',
    items,
    total: 21.4,
    status: 'pending',
    paymentStatus: 'pending',
    ...extra,
  })
}

describe('handlePaidSession — settlement', () => {
  it('ignores a session that has not actually been paid', async () => {
    await seedOrder('order1', [{ id: 'prod1', name: 'Thing', qty: 1, price: 10 }])
    await db.doc('products/prod1').set({ name: 'Thing', price: 10, stock: 5 })

    await handlePaidSession(session({
      payment_status: 'unpaid',
      metadata: { type: 'order', orderId: 'order1' },
    }))

    const order = (await db.doc('orders/order1').get()).data()
    expect(order.paymentStatus).toBe('pending')
    const prod = (await db.doc('products/prod1').get()).data()
    expect(prod.stock).toBe(5)
    expect((await db.collection('stripeSessions').get()).size).toBe(0)
  })

  it('marks the order paid and decrements stock', async () => {
    await seedOrder('order2', [{ id: 'prod2', name: 'Vinyl', qty: 2, price: 10 }])
    await db.doc('products/prod2').set({ name: 'Vinyl', price: 10, stock: 5 })

    await handlePaidSession(session({ metadata: { type: 'order', orderId: 'order2' } }))

    const order = (await db.doc('orders/order2').get()).data()
    expect(order.paymentStatus).toBe('paid')
    expect(order.paidAt).toBeTruthy()

    const prod = (await db.doc('products/prod2').get()).data()
    expect(prod.stock).toBe(3)
    expect(prod.sold).toBeFalsy()
  })

  it('marks a product sold when stock reaches zero', async () => {
    await seedOrder('order3', [{ id: 'prod3', name: 'Last One', qty: 1, price: 10 }])
    await db.doc('products/prod3').set({ name: 'Last One', price: 10, stock: 1 })

    await handlePaidSession(session({ metadata: { type: 'order', orderId: 'order3' } }))

    const prod = (await db.doc('products/prod3').get()).data()
    expect(prod.stock).toBe(0)
    expect(prod.sold).toBe(true)
  })

  it('decrements stock only once when the same session is delivered twice', async () => {
    // The reconciler re-scans a rolling window, so duplicate delivery is routine,
    // not an edge case. Double-decrementing here would silently destroy inventory.
    await seedOrder('order4', [{ id: 'prod4', name: 'Print', qty: 1, price: 10 }])
    await db.doc('products/prod4').set({ name: 'Print', price: 10, stock: 5 })

    const s = session({ metadata: { type: 'order', orderId: 'order4' } })
    await handlePaidSession(s)
    await handlePaidSession(s)
    await handlePaidSession(s)

    const prod = (await db.doc('products/prod4').get()).data()
    expect(prod.stock).toBe(4)
    expect((await db.collection('stripeSessions').get()).size).toBe(1)
  })

  it('records an off-site Payment Link sale and alerts the owner', async () => {
    // The Jennifer Paschall case: paid via Payment Link, no metadata, so every
    // branch used to skip it and the sale left no trace on the site.
    stripeLineItems.push({ description: 'Tree of Life Planter ( Small )', quantity: 1, amount_total: 1000 })

    const s = session({
      metadata: {},
      payment_link: 'plink_test123',
      amount_total: 2000,
      customer_details: { email: 'keystone@example.com', name: 'Jennifer P' },
      shipping_details: { address: { line1: '2680 Shepard Drive', city: 'Humboldt', state: 'TN', postal_code: '38343' } },
    })
    await handlePaidSession(s)

    const orphan = (await db.doc(`orphanedPayments/${s.id}`).get()).data()
    expect(orphan).toBeTruthy()
    expect(orphan.source).toBe('payment_link')
    expect(orphan.amount).toBe(20)
    expect(orphan.fulfilled).toBe(false)
    expect(orphan.items[0]).toContain('Tree of Life Planter')
    expect(orphan.shippingAddress.city).toBe('Humboldt')

    const alert = sentMail.find(m => m.subject.includes('outside the shop'))
    expect(alert).toBeTruthy()
    expect(alert.to).toBe('zionomari@artsaturated.com')
    expect(alert.text).toContain('Humboldt')
  })

  it('flags a paid session whose order document is missing', async () => {
    const s = session({ metadata: { type: 'order', orderId: 'does-not-exist' } })
    await handlePaidSession(s)

    const orphan = (await db.doc(`orphanedPayments/${s.id}`).get()).data()
    expect(orphan).toBeTruthy()
    expect(orphan.orderId).toBe('does-not-exist')

    const alert = sentMail.find(m => m.subject.includes('no record'))
    expect(alert).toBeTruthy()
    expect(alert.to).toBe('zionomari@artsaturated.com')
  })

  it('treats a payment through the retired $1 listing-fee link as an orphan', async () => {
    // The $1 art-listing fee is gone. A payment arriving through the old Payment
    // Link must NOT quietly mark a submission paid — it has to surface so the
    // shop can refund it. This pins that contract: re-adding 'listing_fee' to
    // KNOWN_TYPES without a settlement branch would silently swallow the money.
    await db.doc('submissions/sub1').set({ uid: 'u1', title: 'Art', status: 'pending_payment' })

    const s = session({
      metadata: {},
      client_reference_id: 'sub1',
      payment_link: 'plink_retired',
      amount_total: 100,
    })
    await handlePaidSession(s)

    const sub = (await db.doc('submissions/sub1').get()).data()
    expect(sub.status).toBe('pending_payment')      // untouched
    expect(sub.listingFeePaid).toBeUndefined()

    const orphan = (await db.doc(`orphanedPayments/${s.id}`).get()).data()
    expect(orphan).toBeTruthy()
    expect(orphan.amount).toBe(1)
    expect(sentMail.some(m => m.to === 'zionomari@artsaturated.com' && m.subject.includes('outside the shop'))).toBe(true)
  })

  it('still resolves a magazine article fee from client_reference_id', async () => {
    // The blog fee shares the inference path and must keep working.
    await db.doc('blogSubmissions/blog1').set({ title: 'Piece', status: 'pending_payment' })

    await handlePaidSession(session({ metadata: {}, client_reference_id: 'blog1' }))

    const blog = (await db.doc('blogSubmissions/blog1').get()).data()
    expect(blog.feePaid).toBe(true)
    expect(blog.status).toBe('pending_review')
    expect((await db.collection('orphanedPayments').get()).size).toBe(0)
  })
})

describe('notifyOrderPaid — customer and owner email', () => {
  it('sends a confirmation to the buyer and an alert to the owner', async () => {
    await notifyOrderPaid('abc123def456', {
      email: 'buyer@example.com',
      name: 'Test Buyer',
      items: [{ name: 'Vinyl', qty: 1, price: 10 }],
      total: 21.4,
      paymentStatus: 'paid',
      shippingMethod: 'ship',
    })

    expect(sentMail).toHaveLength(2)

    const buyer = sentMail.find(m => m.to === 'buyer@example.com')
    expect(buyer.subject).toContain('Order Confirmed')
    expect(buyer.text).toContain('Vinyl')

    const owner = sentMail.find(m => m.to === 'zionomari@artsaturated.com')
    expect(owner.subject).toContain('Ship Required')
    // The mailbox that does not exist must never appear as a recipient again.
    expect(sentMail.some(m => m.to === 'orders@artsaturated.com')).toBe(false)
  })

  it('tells pickup buyers about pickup, not delivery', async () => {
    await notifyOrderPaid('abc123def456', {
      email: 'buyer@example.com',
      name: 'Test Buyer',
      items: [{ name: 'Vinyl', qty: 1, price: 10 }],
      total: 10,
      paymentStatus: 'paid',
      shippingMethod: 'pickup',
    })

    const buyer = sentMail.find(m => m.to === 'buyer@example.com')
    expect(buyer.text).toContain('pickup')
    expect(buyer.text).not.toContain('Estimated delivery')
  })
})
