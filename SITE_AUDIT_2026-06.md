# Art Saturated — Full Site Audit (June 2026)

**Scope:** 15 dimensions audited across 4 parallel batches. The **Payments** dimension (Stripe checkout/webhook payment-logic correctness) was completed in a prior audit and is **excluded** here — but client-side commerce UX, function hygiene around payments, and order/total bugs that touch money are covered below.

**How to read this:** Findings are grouped by dimension, then by severity. Each line is `**[title]** — file:line — issue — **Fix:**`. This report is meant to be acted on without re-investigation.

**Project root:** `C:\Users\Ziont\OneDrive\Desktop\ARTSATARTSAT\art-saturated`

---

## ⚠️ Do these FIRST (cross-cutting, blocking)

The single highest-priority items, surfaced from multiple dimensions. **Order matters** for the first three:

1. **Create `.gitignore` BEFORE any `git init`** — must contain `.env`, `.env.*`, `functions/.env`, `node_modules/`, `dist/`, `.firebase/`, `*-debug.log`. The repo is currently NOT under version control; the moment someone runs `git init && git add -A` with no ignore file, all live secrets (Stripe live key, SendGrid, Firebase deploy token) are committed.
2. **Rotate/revoke exposed secrets** — see the Secrets dimension rotation list. The `FIREBASE_TOKEN` (full deploy rights) is unused dead weight; revoke it now.
3. **`git init` + push to a private remote**, then **move the project out of OneDrive** (`node_modules` is 289 MB syncing continuously → file-lock/build-corruption risk on Windows).
4. **Add the missing Firestore rules** for `feedback` and `quoteRequests`, and the Storage rule for `banners/{uid}` — three live features are 100% broken (every write silently denied) until these exist.
5. **Stop trusting client-computed order totals/prices** — the checkout Cloud Function must re-price from Firestore. This is the root cause of the discount-mismatch, oversell, and orphaned-order bugs.

---

## Dimension: Routing & Navigation

### Critical
None.

### High
- **No cache-control headers in firebase.json** — `firebase.json:2-12` — No `headers` block. The app already carries an auto-reload workaround for stale-deploy ChunkLoadErrors (`src/App.jsx:17-24`), strongly implying users get a cached `index.html` referencing deleted hashed chunks after deploys. **Fix:** Add `Cache-Control: no-cache` for `**/index.html` and `public, max-age=31536000, immutable` for `/assets/**`. Keep the reload workaround.
- **Orphaned duplicate admin blog panel** — `src/pages/AdminPage_BlogPanel.jsx` — Not imported anywhere; `AdminPage.jsx:1368` has its own `MagazineAdminPanel` that actually renders. A future edit to the orphan silently does nothing. **Fix:** Delete it (or re-wire as the single source).

### Medium
- **Dead `/payment` entry in TEXT_HEAVY_ROUTES** — `src/App.jsx:90,105-107` — Routes are `/payment-success` / `/payment-cancelled`; neither matches `/payment`, so payment pages render with the wrong (non-frozen) background. **Fix:** Replace `'/payment'` with both real paths.
- **`/shop/:slug` downloads the entire products collection to resolve one slug** — `src/pages/ProductPage.jsx:316-319` — `fetchProducts()` then `.find(p => p.slug === slug)`. **Fix:** `query(collection(db,'products'), where('slug','==',slug), limit(1))`.
- **Internal nav uses `<button onClick={navigate}>` and raw `<a href>` instead of `<Link>`** — `src/components/Footer.jsx:20-28`, `src/components/Navbar.jsx:44-50,88,110`, `src/App.jsx:39,205` — The two `<a href="/home">` trigger full page reloads; buttons have no crawlable href / no middle-click. **Fix:** Use `<Link>`/`<NavLink>` (ErrorBoundary `<a>` may stay a hard link intentionally).
- **Entire app blanks until Firebase Auth resolves** — `src/context/AuthContext.jsx:245` (`{!loading && children}`) wrapping `App.jsx:162` — On cold load nothing renders (not even Navbar) until `onAuthStateChanged` fires. **Fix:** Always render children; gate only auth-dependent UI on `loading`.
- **Back/forward navigation loses scroll position** — `src/App.jsx:93-97` — `ScrollToTop` runs on every pathname change incl. POP. **Fix:** Use `useNavigationType()` and skip scroll on `'POP'`.
- **Unknown URLs return HTTP 200 (soft 404)** — `firebase.json:10` + `App.jsx:199-208` — Crawlers see 200 for junk URLs. **Fix:** Inject `<meta name="robots" content="noindex">` on the catch-all route.

### Low
- **Duplicate route alias `/account` + `/account/profile`** — `App.jsx:179-180` — Both render `<AccountPage />`. **Fix:** Make `/account/profile` a `<Navigate to="/account" replace />` or drop it.
- **Owner email hardcoded in multiple files** — `AdminPage.jsx:2855`, `AccountPage.jsx:231` — Maintainability. **Fix:** Single exported `OWNER_EMAIL` const.
- **Orphaned page `SplashPage.jsx`** — never imported/routed. **Fix:** Delete or wire up.
- **`/blog-submit` and `/wishlist/:uid` have no in-app nav entry** — only reachable via Stripe cancel_url / copy-link. **Fix:** Link from Magazine/Footer if public is intended.
- **Navbar/SetupGate render outside ErrorBoundary** — `App.jsx:164-166` vs `:168` — A Navbar render error white-screens despite the boundary. **Fix:** Move boundary up to wrap them.
- **No trailing-slash normalization** — `firebase.json` — `/shop` and `/shop/` both 200. **Fix:** Add `"trailingSlash": false`.

### Stack notes
- `react-router-dom` ^6.30.4 with both v7 future flags already enabled — v7 upgrade is essentially a version bump.
- Code-splitting is healthy: all 24 routed pages use `React.lazy` + one `Suspense`; sensible `manualChunks` (react vendor + per-service firebase). Top-level ErrorBoundary handles chunk-load failures with a one-shot reload.
- Rewrite ordering is correct (Stripe webhook before the `**` SPA catch-all); one `BrowserRouter`, no nested trees, no conflicting paths.

---

## Dimension: Firestore & Storage Rules

