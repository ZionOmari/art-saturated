/**
 * One-off migration: 'Room 40 Threads' → 'Clothing'.
 *
 * The shop's own clothing line is retired; the category is now plain 'Clothing',
 * open to anyone selling garments. The app normalizes the old string on read
 * (see normalizeCategory in src/data/products.js), so the site is already
 * correct without this — running it just makes the stored data match, after
 * which that legacy map can be deleted.
 *
 * Touches `products` and `submissions`. It deliberately does NOT rewrite the
 * category snapshot inside past `orders`: an order is a record of what was sold
 * under the name it was sold under, and rewriting history to fix an admin filter
 * pill is the wrong trade.
 *
 *   node scripts/rename-threads-category.mjs --dry     # report only
 *   node scripts/rename-threads-category.mjs           # apply
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
const OLD = 'Room 40 Threads'
const NEW = 'Clothing'

// collection → fields on that collection holding a category label
const TARGETS = [
  { collection: 'products',    fields: ['category'] },
  { collection: 'submissions', fields: ['category', 'shopCategory'] },
]

try {
  admin.initializeApp()
} catch (err) {
  console.error('Could not initialise the Admin SDK:', err.message)
  console.error('See the CREDENTIALS note at the top of this file.')
  process.exit(1)
}

const db = admin.firestore()
let total = 0

for (const { collection, fields } of TARGETS) {
  for (const field of fields) {
    const snap = await db.collection(collection).where(field, '==', OLD).get()
    if (snap.empty) {
      console.log(`${collection}.${field}: nothing to change`)
      continue
    }
    console.log(`${collection}.${field}: ${snap.size} document(s)`)
    for (const doc of snap.docs) {
      console.log(`  ${DRY ? 'would update' : 'updating'} ${doc.id}`)
      if (!DRY) await doc.ref.update({ [field]: NEW })
      total++
    }
  }
}

console.log(DRY
  ? `\nDry run — ${total} document(s) would change. Re-run without --dry to apply.`
  : `\nDone — ${total} document(s) updated.`)
process.exit(0)
