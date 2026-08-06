import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '../lib/firebase'

// ── Editorial cover overrides ────────────────────────────────────────────────
// Hand-curated banners for specific articles, keyed by slug. Used as a fallback
// when an article has no coverURL stored in Firestore (updating that doc requires
// admin auth). If a real coverURL is ever set on the doc, it always wins — these
// only fill the gap. Images live in /public/banners/ and ship with the deploy.
const COVER_OVERRIDES = {
  'the-archeology-of-the-loop': '/banners/archeology-of-the-loop.jpg',
}

/** Effective cover URL for an article: real coverURL wins, else editorial override, else ''. */
export function coverFor(a) {
  if (a?.coverURL) return a.coverURL
  const slugKey = a?.slug || a?.id
  return COVER_OVERRIDES[slugKey] || ''
}

/** Attach an editorial cover when the article doesn't already have one. */
function withCover(a) {
  const cover = coverFor(a)
  return cover && !a.coverURL ? { ...a, coverURL: cover } : a
}

/** All approved magazine articles, newest first. Public-readable. */
export async function fetchPublishedArticles() {
  try {
    const snap = await getDocs(
      query(collection(db, 'blogSubmissions'), where('status', '==', 'approved'))
    )
    return snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .map(withCover)
      .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0))
  } catch {
    return []
  }
}

/** Single approved article by slug (falls back to doc id). */
export async function fetchArticleBySlug(slug) {
  const all = await fetchPublishedArticles()
  return all.find(a => a.slug === slug) || all.find(a => a.id === slug) || null
}
