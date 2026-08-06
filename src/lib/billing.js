import { addDoc, collection, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { db, auth } from './firebase'

/**
 * Membership self-service.
 *
 * Callable functions return 403 in this project, so a request is written to
 * Firestore and the Cloud Function writes the answer back onto the same doc.
 * Mirrors the checkout flow in ./stripe.js.
 *
 * `action` is 'cancel' | 'resume' | 'portal'. Resolves with the finished
 * document; for 'portal' that carries a `url` to send the user to.
 */
export function requestBillingAction(action) {
  return new Promise(async (resolve, reject) => {
    const uid = auth.currentUser?.uid
    if (!uid) return reject(new Error('You must be signed in.'))

    let docRef
    try {
      docRef = await addDoc(collection(db, 'billingRequests'), {
        uid, action, status: 'pending', createdAt: serverTimestamp(),
      })
    } catch (err) {
      return reject(new Error('Could not start that request: ' + (err.code || err.message)))
    }

    const timeout = setTimeout(() => {
      unsub()
      reject(new Error('That took too long. Please try again.'))
    }, 45000)

    const unsub = onSnapshot(docRef, (snap) => {
      const d = snap.data()
      if (!d) return
      if (d.status === 'done') {
        clearTimeout(timeout); unsub(); resolve(d)
      } else if (d.status === 'error') {
        clearTimeout(timeout); unsub(); reject(new Error(d.error || 'That did not work.'))
      }
    }, (err) => {
      clearTimeout(timeout); unsub(); reject(err)
    })
  })
}

export const cancelMembership = () => requestBillingAction('cancel')
export const resumeMembership = () => requestBillingAction('resume')
export const openBillingPortal = () => requestBillingAction('portal')
