import { addDoc, collection, onSnapshot, serverTimestamp } from 'firebase/firestore'
import { db, auth } from './firebase'

/**
 * Writes a checkout request to Firestore and waits for the
 * Firestore-triggered Cloud Function to respond with a Stripe URL.
 * This avoids all HTTP IAM restrictions.
 */
function waitForCheckoutUrl(data) {
  return new Promise(async (resolve, reject) => {
    const uid = auth.currentUser?.uid
    if (!uid) return reject(new Error('You must be signed in to checkout.'))

    let docRef
    try {
      docRef = await addDoc(collection(db, 'checkoutRequests'), {
        ...data,
        uid,
        status: 'pending',
        url: null,
        error: null,
        createdAt: serverTimestamp(),
      })
      console.log('checkout doc created:', docRef.id)
    } catch (err) {
      console.error('addDoc failed:', err.code, err.message)
      return reject(new Error('Could not start checkout: ' + (err.code || err.message)))
    }

    const timeout = setTimeout(() => {
      unsub()
      reject(new Error('Checkout timed out — please try again. If the problem persists, contact us.'))
    }, 130000)

    const unsub = onSnapshot(docRef, (snap) => {
      const d = snap.data()
      if (!d) return
      if (d.status === 'ready' && d.url) {
        clearTimeout(timeout)
        unsub()
        window.location.href = d.url
        resolve()
      } else if (d.status === 'error') {
        clearTimeout(timeout)
        unsub()
        reject(new Error(d.error || 'Checkout failed.'))
      }
    })
  })
}

export async function checkoutCart({ items, customerEmail, orderId, shippingCost, shippingMethod, taxAmount, bundleDiscount, shippingQuoteId, shippingRateId }) {
  return waitForCheckoutUrl({ type: 'order', items, customerEmail, orderId, shippingCost, shippingMethod, taxAmount, bundleDiscount, shippingQuoteId: shippingQuoteId || null, shippingRateId: shippingRateId || null })
}

export async function checkoutDeposit({ customerEmail, orderId, productId, productName }) {
  return waitForCheckoutUrl({ type: 'deposit', customerEmail, orderId, productId, productName })
}

export async function checkoutBlogSubmission({ customerEmail, submissionId, title, fee }) {
  return waitForCheckoutUrl({ type: 'blog', customerEmail, submissionId, title, fee })
}

export async function checkoutPreorder({ customerEmail, shippingCost, shippingMethod, albumSlug, albumName, artistName }) {
  return waitForCheckoutUrl({ type: 'preorder', albumSlug, albumName, artistName, customerEmail, shippingCost, shippingMethod })
}

export async function checkoutWorkshopDeposit({ customerEmail, bookingName }) {
  return waitForCheckoutUrl({ type: 'workshop_deposit', customerEmail, bookingName })
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
