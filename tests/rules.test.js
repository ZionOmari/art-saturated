/**
 * firestore.rules tests — the security boundary around money.
 *
 * These rules do real work now: a buyer must not be able to mark their own order
 * paid, and the idempotency locks the reconciler depends on must be unwritable
 * from any client.
 */
import { describe, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc } from 'firebase/firestore'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OWNER = 'zionomari@artsaturated.com'

let testEnv

beforeAll(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':')
  testEnv = await initializeTestEnvironment({
    projectId: 'art-saturated-rules-test',
    firestore: {
      rules: readFileSync(resolve(root, 'firestore.rules'), 'utf8'),
      host,
      port: Number(port),
    },
  })
})

afterAll(async () => { await testEnv?.cleanup() })
beforeEach(async () => { await testEnv.clearFirestore() })

const buyer  = () => testEnv.authenticatedContext('buyer1', { email: 'buyer@example.com' }).firestore()
const seller = () => testEnv.authenticatedContext('seller1', { email: 'seller@example.com' }).firestore()
const owner  = () => testEnv.authenticatedContext('ownerUid', { email: OWNER }).firestore()
const anon   = () => testEnv.unauthenticatedContext().firestore()

const ORDER = {
  uid: 'buyer1',
  email: 'buyer@example.com',
  items: [{ id: 'p1', name: 'Thing', qty: 1, price: 10 }],
  total: 10,
  status: 'pending',
  paymentStatus: 'pending',
}

async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), path), data)
  })
}

describe('orders', () => {
  it('lets a buyer create their own unpaid order', async () => {
    await assertSucceeds(setDoc(doc(buyer(), 'orders/o1'), ORDER))
  })

  it('blocks creating an order that claims to be already paid', async () => {
    await assertFails(setDoc(doc(buyer(), 'orders/o2'), { ...ORDER, paymentStatus: 'paid' }))
  })

  it('blocks creating an order in another user\'s name', async () => {
    await assertFails(setDoc(doc(buyer(), 'orders/o3'), { ...ORDER, uid: 'someone-else' }))
  })

  it('lets a buyer read their own order but not a stranger\'s', async () => {
    await seed('orders/o4', ORDER)
    await assertSucceeds(getDoc(doc(buyer(), 'orders/o4')))
    await assertFails(getDoc(doc(seller(), 'orders/o4')))
    await assertFails(getDoc(doc(anon(), 'orders/o4')))
  })

  it('lets the tagged seller read the order', async () => {
    await seed('orders/o5', { ...ORDER, sellerId: 'seller1' })
    await assertSucceeds(getDoc(doc(seller(), 'orders/o5')))
  })

  it('stops a buyer marking their own order paid', async () => {
    // The whole payment model rests on this: only the server may set 'paid'.
    await seed('orders/o6', ORDER)
    await assertFails(updateDoc(doc(buyer(), 'orders/o6'), { paymentStatus: 'paid' }))
  })

  it('stops a buyer deleting or cancelling an order', async () => {
    await seed('orders/o7', ORDER)
    await assertFails(updateDoc(doc(buyer(), 'orders/o7'), { status: 'cancelled' }))
    await assertFails(deleteDoc(doc(buyer(), 'orders/o7')))
  })

  it('lets the owner read, update and delete any order', async () => {
    await seed('orders/o8', ORDER)
    await assertSucceeds(getDoc(doc(owner(), 'orders/o8')))
    await assertSucceeds(updateDoc(doc(owner(), 'orders/o8'), { status: 'shipped' }))
    await assertSucceeds(deleteDoc(doc(owner(), 'orders/o8')))
  })
})

describe('order messages (buyer ↔ shop)', () => {
  const MSG = { text: 'Where is my package?', senderUid: 'buyer1', senderName: 'Test Buyer', role: 'buyer' }

  it('lets the order owner send and read messages', async () => {
    await seed('orders/o10', ORDER)
    await assertSucceeds(setDoc(doc(buyer(), 'orders/o10/messages/m1'), MSG))
    await assertSucceeds(getDoc(doc(buyer(), 'orders/o10/messages/m1')))
  })

  it('lets the shop reply on any order', async () => {
    await seed('orders/o11', ORDER)
    await assertSucceeds(setDoc(doc(owner(), 'orders/o11/messages/m1'), {
      ...MSG, senderUid: 'ownerUid', role: 'shop',
    }))
  })

  it("blocks a stranger reading or writing someone else's order thread", async () => {
    await seed('orders/o12', ORDER)
    await seed('orders/o12/messages/m1', MSG)
    await assertFails(getDoc(doc(seller(), 'orders/o12/messages/m1')))
    await assertFails(setDoc(doc(seller(), 'orders/o12/messages/m2'), { ...MSG, senderUid: 'seller1' }))
  })

  it('stops anyone forging a message as another sender', async () => {
    await seed('orders/o13', ORDER)
    await assertFails(setDoc(doc(buyer(), 'orders/o13/messages/m1'), { ...MSG, senderUid: 'someone-else' }))
  })

  it('makes sent messages immutable', async () => {
    // Neither side gets to rewrite what was said.
    await seed('orders/o14', ORDER)
    await seed('orders/o14/messages/m1', MSG)
    await assertFails(updateDoc(doc(buyer(), 'orders/o14/messages/m1'), { text: 'edited' }))
    await assertFails(updateDoc(doc(owner(), 'orders/o14/messages/m1'), { text: 'edited' }))
    await assertFails(deleteDoc(doc(owner(), 'orders/o14/messages/m1')))
  })
})

