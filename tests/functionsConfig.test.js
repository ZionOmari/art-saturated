// Deploy-shape checks for functions/index.js — no emulator writes.
//
// Keys come from Secret Manager, and a function only sees a secret it declares.
// A function added without fn() would deploy fine and then fail quietly at
// runtime (no email, no Stripe), so this pins the declaration down.
import { describe, it, expect, beforeAll } from 'vitest'

const SECRETS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'SHIPPO_API_KEY', 'DISCOGS_TOKEN', 'GMAIL_APP_PASSWORD']

let triggers
beforeAll(async () => {
  const fns = await import('../functions/index.js')
  const mod = fns.default || fns
  triggers = Object.entries(mod).filter(([, v]) => v && v.__endpoint)
})

describe('Cloud Function configuration', () => {
  it('finds the deployed functions', () => {
    expect(triggers.length).toBeGreaterThan(10)
  })

  it('every function declares every secret', () => {
    const missing = triggers
      .map(([name, f]) => {
        const declared = (f.__endpoint.secretEnvironmentVariables || []).map((s) => s.key)
        return [name, SECRETS.filter((s) => !declared.includes(s))]
      })
      .filter(([, m]) => m.length)
    expect(missing).toEqual([])
  })

  it('only the Stripe webhook is public', () => {
    const publicOnes = triggers
      .filter(([, f]) => (f.__endpoint.httpsTrigger?.invoker || []).includes('public'))
      .map(([name]) => name)
    expect(publicOnes).toEqual(['stripeWebhook'])
  })
})
