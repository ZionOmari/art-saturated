import { doc, getDoc, setDoc, deleteDoc, getDocs, collection, query, where } from 'firebase/firestore'
import { db } from '../lib/firebase'

const RESERVED = new Set([
  'home', 'shop', 'store', 'cart', 'consult', 'consultations',
  'artists', 'gallery-upload', 'about', 'account', 'login', 'admin',
  'payment-success', 'payment-cancelled', 'book', 'workshop', 'preorder',
  'events', 'magazine', 'mystery', 'submit-art', 'order', 'api',
  'functions', 'settings', 'profile', 'signup', 'register', 'help',
  'support', 'contact', 'blog', 'feed', 'search', 'explore',
  'notifications', 'messages', 'inbox', 'checkout', 'billing',
  'terms', 'privacy', 'dmca', 'report', 'flag', 'mod',
  '__', 'null', 'undefined', 'favicon', 'robots', 'sitemap',
])

export function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40)
}

export function isValidSlug(slug) {
  return /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug) && !slug.includes('--')
}

export function isReservedSlug(slug) {
  return RESERVED.has(slug)
}

export async function isSlugTaken(slug) {
  const snap = await getDoc(doc(db, 'artistSlugs', slug))
  return snap.exists()
}

export async function getSlugOwner(slug) {
  const snap = await getDoc(doc(db, 'artistSlugs', slug))
  return snap.exists() ? snap.data().uid : null
}

export async function claimSlug(slug, uid) {
  const ref = doc(db, 'artistSlugs', slug)
  const snap = await getDoc(ref)
  if (snap.exists() && snap.data().uid !== uid) {
    throw new Error('This username is already taken.')
  }
  await setDoc(ref, { uid })
}

export async function releaseSlug(slug) {
  await deleteDoc(doc(db, 'artistSlugs', slug))
}

export async function validateSlug(slug, currentUid) {
  if (!slug) return 'Username is required.'
  if (!isValidSlug(slug)) return 'Use 3–40 lowercase letters, numbers, and hyphens.'
  if (isReservedSlug(slug)) return 'That username is not available.'
  const owner = await getSlugOwner(slug)
  if (owner && owner !== currentUid) return 'That username is already taken.'
  return null
}

export async function resolveSlugToUid(slug) {
  const owner = await getSlugOwner(slug)
  return owner || null
}