describe('payment bookkeeping collections', () => {
  it('makes stripeSessions locks unwritable by every client, including the owner', async () => {
    // Written only by Cloud Functions, which bypass rules entirely.
    await assertFails(setDoc(doc(buyer(), 'stripeSessions/cs_1'), { amount: 10 }))
    await assertFails(setDoc(doc(owner(), 'stripeSessions/cs_1'), { amount: 10 }))
  })

  it('lets only the owner read a stripeSessions lock', async () => {
    await seed('stripeSessions/cs_2', { amount: 10 })
    await assertSucceeds(getDoc(doc(owner(), 'stripeSessions/cs_2')))
    await assertFails(getDoc(doc(buyer(), 'stripeSessions/cs_2')))
  })

  it('keeps orphaned payments owner-only', async () => {
    await seed('orphanedPayments/cs_3', { amount: 20, email: 'x@example.com' })
    await assertSucceeds(getDoc(doc(owner(), 'orphanedPayments/cs_3')))
    await assertFails(getDoc(doc(buyer(), 'orphanedPayments/cs_3')))
    await assertFails(getDoc(doc(anon(), 'orphanedPayments/cs_3')))
  })
})

describe('artist membership', () => {
  const ARTIST = { name: 'Painter', email: 'buyer@example.com', artistPublic: true }

  it('stops an artist granting themselves a membership', async () => {
    // The entire $7.99 paywall rests on this one rule.
    await seed('users/buyer1', ARTIST)
    await assertFails(updateDoc(doc(buyer(), 'users/buyer1'), { artistSubActive: true }))
    await assertFails(updateDoc(doc(buyer(), 'users/buyer1'), { artistSubStatus: 'active' }))
  })

  it('stops a new user creating themselves an active membership', async () => {
    // The update rule blocked this; the create rule did not. A brand-new account
    // could be born with artistSubActive: true and upload free forever.
    await assertFails(setDoc(doc(buyer(), 'users/buyer1'), {
      ...ARTIST, artistSubActive: true,
    }))
    await assertFails(setDoc(doc(buyer(), 'users/buyer1'), {
      ...ARTIST, artistSubStatus: 'active', artistSubId: 'sub_forged',
    }))
  })

  it('still lets a new user create an ordinary profile', async () => {
    await assertSucceeds(setDoc(doc(buyer(), 'users/buyer1'), ARTIST))
  })

  it('still lets an artist edit their own ordinary profile fields', async () => {
    await seed('users/buyer1', ARTIST)
    await assertSucceeds(updateDoc(doc(buyer(), 'users/buyer1'), { artistBio: 'I paint.' }))
  })

  it('keeps the retired submissions collection closed to every client', async () => {
    // Uploads publish straight to products now (see 'seller listings'); the old
    // review queue is gone, so even a paid-up member can't write or read it.
    await seed('users/buyer1', { ...ARTIST, artistSubActive: true })
    await seed('submissions/old', { uid: 'buyer1', title: 'Untitled', status: 'approved' })
    await assertFails(setDoc(doc(buyer(), 'submissions/s2'), {
      uid: 'buyer1', title: 'Untitled', status: 'pending_review',
    }))
    await assertFails(getDoc(doc(buyer(), 'submissions/old')))
  })
})

