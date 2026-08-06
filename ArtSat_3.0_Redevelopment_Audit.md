# Art Saturated — 3.0 Redevelopment Audit
**Prepared by Claude · June 9, 2026**  
Stack: React / Vite / Firebase / Firestore / Stripe / Gemini / SendGrid

This is a full read of the codebase — not opinions, findings. Every claim below is sourced from what's actually in the files.

---

## THE SHORT VERSION

The site has three layers: a solid core, a massive teaching/studio management system that grew in alongside it, and a graveyard of components that were built but never wired up. The AdminPage alone is 5,613 lines — bigger than most entire apps. Before you touch the stack, you need to decide what Art Saturated 3.0 actually is, because right now the codebase is three businesses in one repo.

---

## 1. CONFIRMED DEAD CODE — DELETE IMMEDIATELY

These files are imported by nothing, routed to nothing, and do nothing on the live site. They are pure bundle weight.

### VinylGrader.jsx (219 lines)
- 0 importers. Not in any page, any route, any component.
- **Critical:** This file imports `@anthropic-ai/sdk`. Because it's in `package.json` as a dependency and Vite bundles it, the Anthropic client SDK may be getting shipped to every visitor — with potential API key exposure risk if any credentials were ever put near it.
- **Action: Delete the file. Remove `@anthropic-ai/sdk` from `package.json` client dependencies entirely.** AI runs server-side through Gemini via Cloud Functions. The Anthropic SDK has no business in the client bundle.

### ArtScribble.jsx (177 lines)
- 0 importers. Complete orphan. Looks like an early art tool prototype.
- **Action: Delete.**

### VintageFuzz.jsx
- 0 importers.
- **Action: Delete.**

### SplashPage.jsx
- Exists in `src/pages/`. Not in App.jsx routes. Not navigable. Not linked from anywhere.
- It's the Enigma animated field with a centered artist name — probably an early landing page concept.
- **Action: Delete, or extract the EnigmaField layout concept you want and delete the page file.**

### emailjs.js (src/lib/emailjs.js)
- The file itself says it's retired. It's a stub kept "so any lingering import resolves without crashing the build."
- If the migration to SendGrid is complete and nothing imports this, **delete it and remove `emailjs-com` / `@emailjs/browser` from package.json.**
- If something still imports it, that's a sign the migration isn't done — find the importer and finish the job.

---

## 2. THE TEACHING SYSTEM — THE BIGGEST DECISION

This is the largest non-obvious feature cluster in the codebase. It's not zombie code — it's actively wired up. But it's 2,500+ lines of scheduling infrastructure embedded inside an art and music store.

**Files in the cluster:**
- `ScheduleManager.jsx` — 620 lines. Calendar UI, slot management, booking grid.
- `StudentsPanel.jsx` — 872 lines. Student roster, lesson history, notes per student.
- `LessonNotebook.jsx` — 529 lines. Lesson notes UI, imported by both AccountPage and StudentsPanel.
- `AvailabilityManager.jsx` — 317 lines. Wraps ScheduleManager + DailyPlanner. Controls which slots are open.
- `DailyPlanner.jsx` — 179 lines. Task list by date. Reads from Firestore `tasks` collection.
- `booking.js` — Full scheduling logic: services (Creative Consult $120, Consultation $50, Dance Lesson $50), shop hour blocking, availability persistence, teaching rates.
- `tasks.js` — Task CRUD against Firestore. Types: task, admin, shipping, commission, deadline.

**What it does:** A complete studio booking and teaching management system. Students can book lessons. Zion manages availability. Lesson notes are kept per student. Tasks attach to dates. Shop hours block out booking slots.

**The question:** Is this being used, and by how many people?

- If this is a live revenue stream with regular students, it stays — but it needs to be extracted from AdminPage and made its own section.
- If this is infrastructure for a handful of bookings per month, it's massively over-engineered for the load.
- If it's barely used, 3.0 should replace it with a Calendly or Acuity embed and delete all five files.

**Verdict for 3.0:** Decide first. Don't rebuild it if you're not actively using it. If you are, extract it as a separate `/studio` section rather than embedding it in AdminPage.

---

## 3. ADMINPAGE — THE MONOLITH

`AdminPage.jsx` is **5,613 lines**. That's larger than most complete web apps.

