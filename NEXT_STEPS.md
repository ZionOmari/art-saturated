# Art Saturated — how it works, and what's next

Rewritten 2026-10-20 during the foundation-to-crown revision. **This is the one
current document.** Older audits live in `archive/` and are history, not
instructions. If something here stops being true, fix this file in the same
commit.

---

## 1. Still to do

### Owner decisions open
- ~~Artist commission~~ — **decided 2026-10-20: 0%.** The membership is the fee;
  artists keep the full price. Sales list, terms and admin settings all agree.
- **Artist payouts — decided 2026-10-20: Stripe Connect** (each artist links a
  bank once; Stripe pays them per sale). Not built yet — Level 5.

### Revision levels remaining
- **Level 4 (code structure):** 4.4 docs — done with this file. 4.5 big files
  (`AdminPage.jsx` ~2.9k lines, `AccountPage.jsx` ~1.2k) is split as Levels 5–6
  touch them, not rewritten for its own sake.
- **Level 5 (product):** the core goal — *get artists uploading and take the
  leg work out of CD printing.* Known gaps: artists can't list music, CD
  printing is separate from artist uploads, artists have no page to manage
  their own listings.
- **Level 6 (crown):** design, polish, search visibility.

### Owner-only tasks
- **Live test purchase — deliberately the LAST step.** No shop checkout has
  ever completed (Stripe's whole history: one $20 Payment Link sale, Mar 2026).
  Buy something cheap with a real card, refund it in Stripe. Watch:
  `firebase functions:log --only stripeWebhook,reconcileStripePayments -n 20 --project art-saturated`
- Enable Stripe's Customer Portal (Dashboard → Settings → Billing → Customer
  portal) so "Manage billing" works for artist members.
- Set a ship-from address in Admin → Store Settings — label purchase refuses
  without it.
- Delete the old OneDrive copy of the project (its `functions/.env` still holds
  old copies of the keys). Optionally rotate those keys afterwards.

---

## 2. What the site is

Online-only shop and artist platform (the Parnell Ave storefront closed Oct
2026 — never reintroduce pickup, a street address, or "in store" copy).

**Routes:** `/home` `/shop` `/shop/:slug` `/cart` `/about` `/consult`
`/cd-printing` `/artists` `/artists/:slug` `/gallery-upload` `/account`
`/admin` `/login` `/payment-success` `/payment-cancelled`. Retired URLs
(`/book`, `/workshop`, `/events/*`, `/magazine/*`, `/preorder/*`, `/mystery`,
`/submit-art`, `/order/cd`) redirect.

- **Shop** — products in `products`. Shipping is live carrier rates by weight
  (Shippo), quoted to the customer and re-verified at checkout.
- **Sellers** — a $7.99/month member lists art, sculpture or clothing at
  `/gallery-upload`; it goes live immediately (no review queue). The owner's
  Review tab and public reports are the moderation. `firestore.rules` is the
  real boundary — see the products rule and `tests/rules.test.js`.
- **Artist profiles** — `/artists/:slug`, custom URL via `artistSlugs`, blog
  posts in `blogPosts`, commission inquiries (`commissionRequests`) go
  straight to the artist.
- **CD printing** — made-to-order configurator, paid upfront. Prices live only
  in `functions/cdPricing.mjs` (shared by page and server; the server reprices).
- **Consultations** — `/consult`, video call only, paid at the session.
- **Admin** — `/admin`: products, orders, review, bookings, CD orders, store
  config, users, private collection (`archive`), Discogs lookup.

### Server (17 Cloud Functions, `functions/index.js`)
Checkout, billing and shipping use the **Firestore request/response pattern**:
the page writes a doc (`checkoutRequests`, `billingRequests`,
`shippingRequests`, `aiRequests` for Discogs), a function answers on the same
doc. Client side, `src/lib/firestoreRequest.js` is the one helper for that.

Payments settle in `handlePaidSession()`, reached two ways: the public
`stripeWebhook` (instant) and `reconcileStripePayments` (every 5 min, safety
net). A `stripeSessions/{id}` lock makes double delivery harmless. Unknown or
retired payment types land in `orphanedPayments` and email the owner — never
silently settled.

---

## 3. Working on it

```bash
cd C:\dev\art-saturated          # NOT the old OneDrive copy
npm test                         # 99 tests: vitest + Firestore emulator
npm run lint                     # bug-only lint (undefined names, hooks, dead code)
npm run build
node scripts/audit-payments.mjs 90   # read-only Stripe check
```

CI (GitHub Actions, on push to `master`) runs lint, tests and build.

**Deploy:**
```bash
firebase login --reauth      # token expires often; login:list lies about it
npm run build && node scripts/gen-sitemap.mjs
firebase deploy --only hosting,functions,firestore:rules,storage --project art-saturated
```
Add `--force` when functions were removed from source (Firebase deletes them).

### Things that will bite you
- **Two `.env` files, neither in git.** Root `.env` = public web config
  (`VITE_FIREBASE_*`). Without it the build *succeeds* but ships a site that
  can't reach the database — and `gen-sitemap` prints "no firebase config".
  `functions/.env` holds only `GMAIL_USER`.
- **API keys are in Secret Manager**, not `.env`: `STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `SHIPPO_API_KEY`, `DISCOGS_TOKEN`,
  `GMAIL_APP_PASSWORD`. Set with `firebase functions:secrets:set NAME`. Every
  function is built with `fn()` in `index.js`, which declares them;
  `tests/functionsConfig.test.js` fails if one doesn't. Firebase refuses to
  deploy if a secret name also appears in `functions/.env`.
- **Never start the functions emulator in tests** — triggers would run against
  real services. `npm test` starts only the Firestore emulator.
- **Editing `functions/index.js`:** after any cut, load-check it —
  `cd functions && GCLOUD_PROJECT=art-saturated node -e "require('./index.js')"`.
  `node --check` only checks syntax.
- **Mutation-testing a guard:** commit first, or restore from a copy. Never
  `git checkout -- <file>` to undo a temporary change — it also discards every
  uncommitted edit in that file.
- **Org policy:** the Workspace org restricts public access by default; the
  `art-saturated` project has an override so `stripeWebhook` can be public.
  Only `stripeWebhook` should be public (a test enforces it).
- **Service-account keys can't be created** (org policy), so scripts that need
  one — e.g. `scripts/backfill-image-cache.mjs` — must run another way.