describe('seller listings', () => {
  // Sellers publish straight to the shop with no approval step, so this rule is
  // the whole boundary between a paid membership and the live catalog.
  const MEMBER = { name: 'Painter', email: 'buyer@example.com', artistSubActive: true }

  const LISTING = {
    name: 'Untitled', slug: 'untitled-ab12', category: 'Art', listingType: 'art',
    medium: 'ink', dimensions: '8x11', year: 2026, price: 40, stock: 1,
    weightOz: 8, description: '', garmentType: '', sizes: [], unique: true,
    image: 'https://x/1.jpg', imageURL: 'https://x/1.jpg', imageURLs: ['https://x/1.jpg'],
    sellerId: 'buyer1', artistUid: 'buyer1', artistName: 'Painter', artistPayout: 40,
    source: 'seller_upload', moderation: 'unreviewed', active: true, inBucket: false,
    sold: false, itemNumber: 1, agreedToTerms: true, termsVersion: '2026-08-12',
  }

  it('lets a paid-up member publish their own listing', async () => {
    await seed('users/buyer1', MEMBER)
    await assertSucceeds(setDoc(doc(buyer(), 'products/p1'), LISTING))
  })

  it('blocks publishing without an active membership', async () => {
    await seed('users/buyer1', { ...MEMBER, artistSubActive: false })
    await assertFails(setDoc(doc(buyer(), 'products/p2'), LISTING))
  })

  it('blocks listing under someone else\'s name', async () => {
    await seed('users/buyer1', MEMBER)
    await assertFails(setDoc(doc(buyer(), 'products/p3'), { ...LISTING, sellerId: 'someone-else' }))
    await assertFails(setDoc(doc(buyer(), 'products/p4'), { ...LISTING, artistUid: 'someone-else' }))
  })

  it('blocks a free listing', async () => {
    // price 0 would be a live, purchasable, $0 product.
    await seed('users/buyer1', MEMBER)
    await assertFails(setDoc(doc(buyer(), 'products/p5'), { ...LISTING, price: 0 }))
    await assertFails(setDoc(doc(buyer(), 'products/p6'), { ...LISTING, price: '40' }))
  })

  it('blocks a seller attaching a paid download to their listing', async () => {
    // downloadPath names a file under releases/ that settlement signs and emails.
    // A seller who could set it could have anyone's release delivered to a buyer.
    await seed('users/buyer1', MEMBER)
    await assertFails(setDoc(doc(buyer(), 'products/p7'), {
      ...LISTING, downloadPath: 'releases/someone-elses-album/master.zip',
    }))
  })

  it('blocks a seller publishing pre-reviewed or pre-sold', async () => {
    await seed('users/buyer1', MEMBER)
    await assertFails(setDoc(doc(buyer(), 'products/p8'), { ...LISTING, moderation: 'ok' }))
    await assertFails(setDoc(doc(buyer(), 'products/p9'), { ...LISTING, sold: true }))
  })

  it('lets a seller edit their own listing but not its moderation state', async () => {
    await seed('users/buyer1', MEMBER)
    await seed('products/p10', LISTING)
    await assertSucceeds(updateDoc(doc(buyer(), 'products/p10'), { price: 55, description: 'Ink on paper.' }))
    await assertFails(updateDoc(doc(buyer(), 'products/p10'), { moderation: 'ok' }))
    await assertFails(updateDoc(doc(buyer(), 'products/p10'), { sellerId: 'someone-else' }))
    await assertFails(updateDoc(doc(buyer(), 'products/p10'), { price: 0 }))
  })

  it('stops a member editing somebody else\'s listing', async () => {
    await seed('users/seller1', { ...MEMBER, email: 'seller@example.com' })
    await seed('products/p11', LISTING)   // owned by buyer1
    await assertFails(updateDoc(doc(seller(), 'products/p11'), { price: 1 }))
  })

  it('keeps deletes owner-only — orders reference product ids', async () => {
    await seed('users/buyer1', MEMBER)
    await seed('products/p12', LISTING)
    await assertFails(deleteDoc(doc(buyer(), 'products/p12')))
    await assertSucceeds(deleteDoc(doc(owner(), 'products/p12')))
  })

  it('leaves the catalog publicly readable', async () => {
    await seed('products/p13', LISTING)
    await assertSucceeds(getDoc(doc(anon(), 'products/p13')))
  })
})

describe('listing reports', () => {
  const REPORT = { productId: 'p1', productName: 'Untitled', reason: 'Stolen photos', status: 'open' }

  it('lets anyone report a listing, signed in or not', async () => {
    await assertSucceeds(setDoc(doc(anon(),  'reports/r1'), REPORT))
    await assertSucceeds(setDoc(doc(buyer(), 'reports/r2'), REPORT))
  })

  it('blocks a report that files itself pre-resolved', async () => {
    await assertFails(setDoc(doc(anon(), 'reports/r3'), { ...REPORT, status: 'dismissed' }))
  })

  it('keeps reports readable by the owner only', async () => {
    await seed('reports/r4', REPORT)
    await assertSucceeds(getDoc(doc(owner(), 'reports/r4')))
    await assertFails(getDoc(doc(buyer(), 'reports/r4')))
    await assertFails(getDoc(doc(anon(),  'reports/r4')))
  })

  it('stops anyone erasing a report, including the owner', async () => {
    await seed('reports/r5', REPORT)
    await assertFails(deleteDoc(doc(buyer(), 'reports/r5')))
    await assertFails(deleteDoc(doc(owner(), 'reports/r5')))
    await assertSucceeds(updateDoc(doc(owner(), 'reports/r5'), { status: 'dismissed' }))
  })
})

describe('checkoutRequests', () => {
  it('lets a user create and read only their own checkout request', async () => {
    await assertSucceeds(setDoc(doc(buyer(), 'checkoutRequests/c1'), {
      uid: 'buyer1', type: 'order', status: 'pending',
    }))
    await seed('checkoutRequests/c2', { uid: 'someone-else', type: 'order' })
    await assertFails(getDoc(doc(buyer(), 'checkoutRequests/c2')))
  })

  it('blocks creating a checkout request under another uid', async () => {
    await assertFails(setDoc(doc(buyer(), 'checkoutRequests/c3'), { uid: 'victim' }))
  })
})
