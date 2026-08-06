import { collection, getDocs, getDoc, doc, query, where, getCountFromServer } from 'firebase/firestore'
import { db } from '../lib/firebase'

/** All users who have opted their profile into the public directory */
export async function getPublicArtists() {
  const snap = await getDocs(query(collection(db, 'users'), where('artistPublic', '==', true)))
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }))
}

/** Single artist profile by uid */
export async function getArtistProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid))
  return snap.exists() ? { uid: snap.id, ...snap.data() } : null
}

/** Count of approved submissions for one artist (used for listing quota) */
export async function getApprovedListingCount(uid) {
  try {
    const snap = await getCountFromServer(
      query(collection(db, 'submissions'), where('uid', '==', uid), where('status', '==', 'approved'))
    )
    return snap.data().count
  } catch {
    // fallback if getCountFromServer not available
    const snap = await getDocs(query(collection(db, 'submissions'), where('uid', '==', uid), where('status', '==', 'approved')))
    return snap.size
  }
}

/** All approved submissions for one artist, newest first.
 *  Returns [] silently if the viewer lacks read permission (e.g. not logged in). */
export async function getArtistWork(uid) {
  try {
    const snap = await getDocs(query(collection(db, 'submissions'), where('uid', '==', uid)))
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(s => s.status === 'approved')
      .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0))
  } catch {
    return []
  }
}

/**
 * Load all public artists AND their work from both submissions + products.
 * Products are public-readable; submissions are silently skipped if no auth.
 */
export async function getArtistsWithWork() {
  const artists = await getPublicArtists()
  if (artists.length === 0) return []

  const artistUids = artists.map(a => a.uid)

  // ── Submissions (may be denied for unauthenticated visitors) ─────────────
  const subByUid = {}
  try {
    const subSnap = await getDocs(
      query(collection(db, 'submissions'), where('status', '==', 'approved'))
    )
    subSnap.docs.forEach(d => {
      const s = { id: d.id, ...d.data() }
      if (!subByUid[s.uid]) subByUid[s.uid] = []
      subByUid[s.uid].push(s)
    })
  } catch {
    // Unauthenticated — fall through to products-only
  }

  // Pieces already represented by a submission, per artist — used to dedupe their
  // approved product so a viewer who CAN read submissions doesn't see it twice.
  // Public viewers have an empty subByUid, so submission-sourced products stay
  // visible (otherwise their work would never appear in the directory).
  const subProductIdsByUid = {}
  Object.entries(subByUid).forEach(([u, subs]) => {
    subProductIdsByUid[u] = new Set(subs.map(s => s.productId).filter(Boolean))
  })

  // ── Products (public read) — chunk into groups of 30 for 'in' query ──────
  const prodByUid = {}
  const chunks = []
  for (let i = 0; i < artistUids.length; i += 30) chunks.push(artistUids.slice(i, i + 30))
  await Promise.all(chunks.map(async chunk => {
    const snap = await getDocs(
      query(collection(db, 'products'), where('artistUid', 'in', chunk))
    )
    snap.docs.forEach(d => {
      const p = { id: d.id, ...d.data() }
      if (!p.active || p.inBucket) return
      const uid = p.artistUid
      if (subProductIdsByUid[uid]?.has(p.id)) return  // already shown via its submission
      if (!prodByUid[uid]) prodByUid[uid] = []
      const imgArr = Array.isArray(p.imageURLs) ? p.imageURLs
                   : Array.isArray(p.images)    ? p.images : null
      prodByUid[uid].push({
        id:          p.id,
        _source:     'product',
        title:       p.name || '',
        imageURL:    imgArr ? imgArr[0] : (p.imageURL || p.image || null),
        price:       p.price,
        medium:      p.medium || '',
        submittedAt: p.createdAt || null,
      })
    })
  }))

  return artists.map(a => {
    const subs  = (subByUid[a.uid]  || []).sort((x, y) => (y.submittedAt?.seconds || 0) - (x.submittedAt?.seconds || 0))
    const prods = (prodByUid[a.uid] || []).sort((x, y) => (y.submittedAt?.seconds || 0) - (x.submittedAt?.seconds || 0))
    // Merge, deduplicate, submissions first
    const seen = new Set()
    const work = [...subs, ...prods].filter(w => {
      if (seen.has(w.id)) return false
      seen.add(w.id); return true
    })
    return { ...a, work }
  })
}
