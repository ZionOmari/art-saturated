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

  it('blocks uploading without an active membership', async () => {
    await seed('users/buyer1', { ...ARTIST, artistSubActive: false })
    await assertFails(setDoc(doc(buyer(), 'submissions/s1'), {
      uid: 'buyer1', title: 'Untitled', status: 'pending_review',
    }))
  })

  it('allows uploading with an active membership', async () => {
    await seed('users/buyer1', { ...ARTIST, artistSubActive: true })
    await assertSucceeds(setDoc(doc(buyer(), 'submissions/s2'), {
      uid: 'buyer1', title: 'Untitled', status: 'pending_review',
    }))
  })

  it('stops a member uploading work under someone else\'s uid', async () => {
    await seed('users/buyer1', { ...ARTIST, artistSubActive: true })
    await assertFails(setDoc(doc(buyer(), 'submissions/s3'), {
      uid: 'someone-else', title: 'Untitled', status: 'pending_review',
    }))
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
