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

export async function checkoutCart({ items, customerEmail, orderId, shippingCost, shippingMethod, taxAmount, bundleDiscount }) {
  return waitForCheckoutUrl({ type: 'order', items, customerEmail, orderId, shippingCost, shippingMethod, taxAmount, bundleDiscount })
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

// Artist membership — $7.99/month, gates uploading new work.
export async function checkoutArtistSubscription({ customerEmail }) {
  return waitForCheckoutUrl({ type: 'artist_subscription', customerEmail })
}

export async function checkoutListingFee({ customerEmail, submissionId }) {
  const LISTING_FEE_LINK = import.meta.env.VITE_STRIPE_LISTING_FEE_LINK || null
  if (!LISTING_FEE_LINK) {
    console.warn('Stripe Payment Link not configured — skipping listing fee')
    return
  }
  const url = new URL(LISTING_FEE_LINK)
  url.searchParams.set('prefilled_email', customerEmail)
  url.searchParams.set('client_reference_id', submissionId)
  window.location.href = url.toString()
}
