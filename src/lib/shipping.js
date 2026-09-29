import { addDoc, collection, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { db, auth } from './firebase'

/**
 * Shippo work goes through Firestore, like checkout: callables return 403 on
 * this project. Writes a shippingRequests doc and resolves with the function's
 * `result`, plus the request id (a CD order cites its quote by id).
 */
export function shippingRequest(payload) {
  return new Promise(async (resolve, reject) => {
    const uid = auth.currentUser?.uid
    if (!uid) return reject(new Error('Please sign in first.'))

    let ref
    try {
      ref = await addDoc(collection(db, 'shippingRequests'), {
        ...payload, uid, status: 'pending', createdAt: serverTimestamp(),
      })
    } catch (err) {
      return reject(new Error('Could not reach shipping: ' + (err.code || err.message)))
    }

    const timer = setTimeout(() => { unsub(); reject(new Error('Shipping took too long to respond. Try again.')) }, 90000)
    const unsub = onSnapshot(ref, snap => {
      const d = snap.data()
      if (d?.status === 'ready') { clearTimeout(timer); unsub(); resolve({ id: ref.id, ...d.result }) }
      if (d?.status === 'error') { clearTimeout(timer); unsub(); reject(new Error(d.error || 'Shipping request failed.')) }
    })
  })
}

// Admin: rates for a shop order (same shape the old callable returned).
export async function getShopOrderRates(orderId) {
  return (await shippingRequest({ action: 'order_rates', orderId })).rates
}
