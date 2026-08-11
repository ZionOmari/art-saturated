# Path forward — artsaturated.com

Written 2026-08-10. Everything below is committed and deployed; the site is live
and consistent with this repo.

---

## 1. The one thing that actually matters

**No customer has ever completed a purchase on this site.** Exactly one payment
exists in the Stripe account's history (March 2026, $20, via an off-site Payment
Link — not the shop checkout).

Everything in the payment path has been fixed and unit-tested, but the happy path
has **never run for real**:

- checkout → Stripe → settlement → stock decrement → confirmation emails
- digital download delivery (signed URL generation is unverified)
- artist membership → upload
- order messaging

**Do this first: buy something cheap on your own site with a real card, then
refund it in Stripe.** Cost is a ~30¢ fee. It either proves the money path works
or surfaces the last real bug. Watch it with:

```bash
firebase functions:log --only reconcileStripePayments -n 20 --project art-saturated
```

Settlement runs on a 5-minute poller, so allow up to 5 minutes before worrying.

---

## 2. Two dashboard tasks (no code needed)

**Enable Stripe's Customer Portal** — Stripe Dashboard → Settings → Billing →
Customer portal. Until this is on, the "Manage billing" button in an artist's
account shows a plain "not set up yet" message. Cancel/resume already work
without it.

**Lift the org policy blocking public function invokers** — Google Cloud Console
→ IAM & Admin → Organization Policies → `constraints/iam.allowedPolicyMemberDomains`,
add an exception for project `art-saturated`. This is the single highest-leverage
fix available and repairs three things at once:

- the Stripe webhook (payments settle instantly instead of on a 5-minute poll)
- shipping label purchase in the admin Orders tab (currently 403, so it cannot work)
- every callable function, including a proper download button for digital goods

Afterwards, redeploy `stripeWebhook` with `runWith({ invoker: 'public' })` — the
code path already exists and needs no changes.

---

## 3. Known gaps, in priority order

| Gap | Notes |
|---|---|
| Preview-clip uploader is in the wrong category block | The Track Previews field renders only when Category = Art, so an album (`Physical Media`) can't get preview clips at all. One-line move in `AdminPage.jsx` |
| Weightless products ship free | `calcShipping` returns 0 when `weightOz` is unset. Cart copy is honest about it, but decide whether it's intended or a data gap |
| Existing users carry stale `isPartner` / `student` fields | Inert — nothing reads them, rules keep them locked. Cosmetic cleanup only |
| Admin `AdminPage.jsx` is ~600 KB | Owner-only page, so no customer impact. Split if it ever gets annoying |
| Audit dimensions never run | performance, correctness, platform (mobile was completed 2026-08-10) |

---

## 4. Things that will bite you if you don't know them

**Cloud Functions are 403 for anything HTTP or callable.** An org policy blocks
public invokers. The established workaround is a Firestore request/response
document — see `onCheckoutRequestCreated` and `onBillingRequestCreated`. Do not
add a new callable function; it will not be reachable.

**Payments settle by polling, not webhook.** `reconcileStripePayments` runs every
5 minutes and shares one code path (`handlePaidSession`) with the webhook, so the
webhook starts working the moment the org policy is lifted, with no code change.
A `stripeSessions/{id}` lock makes double-delivery safe.

**Editing `functions/index.js`:**
- `node --check` is a syntax check, **not** a load check. Always follow with
  `cd functions && node -e "require('./index.js')"` — a removed helper still parses.
- Never bound a function by "the next `exports.`" — helpers live between functions
  and get silently swallowed. Watch for CRLF endings breaking naive regexes.
- Never write code containing backticks/template literals through a bash heredoc.
  It corrupts the file. Use an editor.

**Deploying:**
```bash
firebase login --reauth            # the token expires often; login:list lies about it
$env:FUNCTIONS_DISCOVERY_TIMEOUT="120"
firebase deploy --only hosting,functions,firestore:rules --project art-saturated
```
Firebase refuses to delete functions you removed from source. Delete explicitly:
`firebase functions:delete <names> --region us-central1 --force`

**Tests:** `npm test` (35 tests, vitest + Firestore emulator). **Never start the
functions emulator in tests** — `functions/.env` holds live Stripe and Gmail
credentials and triggers would fire for real.

**Paid downloads:** the product form has a "Paid Download" field (all categories).
It uploads to `releases/<slug>/`, which is admin-only in `storage.rules`, and
stores the **path** — never a download URL, because a `getDownloadURL` token is
permanent and public. It can also list and reuse files already in `releases/`.
The buyer's link is signed at settlement and emailed; there is still no download
button, because callables are 403.

**Images:** uploads are downscaled to 1600px and cached for a year automatically.
If images ever get added outside the app, re-run
`node scripts/backfill-image-cache.mjs --dry` (needs a service-account key).

---

## 5. Useful one-liners

```bash
npm test                                   # 35 tests
npm run build                              # vite build
node scripts/audit-payments.mjs 90         # read-only Stripe reconciliation check
firebase functions:list --project art-saturated
```

Dead-code check (walks imports from the entry points; should report 0 orphans):
the reachability script used during the Aug 2026 cleanup — re-create it if you
remove another feature, it caught 15 orphaned files nothing imported.
