import { collection, getDocs, getDoc, doc, query, where } from 'firebase/firestore'
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

/** Single artist profile by slug — resolves slug → uid via the index, then fetches the user doc */
export async function getArtistBySlug(slug) {
  const slugSnap = await getDoc(doc(db, 'artistSlugs', slug))
  if (!slugSnap.exists()) return null
  const uid = slugSnap.data().uid
  return getArtistProfile(uid)
}

/**
 * Load all public artists and their active, published products.
 */
export async function getArtistsWithWork() {
  const artists = await getPublicArtists()
  if (artists.length === 0) return []

  const artistUids = artists.map(a => a.uid)

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

  return artists.map(a => ({
    ...a,
    work: (prodByUid[a.uid] || []).sort((x, y) => (y.submittedAt?.seconds || 0) - (x.submittedAt?.seconds || 0)),
  }))
}
