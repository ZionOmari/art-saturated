import { requestAndWait } from './firestoreRequest'

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
export async function requestBillingAction(action) {
  const { data } = await requestAndWait('billingRequests', { action }, {
    doneStatus:   'done',
    timeoutMs:    45000,
    signInError:  'You must be signed in.',
    startError:   'Could not start that request',
    timeoutError: 'That took too long. Please try again.',
  })
  return data
}

export const cancelMembership = () => requestBillingAction('cancel')
export const resumeMembership = () => requestBillingAction('resume')
export const openBillingPortal = () => requestBillingAction('portal')
