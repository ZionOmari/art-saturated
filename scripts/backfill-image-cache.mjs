/**
 * One-off backfill: give already-uploaded images a real cache header.
 *
 * Firebase Storage stamps new objects with `cache-control: private, max-age=0`
 * unless told otherwise, so every product photo uploaded before August 2026 is
 * re-downloaded on every page view. Measured: ~490 KB average per image, ~17
 * images on a category page — roughly 8 MB per visit, uncached.
 *
 * New uploads are fixed at the source in src/data/storage.js. This fixes the
 * ones already up there. It only rewrites metadata; no image bytes change and
 * no download URL changes, so it is safe to re-run.
 *
 *   node scripts/backfill-image-cache.mjs --dry     # report only
 *   node scripts/backfill-image-cache.mjs           # apply
 *
 * CREDENTIALS: needs Admin SDK access, which the Firebase CLI login does not
 * provide. Either
 *   (a) set GOOGLE_APPLICATION_CREDENTIALS to a service-account JSON key
 *       (Firebase console → Project settings → Service accounts → Generate key), or
 *   (b) run `gcloud auth application-default login` if gcloud is installed.
 */
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require   = createRequire(resolve(__dirname, '../functions/index.js'))
const admin     = require('firebase-admin')

const DRY = process.argv.includes('--dry')
const CACHE_CONTROL = 'public, max-age=31536000, immutable'
const BUCKET = 'art-saturated.firebasestorage.app'

// Only public, immutable assets. Never touch releases/ — those are paid
// downloads served through short-lived signed URLs and must not be cached.
const PREFIXES = ['products/']

try {
  admin.initializeApp({ storageBucket: BUCKET })
} catch (err) {
  console.error('Could not initialise the Admin SDK:', err.message)
  console.error('See the CREDENTIALS note at the top of this file.')
  process.exit(1)
}

const bucket = admin.storage().bucket()

let scanned = 0, fixed = 0, skipped = 0, failed = 0
let bytesNowCacheable = 0

for (const prefix of PREFIXES) {
  let files
  try {
    ;[files] = await bucket.getFiles({ prefix })
  } catch (err) {
    console.error(`Could not list ${prefix}:`, err.message)
    process.exit(1)
  }

  for (const file of files) {
    scanned++
    const meta    = file.metadata || {}
    const current = meta.cacheControl || '(none)'
    const size    = Number(meta.size || 0)

    if (current === CACHE_CONTROL) { skipped++; continue }

    const label = `${file.name} — ${Math.round(size / 1024)} KB — was: ${current}`
    if (DRY) {
      console.log(`  would fix  ${label}`)
      fixed++
      bytesNowCacheable += size
      continue
    }

    try {
      await file.setMetadata({ cacheControl: CACHE_CONTROL })
      console.log(`  fixed      ${label}`)
      fixed++
      bytesNowCacheable += size
    } catch (err) {
      console.error(`  FAILED     ${file.name}: ${err.message}`)
      failed++
    }
  }
}

console.log(`\n${DRY ? '[dry run] ' : ''}scanned ${scanned}, ${DRY ? 'would fix' : 'fixed'} ${fixed}, already correct ${skipped}, failed ${failed}`)
console.log(`${Math.round(bytesNowCacheable / 1024 / 1024 * 10) / 10} MB of images become cacheable on repeat visits.`)
if (DRY) console.log('\nRe-run without --dry to apply.')
