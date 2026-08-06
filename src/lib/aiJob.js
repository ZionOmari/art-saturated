import { collection, addDoc, doc, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { db } from './firebase'

/**
 * runAiJob — request/response over Firestore instead of a callable function.
 *
 * Callable (onCall) functions need a public `allUsers` invoker binding, which
 * the artsaturated.com Workspace org policy (Domain Restricted Sharing) blocks.
 * So instead the client writes a request doc; the `onAiRequestCreated` Cloud
 * Function (a Firestore trigger — no invoker needed) fulfills it and writes the
 * result back. Mirrors the Stripe checkout pattern already used on the site.
 *
 * @param {string} type    'quickfill' | 'seo' | 'spotlight' | 'interview'
 * @param {object} payload type-specific args
 * @param {string} uid     current user's uid (for audit)
 * @returns {Promise<object>} resolves with the function's result
 */
export function runAiJob(type, payload = {}, uid = null) {
  return new Promise((resolve, reject) => {
    let unsub = () => {}
    const timeout = setTimeout(() => {
      unsub()
      reject(new Error('AI request timed out — please try again.'))
    }, 125000)

    addDoc(collection(db, 'aiRequests'), {
      type,
      payload,
      uid,
      status:    'pending',
      createdAt: serverTimestamp(),
    })
      .then(ref => {
        unsub = onSnapshot(
          doc(db, 'aiRequests', ref.id),
          snap => {
            const d = snap.data()
            if (!d) return
            if (d.status === 'done')  { clearTimeout(timeout); unsub(); resolve(d.result || {}) }
            if (d.status === 'error') { clearTimeout(timeout); unsub(); reject(new Error(d.error || 'AI request failed.')) }
          },
          err => { clearTimeout(timeout); unsub(); reject(err) }
        )
      })
      .catch(err => { clearTimeout(timeout); reject(err) })
  })
}
