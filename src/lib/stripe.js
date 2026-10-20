import { requestAndWait } from './firestoreRequest'

/**
 * Writes a checkout request to Firestore and waits for the
 * Firestore-triggered Cloud Function to respond with a Stripe URL.
 * This avoids all HTTP IAM restrictions.
 */
async function waitForCheckoutUrl(data) {
  const { data: d } = await requestAndWait('checkoutRequests', { ...data, url: null, error: null }, {
    timeoutMs:    130000,
    signInError:  'You must be signed in to checkout.',
    startError:   'Could not start checkout',
    timeoutError: 'Checkout timed out — please try again. If the problem persists, contact us.',
    failError:    'Checkout failed.',
  })
  if (!d.url) throw new Error('Checkout failed — no payment page was returned.')
  window.location.href = d.url
}

export async function checkoutCart({ items, customerEmail, orderId, shippingCost, shippingMethod, taxAmount, bundleDiscount, shippingQuoteId, shippingRateId }) {
  return waitForCheckoutUrl({ type: 'order', items, customerEmail, orderId, shippingCost, shippingMethod, taxAmount, bundleDiscount, shippingQuoteId: shippingQuoteId || null, shippingRateId: shippingRateId || null })
}

export async function checkoutDeposit({ customerEmail, orderId, productId, productName }) {
  return waitForCheckoutUrl({ type: 'deposit', customerEmail, orderId, productId, productName })
}

// CD printing order (QuoteRequestPage). The function prices it from the saved
// order doc and decides whether this is the first payment or the balance.
export async function checkoutCdOrder({ orderId, customerEmail }) {
  return waitForCheckoutUrl({ type: 'cd_order', orderId, customerEmail })
}

// Artist membership — $7.99/month, gates uploading new work.
export async function checkoutArtistSubscription({ customerEmail }) {
  return waitForCheckoutUrl({ type: 'artist_subscription', customerEmail })
}

// The $1 per-listing fee was retired in August 2026 — the artist membership
// above replaces it. checkoutListingFee() and VITE_STRIPE_LISTING_FEE_LINK are
// gone with it; the Stripe Payment Link behind them has been deactivated.
