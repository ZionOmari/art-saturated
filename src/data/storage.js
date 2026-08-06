import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, query, orderBy, where, limit as limitQ,
  serverTimestamp, runTransaction, setDoc,
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../lib/firebase'

// ── Draft helpers (localStorage, never stores image data) ────────────────────
const DRAFT_KEY = 'admin_product_draft'
export function loadDraft()  { try { const d = localStorage.getItem(DRAFT_KEY); return d ? JSON.parse(d) : null } catch { return null } }
export function saveDraft(f) { try { const { _imgFile, ...rest } = f; localStorage.setItem(DRAFT_KEY, JSON.stringify(rest)) } catch {} }
export function clearDraft() { try { localStorage.removeItem(DRAFT_KEY) } catch {} }

// ── Counters — generic atomic increment ──────────────────────────────────────

async function getNextCounter(docId) {
  const counterRef = doc(db, 'counters', docId)
  return runTransaction(db, async (txn) => {
    const snap = await txn.get(counterRef)
    const next = snap.exists() ? (snap.data().next ?? 1) : 1
    txn.set(counterRef, { next: next + 1 })
    return next
  })
}

export const getNextItemNumber       = () => getNextCounter('products')
export const getNextSubmissionNumber = () => getNextCounter('submissions')

export function formatItemNumber(n)       { return `AS-${String(n).padStart(4, '0')}` }
export function formatSubmissionNumber(n) { return `SB-${String(n).padStart(4, '0')}` }

// ── Products — Firestore ─────────────────────────────────────────────────────

export async function fetchAllProducts() {
  const snap = await getDocs(query(collection(db, 'products'), orderBy('createdAt', 'desc')))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// Shop-facing fetch — only active, non-bucket, non-mystery products
export async function fetchShopProducts() {
  const all = await fetchAllProducts()
  return all.filter(p => p.active !== false && !p.inBucket && p.category !== 'Mystery')
}

// Most recent active Art products — for the home page slideshow.
// Submission-sourced (other artists) are sorted first, admin-form last.
// Uses fetchAllProducts to avoid compound-index requirements.
export async function fetchRecentArt(n = 12) {
  try {
    const all = await fetchAllProducts()
    const artOnly = all.filter(p =>
      p.category === 'Art' &&
      p.active   !== false &&
      !p.inBucket
    )
    console.log(`[fetchRecentArt] ${artOnly.length} Art product(s) found`)
    // Submissions from artists come before admin-added pieces
    const submitted  = artOnly.filter(p => p.source === 'submission')
    const adminAdded = artOnly.filter(p => p.source !== 'submission')
    return [...submitted, ...adminAdded].slice(0, n)
  } catch (err) {
    console.error('[fetchRecentArt] failed:', err)
    return []
  }
}

// Mystery-facing fetch — only active Mystery category products
export async function fetchMysteryProducts() {
  const all = await fetchAllProducts()
  return all.filter(p => p.active !== false && p.category === 'Mystery').sort((a, b) => (a.crateSize ?? 1) - (b.crateSize ?? 1))
}

export async function addProduct(data) {
  const itemNumber = await getNextItemNumber()
  return addDoc(collection(db, 'products'), {
    itemNumber,
    sold:      false,
    active:    true,    // default — data can override
    inBucket:  false,   // default — data can override
    createdAt: serverTimestamp(),
    source:    'admin_form',
    ...data,            // caller values win (allows bucket mode)
  })
}

export async function updateProduct(id, data) {
  const { id: _id, createdAt, ...rest } = data   // strip non-updatable fields
  await updateDoc(doc(db, 'products', id), rest)
}

export async function deleteProduct(id) {
  await deleteDoc(doc(db, 'products', id))
}

// ── Image upload ─────────────────────────────────────────────────────────────

export async function uploadProductImage(file) {
  const path = `products/${Date.now()}_${file.name}`
  const snap = await uploadBytes(ref(storage, path), file)
  return getDownloadURL(snap.ref)
}

// ── Audio upload ─────────────────────────────────────────────────────────────
// Preview clips for a product (an album listing, say). These live under the same
// public `products/` prefix as images: a preview is meant to be heard by anyone
// browsing the shop. Never put a full purchased track here — paid downloads go
// to `releases/`, which is not publicly readable.
export async function uploadProductAudio(file) {
  const path = `products/audio/${Date.now()}_${file.name.replace(/\s+/g, '_')}`
  const snap = await uploadBytes(ref(storage, path), file)
  return getDownloadURL(snap.ref)
}

// ── Slug helper ───────────────────────────────────────────────────────────────
export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

