import {
  collection, addDoc, getDocs,
  query, orderBy, limit, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'

// ── Fetch reviews for a product (most recent first, capped at 30) ─────────────
export async function fetchReviews(productId) {
  const snap = await getDocs(
    query(
      collection(db, 'products', productId, 'reviews'),
      orderBy('createdAt', 'desc'),
      limit(30),
    )
  )
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ── Add a new review ──────────────────────────────────────────────────────────
export async function addReview(productId, { uid, displayName, rating, comment }) {
  return addDoc(collection(db, 'products', productId, 'reviews'), {
    uid,
    displayName: displayName || 'Anonymous',
    rating:      Number(rating),
    comment:     comment || '',
    createdAt:   serverTimestamp(),
  })
}

// ── Compute average rating (null when no reviews) ─────────────────────────────
export function calcAverageRating(reviews) {
  if (!reviews?.length) return null
  const sum = reviews.reduce((s, r) => s + Number(r.rating), 0)
  return sum / reviews.length
}
