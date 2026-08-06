/**
 * Read-only payment audit.
 *
 * Lists every successful Stripe Checkout session in a lookback window and shows
 * what each one was for. Use it to answer "did a real payment come in that I
 * never got an email about?" — cross-check the order IDs it prints against the
 * Orders tab in /admin (filter: Paid).
 *
 * Reads STRIPE_SECRET_KEY from functions/.env. Makes no writes to Stripe or
 * Firestore.
 *
 *   node scripts/audit-payments.mjs          # last 30 days
 *   node scripts/audit-payments.mjs 90       # last 90 days
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require   = createRequire(resolve(__dirname, '../functions/index.js'))
const Stripe    = require('stripe')

const DAYS = Number(process.argv[2]) || 30

function loadKey() {
  const envPath = resolve(__dirname, '../functions/.env')
  const line = readFileSync(envPath, 'utf8')
    .split(/\r?\n/)
    .find(l => l.startsWith('STRIPE_SECRET_KEY='))
  if (!line) throw new Error('STRIPE_SECRET_KEY not found in functions/.env')
  return line.slice('STRIPE_SECRET_KEY='.length).trim().replace(/^["']|["']$/g, '')
}

const stripe = Stripe(loadKey())
const since  = Math.floor(Date.now() / 1000) - DAYS * 86400

const sessions = []
for await (const s of stripe.checkout.sessions.list({
  created: { gte: since },
  limit: 100,
  expand: ['data.payment_intent'],
})) {
  sessions.push(s)
}

const paid = sessions.filter(s => s.payment_status === 'paid')
const open = sessions.filter(s => s.payment_status !== 'paid')

const money = c => `$${((c || 0) / 100).toFixed(2)}`
const when  = s => new Date(s.created * 1000).toISOString().slice(0, 16).replace('T', ' ')

console.log(`\nStripe checkout sessions, last ${DAYS} days`)
console.log(`  ${sessions.length} total · ${paid.length} PAID · ${open.length} abandoned/expired\n`)

if (!paid.length) {
  console.log('  No successful payments in this window.\n')
} else {
  console.log('PAID — each of these must have a matching order in /admin:\n')
  let revenue = 0
  for (const s of paid) {
    revenue += s.amount_total || 0
    const m = s.metadata || {}
    const target = m.orderId || m.submissionId || m.albumSlug || s.client_reference_id || '—'
    console.log(
      `  ${when(s)}  ${money(s.amount_total).padStart(9)}  ${(m.type || 'unknown').padEnd(16)}` +
      `  ${target.padEnd(22)}  ${s.customer_details?.email || s.customer_email || '—'}`
    )
  }
  console.log(`\n  Total collected: ${money(revenue)}`)

  const noRef = paid.filter(s => !(s.metadata?.orderId || s.metadata?.submissionId || s.metadata?.albumSlug || s.client_reference_id))
  if (noRef.length) {
    console.log(`\n  ⚠ ${noRef.length} paid session(s) carry no order reference — these cannot be matched automatically:`)
    noRef.forEach(s => console.log(`      ${s.id}  ${money(s.amount_total)}  ${s.customer_details?.email || '—'}`))
  }
}

const byType = {}
for (const s of paid) byType[s.metadata?.type || 'unknown'] = (byType[s.metadata?.type || 'unknown'] || 0) + 1
if (paid.length) console.log('\n  By type:', Object.entries(byType).map(([k, v]) => `${k}=${v}`).join('  '))

console.log(`\n  Abandoned/expired sessions (${open.length}) are normal — the site writes an order`)
console.log('  doc before redirecting to Stripe, so each one left an unpaid record behind.\n')
