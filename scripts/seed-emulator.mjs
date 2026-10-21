/**
 * Seeds the LOCAL emulators with a test artist and listings in every state,
 * for clicking through seller pages (e.g. My Listings) without touching prod.
 *
 *   npm run emulators        # terminal 1 — auth + firestore only
 *   node scripts/seed-emulator.mjs # terminal 2
 *   npm run dev:emulator           # then sign in with the account below
 *
 * Talks only to 127.0.0.1 emulator ports and refuses to run otherwise.
 */
const AUTH = 'http://127.0.0.1:9099'
const FS   = 'http://127.0.0.1:8080'
const PROJECT = 'art-saturated'

export const TEST_SELLER = { email: 'seller@test.local', password: 'local-test-only-1', name: 'Local Test Painter' }

async function ensureEmulators() {
  try {
    await fetch(`${AUTH}/`)
    await fetch(`${FS}/`)
  } catch {
    throw new Error('Emulators not running on 127.0.0.1 — start them with `npm run emulators`.')
  }
}

// Firestore REST value encoding
const val = (v) => {
  if (v === null || v === undefined) return { nullValue: null }
  if (typeof v === 'boolean') return { booleanValue: v }
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }
  if (typeof v === 'string') return { stringValue: v }
  if (v instanceof Date) return { timestampValue: v.toISOString() }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(val) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, val(x)])) } }
}

async function setDoc(path, data) {
  const r = await fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },   // emulator admin bypass
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, val(v)])) }),
  })
  if (!r.ok) throw new Error(`write ${path}: ${r.status} ${await r.text()}`)
}

async function ensureUser({ email, password, name }) {
  const key = 'fake-api-key'
  let r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=${key}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, displayName: name, returnSecureToken: true }),
  })
  let j = await r.json()
  if (j.error?.message === 'EMAIL_EXISTS') {
    r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${key}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    })
    j = await r.json()
  }
  if (!j.localId) throw new Error('auth emulator: ' + JSON.stringify(j))
  return j.localId
}

async function main() {
  await ensureEmulators()
  const uid = await ensureUser(TEST_SELLER)
  const now = new Date()

  await setDoc(`users/${uid}`, {
    name: TEST_SELLER.name, email: TEST_SELLER.email, accountType: ['creator'],
    artistSubActive: true, artistPublic: true, profileComplete: true, createdAt: now,
  })

  const img = (seed) => `https://picsum.photos/seed/${seed}/400/400`
  const base = {
    category: 'Art', listingType: 'art', medium: 'ink', dimensions: '8x10', year: 2026,
    weightOz: 8, description: 'Seeded for local testing.', unique: true,
    sellerId: uid, artistUid: uid, artistName: TEST_SELLER.name,
    source: 'seller_upload', inBucket: false, sold: false, agreedToTerms: true, termsVersion: '2026-08-12',
  }
  const listings = {
    'local-live':    { name: 'Live piece',             price: 40,   stock: 1, active: true,  moderation: 'unreviewed' },
    'local-hidden':  { name: 'Hidden piece',           price: 25.5, stock: 2, active: false, moderation: 'ok' },
    'local-soldout': { name: 'Sold-elsewhere piece',   price: 60,   stock: 0, active: true,  moderation: 'ok' },
    'local-removed': { name: 'Taken-down piece',       price: 15,   stock: 1, active: false, moderation: 'removed' },
  }
  let i = 0
  for (const [id, l] of Object.entries(listings)) {
    i++
    await setDoc(`products/${id}`, {
      ...base, ...l, slug: id, artistPayout: l.price, itemNumber: 900 + i,
      image: img(id), imageURL: img(id), imageURLs: [img(id)],
      createdAt: new Date(now.getTime() - i * 60000),
    })
  }
  console.log(`Seeded ${Object.keys(listings).length} listings for ${TEST_SELLER.email} (uid ${uid}).`)
}

main().catch((e) => { console.error(e.message); process.exit(1) })
