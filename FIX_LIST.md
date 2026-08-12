# Fix list — found, not yet fixed

Things spotted while working, held for approval rather than changed. Nothing
here has been touched. Delete a row once it's done or decided against.

Started 2026-08-12.

---

## 1. Old artist uploads are stranded in Firestore

**No longer blocks new uploads** — sellers now publish straight to `products` and
never touch `submissions`. What's left is the backlog: anything uploaded through
the old flow is still invisible to everyone.

The old `GalleryUploadPage.saveAll()` wrote each submission with `createdAt`
only. Both places that list submissions order by a different field, `submittedAt`:

- admin review queue — `src/pages/AdminPage.jsx:934`
- the artist's own Submissions tab — `src/pages/AccountPage.jsx:284`

Firestore silently drops documents that lack the field being ordered on. So a
submission from the old `/gallery-upload` was never listed anywhere: the owner
couldn't review it, and the artist who paid $7.99/month to upload it couldn't see
it either. Those documents are still in Firestore, still unreachable.

**Fix:** a script that copies `createdAt` into `submittedAt` wherever it's
missing. Check first whether any exist — if nobody ever subscribed and uploaded,
there is nothing to rescue and this row can be deleted.

## 2. The old approval path still publishes at $0

`AdminPage.jsx:962` — `price: sub.price || 0`, with `active: true` on the same
object, in `SubmissionsPanel.approveSubmission` and again in `syncToShop`.

The new seller path can't produce this: `firestore.rules` refuses a listing whose
price isn't a number greater than zero. But the Submissions panel is still wired
up for old documents, and approving one with no price puts a free, purchasable
product in the shop.

**Fix:** one guard clause in both functions — refuse to create a product priced
at 0. Or retire the Submissions panel entirely once the backlog in #1 is dealt
with, since nothing writes to that collection any more.

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