### Critical
- **`orders` create has zero field validation** — `firestore.rules:30` — `allow create: if request.auth != null;` lets any signed-in user forge `total`, `paymentStatus:'paid'`, `status:'completed'`, or a `sellerId` pointing at another creator (then read others' content via the seller-read rule at line 28). **Fix:** require `request.resource.data.uid == request.auth.uid`, force `status=='pending' && paymentStatus=='pending'` on create, validate total math; let the Cloud Function (Admin SDK) own payment/status transitions.
- **Admin determined solely by `request.auth.token.email`, no `email_verified`** — `firestore.rules:6`, `storage.rules:5-7` — A federated/custom-token sign-in can carry an arbitrary unverified email. **Fix:** move to a custom claim (`request.auth.token.admin == true`); at minimum add `&& request.auth.token.email_verified == true`.
- **`feedback` collection has NO rule → default deny** — `firestore.rules` (no match) vs `FeedbackBubble.jsx:30` write + `AdminPage.jsx:2681,2690` read — Every feedback submission silently denied; admin panel reads nothing. **Fix:** `match /feedback/{id} { allow create: if true; allow read,update,delete: if isAdmin(); }`.
- **`quoteRequests` collection has NO rule → default deny** — `QuoteRequestPage.jsx:350` create + `AdminPage.jsx:2749,2759` — CD/quote submissions entirely broken (denied) after the audio/image upload already succeeded. **Fix:** add the mirror rule as above.

### High
- **`users` write is all-or-nothing → self-escalation** — `firestore.rules:13` (`allow write: if request.auth.uid == userId`) — A user can `setDoc {isPartner:true}` / `{partnerApplication:'approved'}` (bypassing the $1 listing fee), or write a fake `lifetimeSpend`. **Fix:** `affectedKeys().hasOnly([...self-editable...])`; forbid `isPartner`/`partnerApplication` from the client.
- **Storage `banners/{uid}` has NO rule → default deny** — `storage.rules:59-61` vs `AccountPage.jsx:380` — Creator banner uploads silently fail. **Fix:** `match /banners/{userId} { allow read: if true; allow write: if request.auth.uid == userId; }`.
- **`slots` create fully open, no validation** — `firestore.rules:96-97` — Any unauth client can create junk slots or flip any slot to `booked:true` (griefs the calendar). **Fix:** validate fields; restrict update to the `booked` field only.
- **`counters` read/write to any authed user** — `firestore.rules:60-61` — Any user can overwrite `counters/products.next`, corrupting numbering. **Fix:** move increments to a Function, or require `next == resource.data.next + 1`.

### Medium
- **`commissionRequests` update lets the artist write any field** — `firestore.rules:70-71` — Artist can rewrite `collectorUid`, price, status. **Fix:** `affectedKeys().hasOnly([...])`.
- **`eventSubmissions`/`eventRecaps` created with no validation, can self-approve** — `firestore.rules:119,163-164` — Nothing forces `approved == false` on create; a self-approved recap publishes without review. **Fix:** require `approved == false` / pending status on create.
- **`interviews` read fully public + enumerable** — `firestore.rules:184-185` — `allow read: if true` lets anyone list every token + PII. **Fix:** `allow get: if true; allow list: if isAdmin();`.
- **`wishlists` public read exposes `ownerName`, enumerable** — `firestore.rules:17` — **Fix:** gate `list` behind auth; keep `get` public.

### Low
- **`bookings` open create stores PII** — `firestore.rules:107` — spam vector. **Fix:** validate field shape/length.
- **`monthlyStudents`/`commissions` open create, no validation** — `firestore.rules:137,196`.
- **`product reviews` no rating bounds** — `firestore.rules:53-56` — `rating:999` accepted; `calcAverageRating` (reviews.js:31) trusts it. **Fix:** validate `rating is number && 1..5`.
- **Missing composite index for `commissionRequests` (artistId + createdAt desc)** — `AccountPage.jsx:314-316` will throw missing-index on first run. **Fix:** add to `firestore.indexes.json`.

### Stack notes
- Adopt **custom claims for admin** — single source of truth across `firestore.rules`, `storage.rules`, and all client `isOwner` checks; not spoofable, rotatable without redeploy.
- **Move privileged state transitions to Cloud Functions** (order payment/status, `isPartner`, counters, submission approval) so client rules stay deny-by-default for those fields.
- Make `affectedKeys().hasOnly([...])` field whitelists the default on every user-writable collection (the pattern already used correctly at `firestore.rules:43,189`).

---

## Dimension: Auth & Access Control (client-side)

### Critical
- **Checkout/order amounts fully trusted from client** — `AuthContext.jsx:189-219` (placeOrder), `lib/stripe.js:52-66` (checkoutCart) — Order doc written with client-computed totals and item prices straight from attacker-editable localStorage cart (`CartContext.jsx:9,57-66`). If the CF builds Stripe line items from these values, anyone buys art for $0.01. **Fix:** CF must look up each item price/stock by id from Firestore and recompute everything server-side; client sends only `{productId, qty}`.
- **`aiRequests` job queue client-writable with client-supplied identity** — `lib/aiJob.js:18-32` — Any signed-in client can enqueue arbitrary paid backend work (Anthropic/Discogs/SEO jobs); `uid` is a client-passed param. Cost-abuse/DoS vector. **Fix:** rule `allow create: if request.auth != null && request.resource.data.uid == request.auth.uid`; derive uid inside `runAiJob` from `auth.currentUser`, never as an argument; CF verifies admin for admin-only job types.

### High
- **Profile-load race can clobber a freshly created profile with `null`** — `AuthContext.jsx:39-47` vs `52-71` — On signup/first Google login, the listener's `getDoc` (started before the doc existed) can resolve after `createUserDoc`'s `setProfile`, resetting profile to `null` → onboarding never shows, role checks silently fail until reload. **Fix:** make the listener the single source of truth via `onSnapshot` on `users/{uid}`, or guard with a request-sequence counter.
- **Unhandled rejection in auth listener blank-screens the app** — `AuthContext.jsx:38-50,245` — `await getDoc` has no try/catch; a failed profile read means `setLoading(false)` never runs and `{!loading && children}` keeps the whole site blank. **Fix:** try/finally with `setLoading(false)` in finally.
- **No password reset flow anywhere** — `LoginPage.jsx`, `AccountPage.jsx:31-89` — `sendPasswordResetEmail` is never imported. Forgotten password = permanent lockout. **Fix:** add "Forgot password?" calling `sendPasswordResetEmail(auth, email)`.
- **Admin data fetches run before the owner gate** — `AdminPage.jsx:4006-4015` vs gate at `4300` — The fetch effect runs on mount for every `/admin` visitor (hooks run before the render gate). Whether data returns depends solely on Firestore rules. **Fix:** `if (!isOwner) return` as the first line of every pre-gate effect.
- **Email verification sent but never enforced** — `AuthContext.jsx:100` — `user.emailVerified` is read nowhere; unverified emails can order/submit/receive notifications. **Fix:** gate order placement + art submission on `emailVerified` (email/password users) with a resend button.

### Medium
- **Owner email hardcoded in two divergent places** — `AdminPage.jsx:2855`, `AccountPage.jsx:231` — case-sensitive, can drift. **Fix:** one `isOwnerEmail(user)` helper short-term; custom claim long-term.
- **Any user self-upgrades to creator/seller with zero review** — `AuthContext.jsx:73-94` (switchAccountType) — Unlocks seller dashboard + submit-art (limits are client-enforced only). **Fix:** confirm intent; ensure rules cap what a `creator` can write (submission→product promotion must be admin/server-side).
- **Raw Firebase errors surfaced + account enumeration** — `LoginPage.jsx:56-63` — `auth/invalid-credential` unmapped → raw SDK text; distinct not-found vs wrong-password enables enumeration. **Fix:** map `invalid-credential`, use one generic message.
- **SetupGate strict check skips onboarding for legacy/broken profiles** — `App.jsx:76` (`profile?.profileSetupDone === false`) — Users without the field or with `null` profile never see setup; downstream reads missing `name`/`accountType`. **Fix:** treat `profile && profileSetupDone !== true` as needs-setup (after deciding legacy backfill).
- **Logout performs no local cleanup** — `AuthContext.jsx:116-119`, `CartContext.jsx` — Cart + admin drafts persist across users on a shared device. **Fix:** clear cart + draft keys in `logOut`.

### Low
- **`normalizeTypes` doesn't expand `'both'` inside an array** — `AuthContext.jsx:21-25`.
- **Onboarding fully skippable, leaves empty display name** — `ProfileSetupModal.jsx:56-76` → nameless orders. **Fix:** make name step non-skippable or fall back to email local-part.
- **No password policy beyond Firebase 6-char min, no confirm field** — `LoginPage.jsx:137-141`.
- **Public wishlist doc leaks display name by design** — `AuthContext.jsx:162-171` — users not told. **Fix:** UI copy or write `ownerName` only on explicit share.
- **AccountPage sign-in error always says "Incorrect email or password"** even for network failures — `AccountPage.jsx:44-46`. **Fix:** branch on `err.code`.
- **`from` redirect state never set** — `LoginPage.jsx:26`.

### Stack notes
- Adopt **Firebase custom claims** for admin (works in rules + client).
- The real boundary is `firestore.rules` — client patterns (client-priced orders, open `aiRequests`/`checkoutRequests`, self-assigned roles) assume rules compensate; rules + Functions are the highest-value follow-up.
- Add a `<RequireAuth>` wrapper route component (plain react-router) so `/account`, `/submit-art`, `/admin` share one redirect behavior; switch AuthContext to `onSnapshot` to kill the profile-race class.

---

## Dimension: Cloud Functions (hygiene & security — payment logic excluded)

### Critical
- **`sendStudentInvite` has NO authentication** — `functions/index.js:794-829` — `https.onCall` never checks `context.auth`/admin. Open spam relay: anyone can send "You've been invited" emails from `orders@artsaturated.com` to any address. **Fix:** `if (context.auth?.token?.email !== OWNER_EMAIL) throw new HttpsError('permission-denied', ...)` at the top.
- **Anthropic API key shipped to the browser** — `src/components/VinylGrader.jsx:102-104` — `new Anthropic({ apiKey: VITE_ANTHROPIC_API_KEY, dangerouslyAllowBrowser: true })`. Fully extractable → unbounded billing abuse. (Currently dormant: placeholder key + orphan component, but a loaded landmine.) **Fix:** delete the component / move grading to a Firestore-triggered function; rotate the key.

### High
- **SSRF via AI image fetch (`quickfill`)** — `functions/index.js:1140-1155` — `await fetch(imageUrl)` on a client-supplied URL with no scheme/host validation; will fetch `http://169.254.169.254/...` and base64 it into the prompt. (`aiRequests` create is admin-gated, but no defense-in-depth.) **Fix:** require `https:` + allowlisted host (your Storage bucket); cap response size.
- **`onCheckoutRequestCreated` writes raw `err.message` to a client-readable doc** — `functions/index.js:300-301` — Stripe/internal error strings leak to the buyer (rule at `firestore.rules:23`). **Fix:** write a generic message; keep details in `console.error`.
- **Shippo callables expose raw errors + only check `context.auth` (not admin)** — `functions/index.js:1074,1118` — `getShippingRates`/`purchaseShippingLabel` forward raw Shippo error text and let any logged-in user purchase real labels (spends money) for any orderId. **Fix:** gate both on admin; generic error strings.

### Medium
- **`.env` files unprotected, no `.gitignore`** — root `.env` (FIREBASE_TOKEN, VITE_ANTHROPIC_API_KEY, Stripe/EmailJS) + `functions/.env` (SENDGRID, STRIPE_SECRET, STRIPE_WEBHOOK_SECRET, SHIPPO, DISCOGS). **Fix:** `.gitignore` before any git init; migrate to Firebase Secret Manager.
- **`stripeWebhook` returns raw error text** — `functions/index.js:316` — low sensitivity (Stripe-only caller) but leaks internals. **Fix:** static 400 body.
- **No idempotency on `stripeWebhook` / triggers → duplicate effects** — `functions/index.js:319-438` — Stripe retries + at-least-once delivery double-decrement stock / resend emails. **Fix:** record processed `event.id` in a `processedEvents` doc; make stock writes conditional on `paymentStatus !== 'paid'`.
- **`onTeachingRatesUpdated` self-write re-trigger loop** — `functions/index.js:448-475` — only saved by an early-return; fragile. **Fix:** explicit guard on which fields changed.
- **`configSnap.exists()` called as a method (it's a property)** — `functions/index.js:256,596,1033` (correct at `:65`) — throws `TypeError`; at `:256` it's swallowed (bundle discount silently dropped), at `:596,1033` unguarded. **Fix:** use property form `configSnap.exists` everywhere.

### Low
- **Verbose `console.log` of secret presence + Stripe IDs** — `functions/index.js:58,194,275,285,297`.
- **Discogs detail fetch puts token in query string** — `functions/index.js:1527,1573,1586` — lands in proxy logs. **Fix:** use the auth header consistently.
- **`sharp` + `stripe` required at module top → every cold start** — `functions/index.js:1-6` — only `watermarkSubmission` needs `sharp`. **Fix:** lazy-require inside that function; set a default region.
- **Dead/legacy:** `fetchFacebookEvent` no longer exists (scope note stale); client `lib/stripe.js` HTTPS-checkout fns have no callers (checkout is Firestore-trigger based) — clean up any lingering deployed versions.

### Stack notes
- **Gen1 → Gen2 migration:** whole file uses `firebase-functions/v1` while package pins `^7.2.5` + Node 22. Gen2 gives concurrency, better cold starts, first-class `defineSecret`.
- **Secrets → Secret Manager** (`defineSecret`) replaces `functions/.env`.
- The Firestore-doc-relay pattern (to dodge the org's domain-restricted callable-invoker policy) is reasonable, but means **all auth lives in rules with zero in-function defense** — the genuine callables (`sendStudentInvite`, Shippo pair) must each do their own admin checks.

---

## Dimension: Dead Code & Repo Hygiene

### Critical
- **Project not under version control** — no `.git`, no `.gitignore`; only "backup" is OneDrive, which also syncs `node_modules/` + `dist/` (Windows file-lock/corruption risk). **Fix:** `.gitignore` → `git init` → commit → push private remote; consider moving out of OneDrive.
- **Client Anthropic SDK + browser-exposed key in orphan** — `src/components/VinylGrader.jsx:2,103-104` — zero importers (not currently bundled) but a landmine. **Fix:** delete component, remove `@anthropic-ai/sdk` from package.json, remove `VITE_ANTHROPIC_API_KEY`, rotate the key.

### High
- **Orphaned components (zero importers)** — `VinylGrader.jsx`, `ArtScribble.jsx`, `VintageFuzz.jsx` (plus known `SplashPage.jsx`, `AdminPage_BlogPanel.jsx`, `lib/emailjs.js`). **Fix:** delete all.
- **Unused client dependencies** — `@anthropic-ai/sdk` (orphan only), `@stripe/stripe-js` (zero imports; checkout is Firestore-doc based), `react-image-crop` (CropModal is custom canvas). **Fix:** `npm uninstall @anthropic-ai/sdk @stripe/stripe-js react-image-crop`. (`@zxing/browser` IS used.)
- **Image-upload pattern duplicated ~11×** — `data/storage.js:98` exports `uploadProductImage`, but the `ref→uploadBytes→getDownloadURL` sequence is re-implemented inline at `CommissionForm.jsx:166`, `EventsSection.jsx:51`, `ProfileAvatar.jsx:29`, `AccountPage.jsx:381`, `AdminPage.jsx:1087,1413,3322`, `BlogSubmitPage.jsx:92`, `EventDetailPage.jsx:104`, `EventsPage.jsx`, `QuoteRequestPage.jsx`, `SubmitArtPage.jsx`. **Fix:** one `uploadImage(file, pathPrefix)` helper in `src/lib/`.
- **AdminPage.jsx is 5,620 lines with 18 inline panels** — extraction candidates (line ranges): InterviewsPanel 120-455, AiUsagePanel 456-573, SeoArticleGenerator 574-713, SpotlightGenerator 714-771, BlogSubmissionsPanel 772-973, ArticleManager 974-1367, MagazineAdminPanel 1368-1385, EventsPanel 1386-1897, OrdersPanel 1898-2341, SubmissionsPanel 2342-2673, FeedbackPanel 2674-2740, CDOrdersPanel 2741-2854, TeachingPanel 2858-2992, StoreConfigPanel 2993-3272, AlbumPreordersPanel 3280-3458, PreordersPanel 3459-3697, PartnershipsPanel 3698-3794, UsersPanel 3795-3890, main product-CRUD 3892-5620. **Fix:** extract to `src/pages/admin/`, lazy-load per tab.

### Medium
- **Dead exports** — `archive.js:21 updateArchiveItem`, `products.js:7 products[] / :13 getProductBySlug`, `storage.js:31 formatSubmissionNumber`, `tasks.js:50 updateTask`; drop `export` from internal-only `getPublicArtists` (artists.js:5), `getDefaultAvailableSlots` (booking.js:104), `getNextItemNumber` (storage.js:27). **Fix:** delete; move `CATEGORIES` to a constants file.
- **Owner email hardcoded in 4 places** — `AccountPage.jsx:231`, `AdminPage.jsx:2855`, `functions/index.js:1645`, `firestore.rules:6`. **Fix:** export one `OWNER_EMAIL`/`isOwner(user)`.
- **Date-formatting helper duplicated 15+×** — `AdminPage.jsx:157,824,1002,1527,2020,3550,3815`, `ArticlePage.jsx:8`, `BookingPage.jsx:6`, `DailyPlanner.jsx:6`, `EventsSection.jsx:12`, `StudentsPanel.jsx:272`, `scheduleUtils.js:29`; `fmtTime` triplicated at `AvailabilityManager.jsx:20`, `ScheduleManager.jsx:30`, `BookingPage.jsx:13`. **Fix:** `src/lib/format.js` with `fmtDate`/`fmtTime`/`money`.
- **No shared currency formatter** — 49 `toFixed(2)` sites across 9 files. **Fix:** `money(n)` in format.js.
- **Root clutter** — `files.zip` (18KB) + `files_extracted/` (old v1 scaffold — DELETE), `package-lock.json` (91 bytes empty — DELETE), `start-ng.bat` (launches a different project — move/delete).
- **Project clutter** — `New folder/` (empty), `replace_greys.ps1` (applied), `firestore-debug.log`, `scripts/fix-vinyl-renaissance-typo.mjs` (one-time, run) — DELETE; `dist/`, `.firebase/` — keep but gitignore.

### Low
- **Stale env vars** — `VITE_EMAILJS_*` (retired) + `VITE_STRIPE_PUBLISHABLE_KEY` (no client Stripe.js) referenced nowhere. **Fix:** remove.
- **Debug console.log in prod paths** — `ArtCarousel.jsx:35`, `storage.js:57`, `lib/stripe.js:24`, `ArtistProfilePage.jsx:49` (only 4; codebase otherwise clean). **Fix:** remove.
- **No >10-line commented-out blocks** — None found.

### Stack notes
- The Firestore-trigger request/response pattern is sound and consistent — keep it; never reintroduce client-side SDKs with secrets.
- Get git + `.gitignore` in place BEFORE any refactor (splitting a 5,600-line file with OneDrive as the only safety net is the biggest operational risk).
- Add ESLint with `no-unused-vars` / `import/no-unused-modules` to catch the dead-export class automatically.

---

## Dimension: Build & Deployment Config

### Critical
- **No version control on a live payments site** — zero history/rollback, no diff trail for security-sensitive rules. **Fix:** `.gitignore` FIRST (incl. `.env*`, `node_modules/`, `dist/`, `.firebase/`, `firestore-debug.log`, `functions/node_modules/`), then `git init && commit`, push private same day.
- **Live Firebase deploy token in plaintext `.env`** — `.env:1 FIREBASE_TOKEN` (103-char real value, full deploy rights) sits beside public VITE_ vars. **Fix:** gitignore before any commit; revoke + use interactive `firebase login` or a service account. Nothing in scripts reads it — delete the line.

### High
- **Anthropic key wired into client bundle with `dangerouslyAllowBrowser`** — `VinylGrader.jsx:103-104` + `package.json:16` — dormant (placeholder + tree-shaken) but a landmine. **Fix:** delete `@anthropic-ai/sdk`, drop `VITE_` prefix, implement grading as a Cloud Function.
- **Project inside OneDrive sync with 289 MB node_modules** — file-lock errors during install/build, hashed-asset churn, possible silent `dist` corruption. **Fix:** after git+remote, move to a non-synced path (e.g. `C:\dev\art-saturated`).
- **No lint, formatter, tests, or CI** — zero eslint/prettier configs, zero test files, no `test` script. **Fix:** `eslint @eslint/js eslint-plugin-react-hooks prettier vitest`, flat `eslint.config.js`, `lint`/`test` scripts, 2-3 smoke tests, a 10-line GitHub Actions workflow.

### Medium
- **`npm run deploy` only ships hosting** — `package.json:12` — never deploys `firestore.rules` (edited Jun 8), `storage.rules`, indexes, or functions; bare `firebase deploy` ships a stale `dist/` (no predeploy hook). **Fix:** add `"predeploy": ["npm run build", "npm run gen-sitemap"]` to hosting; add `deploy:all` + `deploy:rules` scripts.
- **og:image points to a non-existent file** — `index.html:18,24,33` → `/og-image.jpg` not in `public/`. Every social share has a broken preview. **Fix:** add a 1200×630 `og-image.jpg`.
- **Render-blocking Google Fonts + unused Inter family** — `index.html:55-60` — `Inter:wght@700` referenced nowhere (tokens are Playfair + DM Mono). **Fix:** drop Inter; make stylesheet non-blocking.
- **Toolchain a major (or two) behind** — Vite 5.4 (→7.x, dev-server CVEs patched in 6/7), React 18.3 (→19), Tailwind 3.4 (→4). **Fix:** Vite+plugin-react first, React 19 next, defer Tailwind 4.
- **No `engines` field in root package.json** — functions pin Node 22, root doesn't. **Fix:** `"engines": {"node": ">=22"}` + `.nvmrc`.

### Low
- **`server.host: true` exposes dev server to LAN** — `vite.config.js:6-8` — fine for phone testing on home wifi, risky on public nets. **Fix:** acceptable; consider a `dev:lan` script.
- **Dead one-off scripts/debris** — `scripts/fix-vinyl-renaissance-typo.mjs`, `replace_greys.ps1`, `firestore-debug.log`, `New folder/`, parent-dir junk.
- **Dep hygiene** — `@zxing/browser` 0.2.x pre-1.0/unmaintained (pin exactly); `firebase-admin` ^12 has a v13.

### Stack notes
- **Order of operations:** `.gitignore` → revoke/remove `FIREBASE_TOKEN` → `git init` + private remote → move out of OneDrive. Everything else is unsafe before history exists.
- Vite config is otherwise healthy (no prod sourcemaps, sane manualChunks, 2.3 MB dist; Firebase gzips). Biggest config win is the `predeploy` hook.
- Upgrade path: Vite 7 + plugin-react 5 now; React 19 next; Tailwind 4 + React Router 7 as separate migrations.
- Env split is otherwise correct — all `VITE_` vars are genuinely public-safe except the two outliers (`FIREBASE_TOKEN` wrong file, `VITE_ANTHROPIC_API_KEY` secret-shaped name).

---

## Dimension: Secrets & Keys

### Critical
None in the **shipped bundle** — verified `dist/assets/*.js` (built 2026-06-07) contains no `sk-ant`, `sk_live`, `SG.`, `shippo_`, `whsec_`, or Firebase CI token. Only the Firebase web API key (`AIzaSy…`, public-safe). The "Anthropic key in browser" is real as a *pattern* but no live key is exposed today.

### High
- **Latent Anthropic exposure** — `VinylGrader.jsx:102-104` — `.env:14` holds placeholder `your_key_here`; component is orphaned + absent from `dist`. Ships the moment a real key is pasted + component wired. **Fix:** delete component / move server-side; never `VITE_`-prefix an Anthropic key.
- **Firebase CI deploy token in plaintext, unused** — `.env:1 FIREBASE_TOKEN=1//01s…` — full deploy rights, no script consumes it, max blast radius. **Fix:** revoke (Google Account → Security → Third-party access, or `firebase logout --token`) and delete the line.
- **Live Stripe + SendGrid keys in plaintext inside OneDrive-synced folder** — `functions/.env:1-3` (SendGrid key, live Stripe secret key, Stripe webhook secret — prefixes redacted) — correct server placement, but OneDrive replicates them to Microsoft's cloud + every synced device; an accidental `git init && push` publishes them. **Fix:** migrate to Secret Manager, remove from synced tree, rotate (below).

### Medium
- **Discogs token** — `functions/.env:5 aItnLX…` (server-only use, `functions/index.js:1510`). **Fix:** Secret Manager; regenerate.
- **No `.gitignore` anywhere** — all three `.env` files commit by default. **Fix:** add before any git init.

### Low
- **Shippo key is test-mode** — `functions/.env:4 shippo_test_…` (no spend).
- **Dead EmailJS config** — `.env:10-12 VITE_EMAILJS_*` (public-safe, unused). **Fix:** delete.
- **Unused Stripe publishable key** — `.env:7 pk_live_…` (public-safe, not even referenced).
- **`files_extracted`/`files.zip` clean** — early scaffold, only a `pk_test_…` placeholder in README. No secrets.

Hardcoded-credential greps of `src/` and `functions/index.js` fallbacks: **clean** (only a benign project-id fallback at `functions/index.js:1130`).

### Rotation list (ordered — exposure-hygiene, not confirmed leaks)
1. **FIREBASE_TOKEN** (`1//01s…`) — revoke now; unused, full deploy.
2. **STRIPE_SECRET_KEY** (`sk_liv…`) — Stripe Dashboard → roll key → update Secret Manager → redeploy functions.
3. **STRIPE_WEBHOOK_SECRET** (`whsec_…`) — roll with #2.
4. **SENDGRID_API_KEY** (`SG.plg…`) — delete + recreate (scope to Mail Send only).
5. **DISCOGS_TOKEN** (`aItnLX…`) — regenerate.
6. **VITE_ANTHROPIC_API_KEY** — only if a real key was ever placed there + deployed.
7. **SHIPPO_API_KEY** — test token, no urgency.

(Firebase web key, Stripe publishable, EmailJS public: public-safe, no rotation.)

### Stack notes
- Adopt **Firebase Secret Manager** for all five functions secrets.
- `.gitignore` covering `.env*` + `dist/` before any git init; consider moving out of OneDrive.
- The only correct home for AI calls is a Cloud Function — Gemini already routes through Vertex (`AdminPage.jsx:511`); VinylGrader should follow or be deleted.

---

## Dimension: Data Layer

### Critical
- **Double-booking race in `saveBooking`** — `data/booking.js:232-265` — Not transactional; two users both pass the client `bookedSet` check and each `addDoc` a `slots` doc → both bookings succeed for the same slot. Real slots get a blind `updateDoc({booked:true})` with no prior read. **Fix:** deterministic slot id (`slots/${date}_${time}`) created inside `runTransaction` (fail if exists+booked); back with a rule preventing `booked:false→true` re-flips.
- **Entire products collection downloaded by five surfaces** — `data/storage.js:35-72` — `fetchAllProducts()` (no where/limit) backs `fetchShopProducts`/`fetchRecentArt`/`fetchMysteryProducts` + direct calls in `HomePage.jsx:91`, `ProductPage.jsx:317`, ArtCarousel, `AdminPage.jsx:4009`. Every public page downloads every product (incl. inactive/sold/bucket), 3-4× per browse session. **Fix:** `where('active','==',true)` + category where + limit variants (+ composite indexes); `where('slug','==',slug) limit(1)` for ProductPage; wrap in a cache.

### High
- **Missing composite indexes for two shipped queries** — `AuthContext.jsx:231` (`fetchSellerOrders`: orders sellerId + createdAt desc), `booking.js:328` (`getLessonNotes`: lessonNotes studentEmail + createdAt desc) — absent from `firestore.indexes.json`; throw `failed-precondition` at runtime → seller dashboard + lesson notes silently break. **Fix:** add both indexes.
- **`getAvailableDates` + `calcRealisticCompletion` download all slots + blockedTimes ever** — `booking.js:192-197`, `scheduleUtils.js:86-94` — incl. years of past records; the commission calculator re-runs the full double-download on every size/medium change. **Fix:** `where('date','>=',todayStr())`; debounce/cache the calculator.
- **Admin user search re-downloads entire users collection per keystroke** — `AdminPage.jsx:3489` (`searchUsers`), plus full downloads at `3706` (Partnerships) + `3802` (UsersPanel). **Fix:** fetch once + cache; use `where()` for partnerships.
- **UTC-vs-local "today" hides tonight's events every evening** — `events.js:10,28` — `new Date().toISOString().split('T')[0]` (UTC) vs local event dates; after ~4-8 PM local an event happening tonight shows as past. **Fix:** use the local `todayStr()` helper everywhere; delete the `toISOString` variant.
- **Silent-empty / infinite-spinner on storefront pages** — `ShopPage.jsx:27`, `HomePage.jsx:91`, `AdminPage.jsx:4009`, `MysteryPage.jsx:64` (no catch → infinite spinner + unhandled rejection); `blog.js:36`, `artists.js:39` catch-to-empty. **Fix:** add error state + retry UI.
- **Orphaned Storage files on every delete/replace** — `storage.js:92-94`, `archive.js:27`, `events.js:84,179` — no `deleteObject` anywhere; replacing a product image orphans the old one. Storage grows monotonically. **Fix:** store the storage path alongside `imageURL`; `deleteObject` in delete/replace helpers.

### Medium
- **`fetchArticleBySlug` downloads every approved article (full bodies) to find one** — `blog.js:42-45`. **Fix:** `where('status'==='approved') + where('slug'==slug) + limit(1)`; split body out for list queries.
- **`active` flag has opposite missing-value semantics** — `storage.js:43` (`!== false` = active) vs `artists.js:94` (`!p.active` = inactive) — a product without `active` shows in shop but is invisible on artist directory/profile. **Fix:** standardize on `!== false`.
- **Image field written under 4 names, read with divergent fallbacks** — `AdminPage.jsx:4270-4272` writes `image`+`imageURL`+`imageURLs`; readers each invent priority (`artists.js:92-98`, `ProductPage.jsx:31,39`, `FloatingProductColumn.jsx:130-132`, `CartPage.jsx:181`); `images` read but never written. **Fix:** canonicalize on `imageURLs` with a shared `primaryImage(p)`.
- **`updateEvent`/`updateSubmission` destructive full-overwrites** — `events.js:64-82,183-199` — `fields.x || ''` blanks omitted fields; `requestEventEdit` drops `flyerURL`. **Fix:** build update from present keys only.
- **`cancelBooking` non-atomic, order-fragile** — `booking.js:267-270`. **Fix:** `writeBatch`; tolerate missing slot.
- **Cart localStorage: no schema version, stale-on-error revalidation** — `CartContext.jsx:57-66`, `CartPage.jsx:41-74` — only `Array.isArray` check; `ADD_ITEM` spreads the whole product doc (quota risk); revalidation `catch{return item}` keeps stale price exactly when Firestore can't confirm; no cross-tab sync. **Fix:** `{v:1, items}` + per-item shape validation; whitelist persisted fields; fail closed on revalidation error.
- **No client cache / no Firestore persistence** — `firebase.js:19` — every navigation refetches everything. **Fix:** TanStack Query (staleTime ~5 min, invalidate on mutations) and/or `persistentLocalCache`.
- **Unbounded admin order/commission/booking fetches** — `AdminPage.jsx:1945-1946`, `booking.js:221-225`, `AdminPage.jsx:995,3292` — grow forever, one-shot (admin sees stale `pending` after webhook). **Fix:** `limit(100)` + cursor pagination; `onSnapshot` for the open-orders view.
- **Most write helpers throw raw Firestore errors to UI** — `storage.js:74-94`, `archive.js:13-28`, `tasks.js:30-58`, `booking.js:124-159`. **Fix:** one contract (typed throws; pages catch + toast).

### Low
- **Dead `products.js` stub exported** — `products.js:7-15`.
- **MessageThread swallows all listener errors** — `MessageThread.jsx:30` (`onSnapshot(..., () => {})`). **Fix:** distinguish `permission-denied`; surface the rest. (Cleanup/unsubscribe is correct here and in `stripe.js:35`, `aiJob.js:34`.)
- **`fetchRecentArt` ships a console.log per home load** — `storage.js:57`.
- **Per-doc `getDoc` loop in cart validation** — `CartPage.jsx:46-60` — fine now; `where(documentId(),'in',ids)` is one round-trip.
- **`getArtistWork` filters `status==='approved'` client-side** — `artists.js:32-40`. **Fix:** `where('status'==='approved')`.
- **Upload validation is `accept` attribute only** — `storage.js:98-102` + all call sites — no size/MIME re-check. **Fix:** shared `validateImageFile(file, maxMB)`.

### Stack notes
- **TanStack Query is the single highest-leverage adoption** — fixes duplicate fetches, stale admin lists, error/retry UX, and mutation-driven invalidation in one move.
- Index-avoidance is a design theme (`storage.js:48` comment, blog client-sort, artists client-filter); adding ~6 missing indexes removes the rationale for nearly every full-collection fetch.
- Consider `persistentLocalCache` for cheap offline tolerance on catalog-heavy public pages.

---

## Dimension: SEO & Metadata

### Critical
- **Crawlers/social scrapers see an empty `#root` — no SSR/prerender** — `firebase.json:10`, `index.html:63` — Firebase serves only `<div id="root">` + JS for all routes. Facebook/LinkedIn/Pinterest don't execute JS → every product/article/artist/event share falls back to the generic homepage card; Google indexing of Firestore-driven pages is slow/unreliable. `meta.js:4` admits "Facebook/LinkedIn require SSR." **Fix:** crawler-targeted dynamic prerender (Cloud Function + puppeteer / prerender.io, gated by UA in `firebase.json` rewrites); at minimum prerender `/shop/:slug` + `/magazine/:slug`.
- **`og:image` referenced site-wide does not exist** — `index.html:18,24,33`, `meta.js:9` → `/og-image.jpg` absent from `public/`. **Fix:** add 1200×630 `og-image.jpg`.

### High
- **`/` (canonical + sitemap homepage) immediately redirects to `/home`** — `App.jsx:171`, `index.html:8`, `public/sitemap.xml:3` — `/home` is not in the sitemap and not canonicalized; splits homepage signals. **Fix:** serve HomePage directly at `/` (preferred).
- **ArtistProfilePage sets no metadata** — `/artists/:uid` (in sitemap) keeps the static homepage title/OG. **Fix:** `setPageMeta({title:artist.name, description, image:artist.photoURL, url})` + cleanup.
- **EventDetailPage sets only `document.title`** — `EventDetailPage.jsx:60,65` — no OG/Twitter/description; event shares get the generic card. **Fix:** `setPageMeta({..., image:event.flyerURL})`.
- **No per-page structured data (Product/Article/Event/Breadcrumb)** — only the static `ArtGallery`/LocalBusiness block in `index.html:28-54`. Forfeits price/in-stock/article/event rich results. **Fix:** emit route-appropriate JSON-LD (server-prerendered).

### Medium
- **`og:type` hardcoded `product` for every caller** — `meta.js:46` — articles/listings advertise as products. **Fix:** parameterize (default `website`).
- **Soft-404 returns HTTP 200 with no noindex** — `firebase.json:10`, `App.jsx:200-208`. **Fix:** `noindex` on the catch-all + not-found states.
- **Sitemap generated into `dist/` only on `deploy`, not `build`** — `scripts/gen-sitemap.mjs:36`, `package.json:9,12` — a plain build publishes the stale static 8-URL `public/sitemap.xml`. **Fix:** wire `gen-sitemap` into `build`/`postbuild`.
- **No `lastmod` in sitemap** — `gen-sitemap.mjs:28`. **Fix:** add from `updatedAt`/`publishedAt`.
- **ProductPage meta description can cut mid-word / include markdown** — `ProductPage.jsx:341-343`. **Fix:** trim to word boundary, strip markup.

### Low
- **Artist hero uses `alt=""` on a meaningful banner** — `ArtistProfilePage.jsx:182`. **Fix:** describe the artist if meaningful.
- Single-h1 hierarchy generally clean (spot-checked Home/Shop/Product/About); `robots.txt`, `lang`, viewport correct.

### Stack notes
- **Prerendering is the single highest-leverage fix** — `meta.js`'s imperative approach only helps JS-capable scrapers. A crawler-targeted dynamic prerender unblocks per-page JSON-LD + OG for non-JS scrapers.
- **Replace hand-rolled `meta.js` with `react-helmet-async`** — declarative per-route tags + JSON-LD, no `resetPageMeta` race.
- Per-route JSON-LD via a shared component (Product/Article/Event/Breadcrumb) through Helmet.

---

## Dimension: Performance

### Critical
- **Full-resolution images shipped everywhere — no resize/srcset/CDN** — `data/storage.js:98-102` (`uploadProductImage` stores raw file) — every consumer renders the original: ProductCard (~240px), ArtCarousel (~180px), FloatingProductColumn (128px), ArtistProfilePage masonry. A 12-product grid can pull 30-50 MB to paint 240px boxes. **Fix:** Firebase "Resize Images" extension (or canvas-resize on upload) + `srcset`/`sizes`. Single biggest runtime win.

### High
- **ShopPage runs two full-viewport rAF canvases + a third, none visibility-gated** — `ShopPage.jsx:5-6` (FloraRoots + DrawingCanvas), `VintageFuzz.jsx:31` (≈6k fillRect/frame + 600ms setInterval) — burn CPU/GPU in background tabs, drain mobile battery. **Fix:** pause on `visibilitychange` + IntersectionObserver; throttle VintageFuzz to ~20fps.
- **Context provider values recreated every render → whole-tree re-render** — `AuthContext.jsx:236-244`, `CartContext.jsx:95-97`, `ThemeContext.jsx:20` — any cart/theme/profile change re-renders every consumer. **Fix:** `useMemo` the value, `useCallback` the functions.
- **`@anthropic-ai/sdk` heavy lib imported in dead component** — `VinylGrader.jsx:2,102-104`. **Fix:** delete (also a secrets fix).

### Medium
- **No `React.memo` on ProductCard** — `ProductCard.jsx:28`, `ProductGrid.jsx:65` — every search keystroke re-renders all cards (each recreates large inline styles + per-card SVG turbulence in vintageMode). **Fix:** `memo(ProductCard)`; hoist static styles.
- **ArtistProfilePage masonry images lack `loading="lazy"`** — `ArtistProfilePage.jsx:279,208,183`. **Fix:** add `loading="lazy"` + `decoding="async"`.
- **Home pulls the products collection twice** — `HomePage.jsx:8` + `ArtCarousel.jsx:33` both call `fetchAllProducts`. **Fix:** pass products down to ArtCarousel; add an in-memory cache.
- **Render-blocking Google Fonts (3 families/7 weights)** — `index.html:62-66` — `display=swap` is set (good) but the `<link>` blocks first paint. **Fix:** self-host woff2 subset + `preload`.

### Low
- **`og-image.jpg` missing** — `index.html:18,24`.
- **`shuffle` + array spreads run on every HomePage render** — `HomePage.jsx:10-17`. **Fix:** `useMemo`.
- **GA4 injected eagerly** — `App.jsx:148-159`. **Fix:** defer to idle/first interaction. (Stripe is correctly lazy via Firestore flow.)

### Stack notes
- **Image pipeline is the headline fix** — without resize, every other perf gain is dwarfed by oversized originals.
- **Context-splitting + memoization** — split rarely-changing slices (auth fns, theme) from frequently-changing (cart); memoize all three provider values.
- Virtualization (`react-window`/`@tanstack/react-virtual`) not urgent (collections small + "Load more"), but add it to ShopPage + admin lists as the catalog grows; pair with a client cache.

---

## Dimension: Accessibility (WCAG)

### Critical
- **Product cards not keyboard-operable** — `ProductCard.jsx:33,77,133,201` — `<article onClick={navigate}>` with no `tabIndex`/`role`/key handler/anchor. Keyboard + screen-reader users cannot reach or activate any product. **Fix:** wrap in `<Link to={/shop/${slug}}>` (preferred) or `role="link" tabIndex={0}` + Enter/Space `onKeyDown`.
- **Lightbox + modals: no dialog role, no focus trap, no Escape, no focus restore** — `ArtistProfilePage.jsx:439-449`, `ProfileSetupModal.jsx:80-93`, `CropModal.jsx:~330-448`. **Fix:** `role="dialog" aria-modal="true"` + focus trap + Escape + focus restore (`focus-trap-react` or Radix/Headless UI Dialog).

### High
- **warm-gray (#8a857d) body/secondary text fails AA contrast** — 360 occurrences across 29 files (`Navbar.jsx:31,72,104`, ProductCard, CartPage, `App.jsx:32,204`) — **~3.1:1** on cream, **~3.0:1** on offwhite (need 4.5:1). **Fix:** darken the token to ~#6f6a61 (~4.6:1) or reserve warm-gray for large text only.
- **earth (#a08060) prices/accents fail even large-text contrast** — `ProfileSetupModal.jsx:103,179,188`, step counters, `index.css` focus ring — **~2.6:1** on cream (fails 4.5 and 3.0). Prices are critical info. **Fix:** use #8a5c3a (~5.6:1) for text; keep #a08060 decorative only.
- **Form inputs have no associated labels** — `LoginPage.jsx:128-141` (placeholder-only), `ProfileSetupModal.jsx:117,182,191`, CommissionForm, `BookingPage.jsx:241-259,403-421`, `EventsSection.jsx:330,342`, `ShopPage.jsx:141`, admin forms. **Fix:** `<label htmlFor>`/`id` or `aria-label` on every input/textarea/select.
- **Form errors not programmatically associated/announced** — `LoginPage.jsx:158-162` (no `role="alert"`, no `aria-describedby`/`aria-invalid`), `CropModal.jsx:430`. **Fix:** `role="alert"` on the error container + `aria-describedby` + `aria-invalid`.
- **Mobile drawer: no focus management; off-screen links stay focusable** — `Navbar.jsx:143-165` — always in DOM (translated off-screen), so 8+ links stay in tab order when hidden; no trap, no Escape, no focus restore. **Fix:** `inert`/`aria-hidden` + `tabIndex={-1}` when closed; trap + Escape + restore when open.

### Medium
- **Tab interfaces lack tab roles** — `AccountPage.jsx:459-471` + AdminPage panels — plain `<button>`s, zero `role="tab"`/`aria-selected` anywhere. **Fix:** tablist/tab/tabpanel roles + roving tabindex, or an accessible tabs primitive.
- **No SPA route-change announcement** — `App.jsx:92-97,164` — `ScrollToTop` scrolls but doesn't update title or move focus. **Fix:** set per-route `document.title` + focus the `<h1>`.
- **No skip-to-content link** — `App.jsx:161-216`. **Fix:** visually-hidden-until-focused skip link → `id="main"`.
- **Sliders/icon controls lack accessible names** — `CropModal.jsx:351-356`, `CommissionForm.jsx:317-321`. **Fix:** `aria-label` on each.
- **Cart updates not announced** — `Navbar.jsx:91-95` (Toast at `Toast.jsx:12` correctly uses `aria-live="polite"`; the inline toast at `ArtistProfilePage.jsx:434` is a plain div). **Fix:** route ad-hoc toasts through the shared live region.

### Low
- **`focus:outline-none` widespread but globally mitigated** — ~30 inputs; global `:focus-visible` ring at `index.css:59-62` survives. **Fix:** standardize on `focus-visible:` variants.
- **warm-gray-light (#c5bfb5) borders ~1.4:1** (below 3:1 for UI boundaries) — acceptable since focus darkens to border-ink. **Fix:** consider a darker default field border.

### Stack notes
- Add **`eslint-plugin-jsx-a11y`** — would auto-flag missing labels, `<article onClick>`, missing alt, missing button names. (Image `alt` coverage is actually good; gaps are interactivity, labels, modals, contrast.)
- Adopt **Radix UI / Headless UI** for dialog/drawer/tabs/lightbox — focus trap, Escape, restore, `aria-modal`, tablist semantics for free.
- **No `prefers-reduced-motion` anywhere** (0 matches) despite animated canvases + scroll-driven gradient (`App.jsx:128-138`). **Fix:** add a `@media (prefers-reduced-motion: reduce)` block.

---

## Dimension: Admin Panel — Part 1 (lines 1-2855)

### Critical
- **Event delete has no confirmation** — `AdminPage.jsx:1481` (handler) / `:1801` (button) — `handleDelete(ev.id)` → `deleteEvent` → `deleteDoc` with NO `window.confirm`; one-tap permanent loss (dangerous on iPhone). **Fix:** `if (!window.confirm(...)) return`.
- **Submission approval can orphan a product on partial failure** — `AdminPage.jsx:2375-2402` — `addProduct` (creates live product) then a separate `updateDoc(submissions/{id})`; if the second write fails, the product is live but submission stays pending → re-approve creates a duplicate. Same at `syncToShop` (2421-2444). **Fix:** roll back the created product on updateDoc failure, or surface "created but link failed — do not re-approve."

### High
- **No manual order status workflow (pending → ready/completed)** — `AdminPage.jsx:2049-2295` — `statusColor` defines ready/completed but the only status actions are Cancel/Archive/Buy-Label(shipped). A pickup order stays `pending` forever. **Fix:** add Mark Ready / Mark Completed buttons for non-shipping orders.
- **Commission status writes: no error handling, no rollback** — `AdminPage.jsx:2323-2331` — `updateDoc(...).then(setState)` inline, no catch; failed write silently does nothing. **Fix:** try/catch + alert.
- **setState after async with no unmount guard** — `AdminPage.jsx:1916-1940,2013-2018` — Shippo callables setState after navigation. **Fix:** `mounted` ref / AbortController.

### Medium
- **InterviewsPanel resend can't tell success from queued** — `AdminPage.jsx:235-244` — alerts "resent!" on the Firestore write, but the email is a server trigger whose failure is invisible. **Fix:** "queued" wording.
- **FeedbackPanel `load()` no try/catch → perpetual "Loading…"** — `AdminPage.jsx:2680,2694-2703` — `feedback` has no rules (will reject). **Fix:** try/catch/finally.
- **CDOrdersPanel `setStatus` no error handling** — `AdminPage.jsx:2746-2761` — `quoteRequests` has no rules → silent reject + wrong optimistic UI. **Fix:** try/catch + revert.
- **Optimistic updates never roll back** — `AdminPage.jsx:798,810,2462,2479,2691,2760` — several have no catch; rejected write leaves UI diverged from Firestore. **Fix:** revert on catch + error.

### Low
- **Approved blog submissions never get a slug** — `AdminPage.jsx:794-799` → ugly `/magazine/<random-id>` URLs. **Fix:** `slugify(sub.title)` on approve.
- **Recap photo collectionGroup query fragile** — `AdminPage.jsx:1453-1466,1514,1522` — derives eventId from path; mixes in any other `photos` subcollection. **Fix:** store `eventId` on the photo doc.
- **InterviewsPanel "Generate Draft" only for `status==='responded'`** — `AdminPage.jsx:431` — no regenerate from `drafted`.
- **Fixed 2-col grids cram inputs on iPhone** — `AdminPage.jsx:270,1814,871,1321,2535`. **Fix:** flexWrap / auto-fit minmax.

### Stack notes
- All panels use one-shot `getDocs` + manual optimistic setState with no rollback → any rules/network failure silently diverges admin UI from Firestore. A shared toast/error layer is the highest-leverage cross-panel fix.
- AI cost controls are reasonable (budget + pause switch + monthly quota) but `runAiJob` has no client-side timeout → buttons stick on "Writing…" with no abort. **Fix:** timeout/cancel in `runAiJob`.

---

## Dimension: Admin Panel — Part 2 (lines 2855-5620)

### Critical
- **Product save writes raw `form` spread** — `AdminPage.jsx:4265-4277` — `data = {...form, ...}` persists UI-only/empty fields and every Art-form field even for non-Art categories; stale fields from a prior `openEdit` leak in. **Fix:** build `data` from an explicit, category-aware allow-list.

### High
- **Product slug has no uniqueness guard on create** — `AdminPage.jsx:4259` — two products with the same name → identical slugs; ProductPage's `.find(p=>p.slug===slug)` returns only the first, permanently shadowing the second. **Fix:** query existing slugs, append `-2`/itemNumber/id suffix.
- **Editing a legacy product without a slug writes `slug:undefined`** — `AdminPage.jsx:4259` + `BLANK:65` — product becomes unreachable. **Fix:** `slug = form.slug || slugify(form.name)` in the edit branch.
- **Toggle handlers re-spread the whole product through `updateProduct`** — `AdminPage.jsx:4212,4217,4222,4227,4232,4237,4246` — `{...product, flag}` rewrites price/slug/imageURLs on every sold/archive/bucket toggle, re-persisting any drift. **Fix:** single-field updates `updateProduct(id, {sold:newSold})`.
- **`handlePublishAllBucket` bulk write has no partial-failure handling** — `AdminPage.jsx:4241-4251` — `Promise.all` rejects on first failure; local state only updates if all succeed → DB/UI desync, no error shown. **Fix:** `Promise.allSettled` + reconcile + report.

### Medium
- **Optimistic updates swallow errors / no rollback / stuck busy** — `AdminPage.jsx:3527-3536,3544-3548,3715-3736,4204-4239` — no try/catch; PartnershipsPanel leaves `busy` stuck on throw. **Fix:** try/catch, revert, `setBusy(null)` in finally.
- **Partnership approve/reject have no confirmation** — `AdminPage.jsx:3717,3723` — `reject` permanently sets `rejected` (removes from pending, unrecoverable from UI). Product/preorder/album/revoke DO confirm — these are the gap. **Fix:** add `window.confirm`.
- **Auto-name effect can clobber a restored draft name** — `AdminPage.jsx:4034-4048` + `openAdd:4164-4177` — `prevAutoName` ref not reset on open. **Fix:** reset `prevAutoName.current=''` in openAdd/openEdit.
- **Draft autosave persists across products, restores into wrong flow** — `AdminPage.jsx:4017-4028,4164-4172` — single global `DRAFT_KEY`; navigating away mid-add pre-fills the next unrelated listing (Record draft into Art listing) with an empty required photo slot. **Fix:** namespace draft by category/mode; explain photos must be re-added.
- **`recordCash` hardcodes Enigma + $10** — `AdminPage.jsx:3499-3525` — ignores active AlbumPreorders config; the "+$4.99 ship" note is cosmetic (amount stays 10). **Fix:** drive album+price from the selected doc; add shipping delta.

### Low
- **`recordCash` no try/catch — shows "Saved ✓" even on failure** — `AdminPage.jsx:3499-3524`. **Fix:** try/catch/finally.
- **AlbumPreorders slug accepts raw input as doc id** — `AdminPage.jsx:3330,3345` — spaces/slashes/uppercase break URLs. **Fix:** `slugify` + validate non-empty.
- **Sub-30px touch targets on destructive actions** — `AdminPage.jsx:3447-3448,3646-3661,4453-4460` — 9-10px font, 2-5px padding, clustered (incl. unconfirmed reject/delete). **Fix:** ≥40px hit areas on touch + spacing.
- **StoreConfigPanel numeric fields via `Number()` with no NaN guard** — `AdminPage.jsx:3030-3044` — empty taxRate → `NaN` → Firestore rejects → button stuck, no error. **Fix:** `Number.isFinite` per field. (Config IS otherwise wired correctly end-to-end — no dead fields; string-stored stock/deposit/weight are all `Number()`-coerced by readers.)

### Stack notes
- StoreConfig is correctly wired end-to-end (server reads `bundleDeal`/`commissionRate`/`localCommissionRate`; client reads tiers/tax/fees). No dead config fields.
- Biggest systemic risk in this range: the full-object re-spread on save/toggle + no slug-uniqueness guard — together they silently overwrite or orphan product docs.

---

## Dimension: Commerce Flows (client UX — payment logic excluded)

### Critical
- **Bundle discount silently dropped from the order total** — `AuthContext.jsx:189-218` + `CartPage.jsx:131` — `placeOrder` is called without `bundleDiscount`; it computes `total = subtotal + shipping + tax` (discount never subtracted). The order doc + GA4 purchase value (`PaymentSuccess.jsx:26`) overstate the sale by the discount; the shopper saw a lower "Pay $X". **Fix:** pass `bundleDiscount` into `placeOrder`, compute `total = subtotal + shipping + tax − bundleDiscount`; reconcile with Stripe line items.
- **Cart not reliably cleared after purchase → double-charge risk** — `CartPage.jsx:133-142` + `PaymentSuccess.jsx` — `clearCart()` runs after `await checkoutCart`, but `waitForCheckoutUrl` sets `window.location.href` then resolves, so navigation usually wins and clearCart often doesn't run; PaymentSuccess never clears. Returning/back → still-full cart → re-checkout. **Fix:** clear the cart in `PaymentSuccess` on `type==='order'` (dedupe by orderId).

### High
- **Sold/out-of-stock products addable from shop cards + stale Product pages** — `data/storage.js:41-44` (`fetchShopProducts` filters active/inBucket/Mystery but NOT `sold`/`stock<=0`) + `ProductPage.jsx:370` (add uses a mount-time snapshot, no re-check). CartPage's mount-time `validate()` runs once. **Fix:** re-check sold/stock at add-time and again immediately before `placeOrder`; exclude `sold` in `fetchShopProducts`.
- **No stock decrement client-side → oversell, no UI guard** — nothing decrements `stock` on order create; two buyers can buy the last unit / same one-of-a-kind. **Fix:** decrement transactionally on the webhook (payments audit); surface a "just sold" error if pre-checkout revalidation removes an item.
- **Double-submit creates duplicate pending orders + orphans on cancel** — `CartPage.jsx:112-150` (also `ProductPage.handleDeposit:396`, PreorderPage) — `placeOrder` `addDoc`s a `pending` order before the Stripe redirect, with no idempotency key; PaymentCancelled cleans up nothing. **Fix:** GC pending orders on cancel; idempotency key; ideally create the order in the webhook.

### Medium
- **Checkout spinner hangs ~130s on failure** — `lib/stripe.js:30-33` — no intermediate feedback; also CartPage `state` accepts any 2 chars, no ZIP validation. **Fix:** shorten timeout / show elapsed; validate ZIP + state.
- **Crate builder: uncleaned `setTimeout` auto-advance** — `MysteryPage.jsx:135-138` — `setStep(3); setTimeout(()=>setStep(4),2500)` with no cleanup → unmounted-setState warning; if `products` reloads and the chosen size disappears, prefs strand. **Fix:** clear timeout on unmount/back.
- **Wishlist image-field mismatch → no thumbnails** — `AuthContext.jsx:166` stores `image: product.image || null` but products carry `imageURL`/`imageURLs`. **Fix:** `product.imageURL || product.image || imageURLs?.[0] || null`.
- **Stale wishlist items → 404 on click** — `WishlistPage.jsx:70-96` — no existence check; deleted products still listed; price frozen at add time. **Fix:** validate against current products.

### Low
- **SubmitArt $1 fee: submission written before payment → `pending_payment` orphans + orphaned Storage image** — `SubmitArtPage.jsx:130-156`. **Fix:** sweep stale submissions or create on webhook.
- **Negative total possible if discountPct misconfigured > 100** — `CartPage.jsx:103-110` — no `Math.max(0,…)` floor. **Fix:** clamp ≥0 + validate discountPct.
- **`calcShipping` duplicated in CartPage + ProductPage** — drift risk. **Fix:** shared helper.
- **PaymentSuccess trusts the redirect — no payment verification** — fires GA4 purchase from URL params; spoofable. **Fix:** gate copy/event on `paymentStatus==='paid'`.

### Stack notes
- Recurring root cause: **order creation happens client-side before payment**, with client-trusted totals — drives the discount mismatch, orphaned pending orders, and oversell window simultaneously. Moving order creation + stock decrement into the Stripe webhook resolves most at once.
- Two parallel shipping-calc copies + four image-field conventions (`image`/`imageURL`/`imageURLs[0]`/`gatefoldURL`) read inconsistently → consolidate into shared helpers.

---

## Dimension: Booking & Events

### Critical
- **Race → silent double-booking with a fake confirmation** — `BookingPage.jsx:125-147` + `booking.js:237-265` — two users picking the same virtual slot both `addDoc` `booked:true`; both bookings succeed, **both see "You're booked."** (nothing throws). Real slots get an unconditional `updateDoc({booked:true})` with no prior read. **Fix:** `runTransaction` that aborts if already booked (deterministic `${date}_${time}` doc id so virtual creates collide) and **throws** so the UI shows an error + refetches.
- **~~"Confirmation sent / invoice at…" emails are never sent~~ — FALSE ALARM (corrected 2026-06-12, verified against deployed functions)** — The original finding was wrong: it was scoped to client files and missed the server-side Firestore `onCreate` triggers. `onBookingCreated` (`functions/index.js:1965`), `onCommissionCreated` (`:1915`), and `onMonthlyStudentCreated` (`:2020`) are all **deployed and confirmed** (`firebase functions:list`), and each sends a confirmation email to the customer (`b.email` / `c.contactEmail` / `s.email`) **and** a notification to the owner (`FROM_EMAIL`). The done-screen copy is accurate; no fix needed. ⚠️ **Residual caveat (real):** these emails only fire if the Firestore write succeeds — so the High finding below ("Booking confirms even when the write fails", and the double-booking race above) still cause the *email* to silently not send in those failure paths. Fix those, not the email triggers.

### High
- **Booking confirms even when the write fails** — `BookingPage.jsx:106-123` — `saveMonthlyStudent({...}).catch(()=>{})` then unconditional `setStep('done')`; lost lead, no record, fake success. **Fix:** remove the swallowing catch; surface the error, keep the user on the form.
- **Past-date events can be submitted; no future-date validation** — `EventsPage.jsx:732` (no `min`), `EventsSection.jsx:318` — a past event auto-approves (next item) and lands in Past Events. **Fix:** `min={todayYMD()}` + reject past dates server-side.
- **Direct `addEvent` auto-approves, bypassing review** — `events.js:42-62` (`approved:true` hardcoded) — also `EventsSection.handleSubmit` passes only 3 args, omitting `email`, so `submitterEmail` is always blank for home-page submissions. **Fix:** pass `user.email` as 4th arg; ensure no public path calls `addEvent` directly.
- **`getStudentSlotsForDate` half-hour rounding mislabels odd-minute schedules** — `booking.js:303-323` — formats every slot `:00`/`:30`; a `09:15` start never matches the grid → student blocks silently fail to render. **Fix:** format minutes literally + align grid, or snap to 30-min.

### Medium
- **Completion estimate can render an absurd date + create a deadline task on a zero-working-hours date** — `scheduleUtils.js:61-73,86-100` — returns a date even when the 730-day safety limit hits without covering hours (e.g. config covers the whole day → `hoursAvailableOnDay` returns 0 forever → 2-years-out). `CommissionForm.jsx:197-207` writes it as a real deadline. **Fix:** return null/flag when hours uncovered; guard the auto-task + the displayed estimate; handle `start>=end`.
- **Events "today" UTC bug also in EventsSection** — `EventsSection.jsx:195,217` — same `toISOString` as the known `events.js` bug; calendar (local) shows tonight's event while home/section drop it. **Fix:** standardize on local `dateToYMD`.
- **Booking calendar disables today in negative-UTC zones** — `BookingPage.jsx:307` — `new Date("2026-06-11")` parses as UTC midnight; today's cell shows as past even when `availableDates` includes it. **Fix:** parse with local `(y,m-1,d)` constructor.
- **Commission/recaps submittable logged-out, no rate limit/captcha, Storage upload per submit** — `CommissionForm.jsx:389-393` (client-only `max`), open `commissions`/`eventRecaps` create. **Fix:** require auth or App Check / rate limit; cap server-side.
- **Fragile `new Date(...spread)` date parsing** — `EventsPage.jsx:648`, `AvailabilityManager.jsx:204,299` — `Invalid Date` with no guard if malformed. **Fix:** shared `parseLocalDate(ds)`.

### Low
- **No end-after-start validation on events** — `EventsPage.jsx:743-762` — "7PM–3PM" renders fine; `parseHour` returns null on typos → silently demoted to "All day." **Fix:** validate end>start.
- **12h vs 24h inconsistency** — events store free-text ("7:30 PM"), bookings store 24h; `EventsSection` shows raw `ev.startTime` unformatted → legacy "19:30" next to "7:30 PM". **Fix:** run all event times through one formatter.
- **Cancelled virtual-origin slot leaks** — `booking.js:267-270` — un-booking leaves a permanent bookable `slots` doc diverging from intended availability. **Fix:** delete virtual-origin slots on cancel (tag `virtualOrigin:true`).
- **`requestEventRemoval` only flags the submission; live event stays visible** — `events.js:202-208`. **Fix:** auto-hide via `active:false` the queries honor, or document the manual admin step.
- **`updateSubmission`/`requestEventEdit` drop `flyerURL` + reset status** — `events.js:183-199,143-160`. **Fix:** preserve `flyerURL`.

### Stack notes
- Two good patterns: `getDefaultAvailableSlots` cleanly enforces the 48h cutoff via virtual slots; `ScheduleManager.applyTemplate` de-dupes against existing slots/blocks/tasks (bulk path won't double-define) — only the single `addSlot`/`saveBooking` path can.
- Highest-leverage fix: make `saveBooking` transactional and let it throw — closes the double-book race AND the false-confirmation UX in one move.

---

## Dimension: Forms & Integrations

### Critical
- **QuoteRequestPage writes to a no-rule collection — every submission denied after a full upload** — `QuoteRequestPage.jsx:350` + missing `quoteRequests` rule (catch-all denies) — user fills the form, uploads booklet images + per-track audio (those succeed + orphan in `quotes/`), then `addDoc` throws `permission-denied`, surfaced as a generic "Upload failed" + re-uploads on retry. 100% broken. **Fix:** add the `quoteRequests` rule (mirror `commissions`).
- **FeedbackBubble writes to no-rule `feedback` — silently dropped, no error UI** — `FeedbackBubble.jsx:30` + missing rule — `addDoc` rejects, catch only `console.error`s, no error shown, nothing saved. **Fix:** add the `feedback` rule + surface a real error.

### High
- **VinylGrader calls Anthropic from the browser with invalid model `claude-opus-4-6`** — `VinylGrader.jsx:103,122` — model id doesn't exist → every call returns 404, surfaced raw via `setError`. (Browser-key issue covered elsewhere.) **Fix:** route through `runAiJob`/CF + a valid model id.
- **Event-submit form silently drops the entered Time + shows success on write failure** — `EventsSection.jsx:10,202-214` + `events.js:90-99` — field `name="time"` (→`fields.time`) but `submitEventRequest` reads only `fields.startTime`; entered time never stored. `handleSubmit` has no catch → unhandled rejection, no failure feedback. **Fix:** map `time`→`startTime`; add a catch with error UI.
- **No spam/abuse protection on any public form** — FeedbackBubble, QuoteRequest, CommissionForm, BookingPage (bookings/monthlyStudents `create: if true`), EventsSection recap upload, BlogSubmit — no honeypot/rate-limit/captcha; booking/quote/commission each trigger SendGrid emails → bot can amplify cost + flood admin. **Fix:** honeypot + min-fill-time client-side; rate-limit by IP/uid in CF triggers; App Check on unauth creates.

### Medium
- **No file type/size validation before Storage upload** — QuoteRequest audio (`:340`, no size cap — multi-hundred-MB WAVs), QuoteRequest images (`:330`), BlogSubmit cover (`:71-77`), EventsSection recap (`:37-43`), ProfileAvatar (`:17-22`), CommissionForm reference (`:144-149`); only SubmitArt enforces a *minimum*. **Fix:** shared `validateImage(file,{maxMB,types})` before every upload.
- **SubmitArt uploads artwork without watermarking** — `SubmitArtPage.jsx:124-126` — `applyWatermark` is used only in `AdminPage.jsx:4083,4113`; submitted images stored unwatermarked + publicly readable. (`watermark.js` also ignores the `0.92` quality arg for PNG; transparent PNGs get hard white text.) **Fix:** confirm watermark-at-publish intent; if artist images should be marked, call `applyWatermark` before upload.
- **Stripe checkout / aiJob hang ~125-130s on a stuck spinner** — `stripe.js:30-33`, `aiJob.js:21` — no incremental feedback. **Fix:** lower to ~30-45s + interim "still working…".
- **`checkoutListingFee` fails open silently if the Payment Link env var is unset** — `stripe.js:68-78` + `SubmitArtPage.jsx:154-155` — only `console.warn`s + returns; `setSubmitted(true)` never runs → user stranded with an unpaid `pending_payment` doc. **Fix:** throw/`setError` if the link is missing; don't write the submission.
- **LoginPage surfaces raw Firebase messages for unmapped codes** — `LoginPage.jsx:62,42` — only 4 codes mapped; `too-many-requests`/`network-request-failed`/`popup-closed-by-user` show raw SDK strings. **Fix:** map the common remainder + generic fallback.

### Low
- **Email/phone stored with no normalization/format check** — BookingPage (`:137` raw phone), QuoteRequest (`:359`), CommissionForm, BlogSubmit — `type="tel"` does no validation; "call me" accepted. **Fix:** light email regex + digit-count phone check; lowercase emails.
- **No email-format validation** — QuoteRequest (`:291-302`), FeedbackBubble, CommissionForm, EventsSection — only presence checks; "x" passes. **Fix:** centralize `isEmail()`.
- **SubmitArt `year` accepts garbage via JS path** — `:286` — `parseInt('abc')`→NaN→stored null. **Fix:** clamp/validate.
- **BarcodeScanner cleanup correct; denial copy generic** — `BarcodeScanner.jsx:46-49,28,39-44` — stream cleanup on unmount/detect is properly handled. **Fix (optional):** branch on `err.name`.

### Stack notes
- No form library/schema validation anywhere — every form is hand-rolled with inconsistent rules. Adopt **`react-hook-form` + `zod`** with a shared `contactSchema` to eliminate per-form drift + the empty-email-to-Firestore class.
- No captcha/App Check/honeypot; `firebase/app-check` not imported. The `create: if true` collections each fan out to SendGrid — App Check is the cheapest blanket mitigation. `emailjs.js` is a true no-op stub, not imported anywhere (no silent email loss). `fbImport.js`/`fetchFacebookEvent` does not exist + is not referenced (no broken "Import from Facebook" button).

---

# Tech Stack Recommendation

### Keep (working well, modern enough)
- **React + Vite + Tailwind** — the core is sound. Code-splitting (`React.lazy` + per-service Firebase `manualChunks`) is well done; no prod sourcemaps; 2.3 MB dist with Firebase gzip. Don't rewrite — upgrade in place.
- **Firebase (Firestore/Auth/Storage/Hosting/Functions)** — the right backend for this app's scale. Keep.
- **The Firestore-doc-relay pattern for Stripe checkout + AI jobs** — a sound workaround for the Workspace org's domain-restricted callable-invoker policy. Keep it; just add per-function auth defense where genuine callables remain.
- **`react-router-dom` v6.30** with v7 future flags already on — keep; v7 is a near-free bump when ready.
- **Stripe, SendGrid, Shippo, Discogs, Vertex/Gemini** integrations — all server-side and appropriate. Keep.

### Upgrade (in this order)
1. **Vite 5.4 → 7** + `@vitejs/plugin-react` 4 → 5 — security-relevant (dev-server CVEs patched in 6/7), config is compatible. Low friction.
2. **React 18.3 → 19** — after Vite.
3. **`firebase-admin` 12 → 13** (functions) — separate functions-focused session.
4. **Cloud Functions Gen1 → Gen2** (`firebase-functions/v2`) — concurrency, better cold starts, first-class `defineSecret`, `setGlobalOptions({region:'us-central1'})`.
5. **Tailwind 3.4 → 4** — defer; config-model rewrite, dedicate a session.
6. **Pin `@zxing/browser`** exactly (pre-1.0, unmaintained).

### Replace / Remove
- **Hand-rolled `meta.js` → `react-helmet-async`** — declarative per-route meta + JSON-LD, no reset race; pairs with prerender.
- **Hand-rolled forms → `react-hook-form` + `zod`** — kills the per-form validation drift + empty-doc-to-Firestore class.
- **Email-string admin checks → Firebase custom claims** (`admin:true` via Admin SDK) — single source of truth across rules + client, not spoofable, rotatable. Highest-leverage security change.
- **Ad-hoc `useState`/`useEffect` data fetching → TanStack Query** — fixes duplicate full-collection fetches, stale admin lists, error/retry UX, mutation invalidation in one move.
- **Custom modals/drawer/tabs/lightbox → Radix UI or Headless UI** — focus trap, Escape, focus restore, `aria-modal`, tablist semantics for free (resolves the Critical/High a11y modal + tab findings).
- **`functions/.env` → Firebase Secret Manager** (`defineSecret`).
- **Delete:** `VinylGrader.jsx` (+ `@anthropic-ai/sdk`), `ArtScribble.jsx`, `VintageFuzz.jsx`, `SplashPage.jsx`, `AdminPage_BlogPanel.jsx`, `lib/emailjs.js`, `@stripe/stripe-js`, `react-image-crop`, root clutter (`files.zip`, `files_extracted/`, `package-lock.json`, `start-ng.bat`, `New folder/`, `replace_greys.ps1`, one-off scripts).

### Add (new tooling/infra)
- **Git + `.gitignore` + private remote** — before anything else.
- **Move project out of OneDrive** — eliminate node_modules sync churn.
- **ESLint (flat config) + `eslint-plugin-react-hooks` + `eslint-plugin-jsx-a11y` + Prettier + Vitest** — catches dead exports, a11y violations, and adds a smoke-test floor.
- **GitHub Actions CI** — install → lint → build on push.
- **Firebase "Resize Images" Storage extension** (or `sharp` in a CF) + `srcset` — the single biggest runtime/perf win.
- **Firebase App Check** — blanket abuse mitigation for the open `create: if true` collections.
- **Crawler-targeted dynamic prerender** (CF + puppeteer or prerender.io, UA-gated in `firebase.json`) — unblocks social shares + reliable indexing of Firestore-driven product/article pages.
- **`predeploy` build hook in firebase.json** + a `deploy:all`/`deploy:rules` script — stop rules/functions/index drift.

### Highest-leverage sequence for the build session
1. Git + `.gitignore` + rotate secrets + move out of OneDrive.
2. Add missing Firestore/Storage rules (`feedback`, `quoteRequests`, `banners`) + the missing composite indexes — unbreak live features.
3. Server-authoritative pricing/orders/stock in the checkout Cloud Function — close the money + oversell holes.
4. Custom claims for admin + lock down user-writable fields in rules.
5. Make `saveBooking` transactional; wire the missing confirmation emails (or fix the copy).
6. Image resize pipeline + `srcset`; context memoization; visibility-gate the canvases.
7. Prerender + react-helmet + JSON-LD for SEO.
8. Then the refactors (AdminPage split, shared helpers, TanStack Query, react-hook-form, Radix) and dependency upgrades.