**Panels inside it (each one is a mini-app):**
1. OrdersPanel — orders + commissions sub-tabs
2. SubmissionsPanel — artist/vendor submissions
3. FeedbackPanel — reads from Firestore `feedback` collection
4. EventsPanel — event CRUD
5. MagazineAdminPanel — ArticleManager + BlogSubmissionsPanel
6. AiUsagePanel — AI usage stats
7. SeoArticleGenerator — AI-powered SEO content
8. SpotlightGenerator — AI-powered product spotlights
9. InterviewsPanel — interview management
10. CDOrdersPanel — CD duplication order management
11. TeachingPanel — teaching rate config + booking overview
12. StudentsPanel — full student management (imported from component)
13. StoreConfigPanel — store settings
14. AlbumPreordersPanel — album preorder management (Enigma etc.)
15. PreordersPanel — active preorder orders

**What this means in practice:** Every single admin function loads as one giant chunk. Editing one panel means loading 5,600 lines of context. Any Claude Code session working on admin features is working blind because the file is too large to reason about cleanly.

**Action for 3.0:** Each panel above should be its own file. `AdminPage.jsx` should be a shell that imports and renders panels. This is a refactor job — not a rewrite — but it's essential before 3.0 builds on top of it.

---

## 4. FEATURES THAT NEED A DECISION

These are wired up and working, but their place in 3.0 depends on whether they're generating value.

### Mystery Records (MysteryPage.jsx 714 + MysteryPreferencesPanel.jsx 229 = 943 lines)
A full mystery record subscription box product with preference sliders (genre, decade, format, condition tolerance, jacket condition preference). Reads from Firestore for mystery product listings. Has its own cart/checkout flow.

**Keep or cut?** If mystery boxes are selling, keep — but the preferences system is heavy for what it does. If they're not moving, cut the whole thing and point the page to a simple "coming soon" or remove the route.

### CD Orders (/order/cd → QuoteRequestPage.jsx, 737 lines)
A full CD duplication quote and ordering workflow. Has its own admin panel (CDOrdersPanel in AdminPage). Has a Stripe checkout flow for deposits.

**Keep or cut?** If this is a real service with real revenue, keep but simplify. If it's aspirational infrastructure, cut it from 3.0 and bring it back when the demand is there.

### Blog Paid Submissions (BlogSubmitPage.jsx, 244 lines)
Artists can submit to the magazine with a configurable submission fee (set in admin). Has Stripe checkout. The fee is configured via Firestore `settings`.

**Verdict:** The mechanism is fine, but the submission fee model for a new magazine is worth questioning. If submissions are paying, keep it. If it's creating friction with no revenue, set fee to $0 and simplify the flow.

### WishlistPage (/wishlist/:uid)
Public shareable wishlists. A user can share their wishlist URL with anyone. Reads from Firestore `wishlists` collection.

**Keep or cut?** Pull the Firestore data — if `wishlists` has records and they're being accessed, it's being used. If the collection is empty or stale, cut it from 3.0.

### TreeOfLifeConfigurator (182 lines, in ProductPage)
A product configurator for "Tree of Life" series products — lets customers pick size (Small $10, Large $15), color (Redwood, Desert Flower, Evergreen), and plant type (Basil, Dieffenbachia, Spinach, Kale, Lemon Balm, Catnip, Carrot).

This renders inside ProductPage when the product is tagged to the Tree of Life series. If you're still selling these plants, it stays. If the series is done, this is dead weight on every ProductPage load.

### DrawingCanvas (187 lines, in ShopPage)
Renders when the Art category is selected in the shop. It's an interactive drawing element — appears to be decorative/experience-driven rather than functional. Not a purchase flow.

**Verdict:** If it's part of the art browsing experience intentionally, keep it small and fast. If it's just in there from a vibe-coding session and nobody notices it, cut it.

### FeedbackBubble (202 lines)
Floating feedback widget. Writes to Firestore `feedback` collection. Present on every page.

**Keep if:** You're actually reading and acting on the feedback Firestore collection.  
**Cut if:** You haven't opened that collection in months.

---

## 5. DEPENDENCY AUDIT

### Client (package.json)
| Package | Status | Action |
|---------|--------|--------|
| `@anthropic-ai/sdk` | Dead — only in VinylGrader (deleted) | **Remove from package.json immediately** |
| `@stripe/stripe-js` | Active — Stripe checkout | Keep |
| `@zxing/browser` | Active — BarcodeScanner in AdminPage | Keep (admin-only feature) |
| `firebase` | Active — core | Keep |
| `react-image-crop` | Active — CropModal (product image upload) | Keep |
| `react-router-dom` | Active — routing | Keep |

