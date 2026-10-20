# Enigma Preorder — Go-Live Checklist (prod)

Everything is built and verified in the sandbox. These are the **prod-only** steps
that need your credentials. Run from `art-saturated/`.

---

## 1. Deploy Firestore rules  ⬅ CRITICAL — without this the preorder page 404s

The `albumPreorders` read rule exists locally (`firestore.rules` lines 203–206) but
must be pushed to prod. If it's missing in prod, `getDoc('albumPreorders/enigma')`
throws permission-denied → the page falls into its catch → "not found".

```bash
firebase deploy --only firestore:rules
```

(Idempotent — safe to re-run if you're unsure whether it already went out.)

## 2. Create the `albumPreorders/enigma` doc in prod Firestore

Without the doc, PreorderPage uses its built-in fallback — which defaults to
**digital ON** and **no $5 flat shipping** (it'd use the first storeConfig tier).
The doc is what locks the spec ($10 / flat $5 ship / digital off).

Firebase Console → Firestore → collection `albumPreorders` → document ID **`enigma`**:

| Field              | Type    | Value        |
|--------------------|---------|--------------|
| `active`           | boolean | `true`       |
| `albumTitle`       | string  | `Enigma`     |
| `artistName`       | string  | `Zionomari`  |
| `price`            | number  | `10`         |
| `shippingFlat`     | number  | `5`          |
| `digitalAvailable` | boolean | `false`      |
| `physicalAvailable`| boolean | `true`       |
| `pickupAvailable`  | boolean | `true`       |
| `releaseDate`      | string  | `Jun 30 2026`|
| `description`      | string  | (your copy)  |

Skip `coverArt` — the page uses the animated EnigmaField visual.
Result: ship = **$15 total**, pickup = **$10**. Card-only is enforced server-side.

## 3. Deploy hosting (ships pagination/share-strip/cart fixes if not already live)

```bash
npm run deploy
```

## 4. Deploy functions — includes the NEW AI Batch sort + Discogs pricing

```bash
firebase deploy --only functions
```

⚠ If it lists the 7 orphan functions and asks **"proceed with deletion?"** answer **N**
(keeps them so a stale cached browser can't break checkout). To remove them
deliberately later, see the orphan section below.

---

## After prod is settled — delete the 7 orphan functions

Confirmed safe (June 2026 audit re-verified): none exist in local `functions/index.js`
and nothing in `src/` calls them. Run when new hosting has settled:

```bash
firebase functions:delete createCheckoutSession createDepositSession createListingFeeSession suggestListing generateArtistSpotlight generateInterviewDraft generateSeoArticle
```

(Here you DO answer **Y** — this is an explicit delete, not the deploy-time prompt.)
