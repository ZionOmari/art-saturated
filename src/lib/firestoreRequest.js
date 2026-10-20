import { addDoc, collection, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { db, auth } from './firebase'

/**
 * Request/response over Firestore — the pattern behind checkout, shipping and
 * billing. The page writes a request doc; a Firestore-triggered Cloud Function
 * does the work and writes its answer back onto the same doc.
 *
 * Resolves with { id, data } once the doc reaches `doneStatus`; rejects on
 * status 'error', on timeout, or if the listener itself fails (e.g. a rules
 * denial) — so a caller is never left on a spinner with no answer.
 */
export async function requestAndWait(collectionName, payload, {
  doneStatus   = 'ready',
  timeoutMs    = 60000,
  signInError  = 'Please sign in first.',
  startError   = 'Could not start that request',
  timeoutError = 'That took too long. Please try again.',
  failError    = 'That did not work.',
} = {}) {
  const uid = auth.currentUser?.uid
  if (!uid) throw new Error(signInError)

  let ref
  try {
    ref = await addDoc(collection(db, collectionName), {
      ...payload, uid, status: 'pending', createdAt: serverTimestamp(),
    })
  } catch (err) {
    throw new Error(`${startError}: ${err.code || err.message}`)
  }

  return new Promise((resolve, reject) => {
    let unsub = () => {}
    const finish = (fn) => { clearTimeout(timer); unsub(); fn() }
    const timer = setTimeout(() => finish(() => reject(new Error(timeoutError))), timeoutMs)
    unsub = onSnapshot(ref, (snap) => {
      const d = snap.data()
      if (!d) return
      if (d.status === doneStatus) finish(() => resolve({ id: ref.id, data: d }))
      else if (d.status === 'error') finish(() => reject(new Error(d.error || failError)))
    }, (err) => finish(() => reject(err)))
  })
}