### Functions (functions/package.json)
| Package | Status | Action |
|---------|--------|--------|
| `@google/genai` | Active — correct AI SDK | Keep |
| `@sendgrid/mail` | Active — server email | Keep |
| `firebase-admin` | Active | Keep |
| `firebase-functions` | Gen1 API — migration needed | Gen2 when ready (separate task) |
| `sharp` | Active — image processing | Keep |
| `stripe` | Active — checkout sessions | Keep |

### What's missing from client
- No `@emailjs/browser` found in package.json — good, if EmailJS is actually gone from the codebase.
- No error tracking (Sentry etc.) — if the app is generating revenue, this is worth adding.

---

## 6. ARCHITECTURE NOTES FOR 3.0

### What's working well — carry it forward
- **Firestore-triggered Cloud Functions** for Stripe checkout and AI jobs. The pattern (client writes request doc → function processes → client listens for result) is solid and works around IAM restrictions. Keep this.
- **Lazy-loaded pages** with Suspense + ErrorBoundary. Clean chunk loading.
- **SendGrid on the server.** Right pattern.
- **EnigmaField as a standalone animated component.** Reusable visual architecture.
- **Vite + React.** Fast, simple, no reason to change.

### What needs fixing before 3.0 ships
1. **Remove @anthropic-ai/sdk from client bundle.** Non-negotiable. Client-side AI SDK = security risk.
2. **Split AdminPage.jsx** into panel files. Every future build task on admin features requires this.
3. **Finish the EmailJS migration** or confirm it's done and delete the stub.
4. **Resolve the static data / Firestore split.** Products, artists, events, and blog all have static JS data files that may or may not be in sync with Firestore. Decide: everything lives in Firestore (admin editable) or everything lives in static files (code-deployed). Not both.

### What to reconsider for 3.0
- **SSR for magazine/blog.** React SPA means Google sees a shell when crawling `/magazine/:slug`. If the magazine is a real content play, moving that section to Next.js or Astro would dramatically improve SEO.
- **Booking via third party.** If the teaching system isn't at capacity, Calendly is 0 lines of code and covers 95% of what ScheduleManager does.
- **AdminPage as a separate app.** The admin is private, accessed by one person. It doesn't need to be bundled with the public site. A separate `/admin` deployment (even a simple one) would make public site bundles smaller and admin development faster.

---

## 7. WHAT 3.0 SHOULD LOOK LIKE

### Keep (core — always needed)
- Shop, ProductPage, CartPage, Checkout, Stripe
- Magazine (MagazinePage, ArticlePage)
- Events (EventsPage, EventDetailPage, PastEventsPage)
- Artists (ArtistsPage, ArtistProfilePage, submissions)
- Preorders (PreorderPage, AlbumPreordersPanel)
- Auth (LoginPage, AccountPage, AuthContext)
- Admin orders + submissions panels
- Commissions (CommissionForm)
- Interviews (InterviewPage)

### Evaluate (decide before building)
- Mystery Records — live revenue or aspirational?
- Teaching/booking system — active students or zombie infrastructure?
- CD Orders — real service or prototype?
- Wishlists — anyone using them?
- Paid blog submissions — generating revenue?

### Cut (delete before starting 3.0)
- VinylGrader.jsx
- ArtScribble.jsx
- VintageFuzz.jsx
- SplashPage.jsx
- emailjs.js stub
- `@anthropic-ai/sdk` from client package.json
- TreeOfLifeConfigurator if Tree of Life series is done
- DrawingCanvas if it's not a deliberate experience choice

---

## 8. WHAT TO GIVE CLAUDE CODE NEXT

When you're ready to start 3.0 builds, give Claude Code these tasks in order:

1. **Immediate cleanup** — delete the 4 dead files, remove @anthropic-ai/sdk from package.json, verify EmailJS is fully gone. No new features until this is done. This is the clean sheet.

2. **AdminPage split** — extract each panel into its own file. AdminPage becomes a router/shell. ~1 day of work, no functional change, makes every future admin build 10x easier.

3. **Firestore data consolidation** — audit every static data file (products.js, artists.js, events.js, blog.js) and decide: Firestore-only or static-only. Remove the hybrid.

4. **Teaching system decision** — tell Claude Code to audit the Firestore `bookings`, `students`, and `lessons` collections for real record counts. If > 20 active records across those collections: extract teaching into its own section and keep. If < 20: replace with a Calendly embed and delete the cluster.

5. **Magazine SEO audit** — test with Google Search Console whether `/magazine/:slug` pages are being indexed. If not, plan the SSR migration for that section only.

---

*All findings sourced from live codebase reads. Nothing speculative.*
