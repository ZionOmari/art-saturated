# Fix list — found, not yet fixed

Things spotted while working, held for approval rather than changed. Nothing
here has been touched. Delete a row once it's done or decided against.

Started 2026-08-12.

---

## 1. Artist uploads are invisible to everyone, including the artist

**Severity: blocks the whole seller feature.**

`GalleryUploadPage.jsx` writes each submission with `createdAt`
(`src/pages/GalleryUploadPage.jsx:157`). Both places that list submissions order
by a different field, `submittedAt`:

- admin review queue — `src/pages/AdminPage.jsx:934`
- the artist's own Submissions tab — `src/pages/AccountPage.jsx:284`

Firestore silently drops documents that lack the field being ordered on. So a
submission from `/gallery-upload` is never listed anywhere: the owner can't
review it, and the artist who paid $7.99/month to upload it can't see it either.
It is in Firestore, just unreachable through the UI.

**Fix:** write `submittedAt: serverTimestamp()` in `GalleryUploadPage.saveAll()`
(keep `createdAt` too — other code reads it), and backfill existing docs with a
script that copies `createdAt` into `submittedAt` where it's missing. Worth
checking Firestore first for how many are stranded.

## 2. Approving a submission publishes it at $0, live

`AdminPage.jsx:962` — `price: sub.price || 0`, with `active: true` on the same
object. The upload form has no price field at all, so *every* artist submission
arrives with no price and goes straight into the shop at $0, purchasable.

**Fix depends on the pricing model** (still undecided): seller sets the price, or
the approval step requires one. Either way, approval should refuse to publish a
product with a price of 0 — one guard clause, worth adding regardless.

## 3. Preview-clip uploader is in the wrong category block

`AdminPage.jsx:3785` — the Track Previews field sits inside
`form.category === 'Art'`, so an album (`Physical Media`) can't get preview clips
at all. The feature was written for records and is unreachable for them.

**Fix:** move the block out of the Art conditional. One-line move.

## 4. Weightless products ship free

`calcShipping` returns 0 when `weightOz` is unset. Cart copy is honest about it,
so it isn't a lie to the customer — but it means a heavy item listed without a
weight ships at your expense. The gallery upload form asks for weight but doesn't
require it.

**Fix:** decide whether it's intended. If not, require `weightOz` on any listing
that isn't digital or local-pickup.

## 5. Old orders lost their category pill

Cosmetic, admin-only. Order documents store a snapshot of each item's category,
so orders placed before the 'Room 40 Threads' → 'Clothing' rename still say
'Room 40 Threads' and won't match the 'Clothing' filter pill in the Orders tab.

Deliberately left alone: an order records what was sold under the name it was
sold under. Noted so it isn't mistaken for a bug later.

## 6. Stale `isPartner` / `student` fields on user docs

Inert — nothing reads them and the rules keep them locked. Cosmetic cleanup only.
Carried over from `NEXT_STEPS.md`.
