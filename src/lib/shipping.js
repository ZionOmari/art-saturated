import { requestAndWait } from './firestoreRequest'

/**
 * Shippo work goes through Firestore, like checkout: callables return 403 on
 * this project. Writes a shippingRequests doc and resolves with the function's
 * `result`, plus the request id (a CD order cites its quote by id).
 */
export async function shippingRequest(payload) {
  const { id, data } = await requestAndWait('shippingRequests', payload, {
    timeoutMs:    90000,
    startError:   'Could not reach shipping',
    timeoutError: 'Shipping took too long to respond. Try again.',
    failError:    'Shipping request failed.',
  })
  return { id, ...data.result }
}

// Admin: rates for a shop order (same shape the old callable returned).
export async function getShopOrderRates(orderId) {
  return (await shippingRequest({ action: 'order_rates', orderId })).rates
}
