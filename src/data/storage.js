import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, query, orderBy, where, limit as limitQ,
  serverTimestamp, runTransaction, setDoc,
} from 'firebase/firestore'
import { ref, uploadBytes, uploadBytesResumable, getDownloadURL, listAll, getMetadata } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { normalizeProduct } from './products'

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

// The home page fetches the whole products collection, and so does ArtCarousel
// (via fetchRecentArt) — both mount together, so a single home-page view was
// downloading the entire catalog twice. Dedupe only while a fetch is IN FLIGHT:
// concurrent callers share one round-trip, but the handle clears as soon as it
// settles, so a later navigation (or an admin edit) always gets fresh data. No
// TTL, so no staleness.
let _allProductsInflight = null

export async function fetchAllProducts() {
  if (_allProductsInflight) return _allProductsInflight
  _allProductsInflight = (async () => {
    const snap = await getDocs(query(collection(db, 'products'), orderBy('createdAt', 'desc')))
    return snap.docs.map(d => normalizeProduct({ id: d.id, ...d.data() }))
  })()
  try {
    return await _allProductsInflight
  } finally {
    _allProductsInflight = null
  }
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

// ── Seller listings ──────────────────────────────────────────────────────────
// A paid-up member publishes straight to the shop: there is no approval gate.
// What holds the line instead is the agreement they accept at upload, the
// owner's review queue, and reports from anyone who sees something wrong.
//
// The fields written here must stay inside the allowlist in firestore.rules —
// an extra key fails the whole write rather than being quietly dropped, so add
// to both or neither.
export const TERMS_VERSION = '2026-08-12'

export async function createSellerListing(fields) {
  const itemNumber = await getNextItemNumber()
  return addDoc(collection(db, 'products'), {
    ...fields,
    itemNumber,
    source:        'seller_upload',
    moderation:    'unreviewed',
    active:        true,
    inBucket:      false,
    sold:          false,
    agreedToTerms: true,
    termsVersion:  TERMS_VERSION,
    createdAt:     serverTimestamp(),
  })
}

/** Owner-only: mark a listing reviewed / flagged, or take it down. */
export async function setListingModeration(productId, moderation, extra = {}) {
  await updateDoc(doc(db, 'products', productId), { moderation, ...extra })
}

// ── Reports ──────────────────────────────────────────────────────────────────
// Open to anyone, signed in or not — whoever notices a stolen photo usually
// isn't the one with an account.
export async function reportListing({ productId, productName, reason, note, reporterEmail, reporterUid }) {
  return addDoc(collection(db, 'reports'), {
    productId,
    productName:   productName || '',
    reason,
    note:          (note || '').slice(0, 1000),
    reporterEmail: reporterEmail || '',
    reporterUid:   reporterUid || null,
    status:        'open',
    createdAt:     serverTimestamp(),
  })
}

/** Owner-only. Sorted newest first in memory — a where+orderBy pair would need a composite index. */
export async function fetchReports(status = 'open') {
  const snap = await getDocs(query(collection(db, 'reports'), where('status', '==', status)))
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
}

export async function resolveReport(id, status = 'resolved') {
  await updateDoc(doc(db, 'reports', id), { status })
}

// ── Image upload ─────────────────────────────────────────────────────────────

// Firebase Storage defaults new objects to `cache-control: private, max-age=0`,
// which disables browser caching entirely — every product photo was being
// re-downloaded on every page view. Product images are immutable (the filename
// carries a timestamp), so they can be cached hard and for a long time.
const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable'

// Shop thumbnails render around 300px and the largest product view is ~900px.
// Uploading straight from a phone camera meant 1200px+, 600KB files for a 300px
// slot. Downscaling here is the difference between an ~8MB category page and a
// ~600KB one.
const MAX_EDGE = 1600
const JPEG_QUALITY = 0.82

async function downscale(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif') return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale  = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    // Already small enough and already reasonably compressed — leave it alone.
    if (scale === 1 && file.size < 400 * 1024) { bitmap.close?.(); return file }

    const w = Math.round(bitmap.width * scale)
    const h = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h)
    bitmap.close?.()

    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY))
    // Only take the re-encode if it actually helped.
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    // Any failure (unsupported codec, OOM on a huge file) — upload the original.
    return file
  }
}

export async function uploadProductImage(file) {
  const optimised = await downscale(file)
  const path = `products/${Date.now()}_${optimised.name}`
  const snap = await uploadBytes(ref(storage, path), optimised, {
    cacheControl: IMAGE_CACHE_CONTROL,
    contentType:  optimised.type,
  })
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

// ── Paid release upload / browse ─────────────────────────────────────────────
// The file a buyer receives after paying. It lives under `releases/`, which is
// admin-only in storage.rules — no client, buyer included, can read it. Only the
// PATH is stored on the product; settlement signs a 30-day URL server-side. Do
// not switch this to getDownloadURL: that token is permanent and public.
//
// Release files are whole albums, not preview clips, so this uses a resumable
// upload and reports progress — a 400 MB upload with no feedback reads as frozen.
export function uploadRelease(file, slug, onProgress) {
  const folder = slugify(slug || '') || 'misc'
  const path   = `releases/${folder}/${Date.now()}_${file.name.replace(/\s+/g, '_')}`
  const task   = uploadBytesResumable(ref(storage, path), file, {
    contentType: file.type || 'application/octet-stream',
  })
  return new Promise((resolve, reject) => {
    task.on(
      'state_changed',
      snap => onProgress?.(snap.totalBytes ? Math.round((snap.bytesTransferred / snap.totalBytes) * 100) : 0),
      reject,
      () => resolve(path),
    )
  })
}

// Every file under releases/, newest first, so a product can point at a file that
// was already uploaded (a two-format listing sharing one download, say). Listing
// is an admin-only read — a buyer calling this gets a permission error.
export async function listReleases() {
  const files = []
  async function walk(dirRef) {
    const res = await listAll(dirRef)
    for (const prefix of res.prefixes) await walk(prefix)
    for (const item of res.items) {
      const meta = await getMetadata(item).catch(() => null)
      files.push({
        path:    item.fullPath,
        name:    item.name,
        size:    meta?.size ? Number(meta.size) : null,
        updated: meta?.updated || null,
      })
    }
  }
  await walk(ref(storage, 'releases'))
  return files.sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))
}

// ── Slug helper ───────────────────────────────────────────────────────────────
export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

