// CD Printing Terms of Service — shown in full on /cd-printing and agreed to at
// checkout. Numbers come from the price table so the terms can't drift from
// what checkout actually charges.
import { CD_PRICING, fmtCents } from '../../functions/cdPricing.mjs'

export const CD_TERMS_UPDATED = 'September 29, 2026'

const months = Math.round(CD_PRICING.retentionDays / 30.5)

export const CD_TERMS = [
  {
    title: 'Pricing & payment',
    items: [
      'Your price is calculated from the options you choose and shown in full before checkout: per-disc cost, a one-time setup fee, Indiana sales tax (7%), and shipping if selected.',
      `Orders under ${CD_PRICING.depositThreshold} discs are paid in full at checkout.`,
      `Orders of ${CD_PRICING.depositThreshold} or more discs pay a ${CD_PRICING.depositPct}% deposit at checkout. The balance is due when your order is ready; we email you a payment link. Discs are released or shipped only after the balance is paid.`,
      'Balances not paid within 30 days of the ready notice may be forfeited, and the deposit is not refunded.',
      'Payments are processed by Stripe. We never see or store your card details.',
    ],
  },
  {
    title: 'Your files',
    items: [
      'We print exactly what you upload, cropped as shown in the crop frame. There is no proof or design round. The mock-up on the order page shows the layout.',
      'Screen colors and printed colors differ slightly. Paper, cardstock, and gloss each change how colors look. This is not a defect.',
      'Keep text and important details at least 1/8" (3 mm) from every edge. On jewel case tray cards, the outer 1/4" on each side is covered by the spines.',
      'Low-resolution images print blurry. We warn you on the crop screen, but we print what you submit.',
      'Audio is burned as uploaded, in the track order you list. We do not master, normalize, or edit audio. One disc holds up to 80 minutes.',
      'Typos, colour choices, audio problems, and image quality in your files are your responsibility and are not reprinted free of charge.',
    ],
  },
  {
    title: 'Production & turnaround',
    items: [
      'Production starts when payment clears. Most orders are ready in 7–14 days. We email you when your CDs are ready, and again when they ship.',
      `Rush orders are ready in under ${CD_PRICING.rushDays} days for ${CD_PRICING.rushPct}% more on production (discs and setup fee; shipping is not included). If we miss a rush deadline, we refund the rush fee.`,
      'Gloss finish applies to printed covers only. Discs are printed matte.',
      `A small "Printed at Art Saturated" credit appears on the inside of the cover unless you choose to leave it off (+${fmtCents(CD_PRICING.removeCredit)} per disc).`,
    ],
  },
  {
    title: 'Pickup & shipping',
    items: [
      'Pickup is at 3945 Parnell Ave, Fort Wayne, IN. Please collect your order within 30 days of the ready notice.',
      `Shipping within the US is a flat ${fmtCents(CD_PRICING.shippingFlat)} per order. It is an estimate: if a large order costs substantially more to ship, we will contact you before it ships. We are not responsible for carrier delays.`,
      'Outside the US, message us for a shipping quote before ordering.',
      'Double-check your address: packages sent to an address you entered incorrectly are re-shipped at your cost.',
      'If an order arrives damaged, email us photos within 7 days of delivery and we will reprint the damaged discs.',
    ],
  },
  {
    title: 'Changes, cancellations & refunds',
    items: [
      'You can cancel for a full refund until your order moves to printing. After that, orders cannot be changed, cancelled, or refunded.',
      'If we make a mistake (a failed burn, a misprint that is not in your files, or the wrong quantity), tell us within 14 days of pickup or delivery and we will fix it at no cost.',
    ],
  },
  {
    title: 'Project retention & reorders',
    items: [
      `We keep your audio and artwork for ${months} months after your most recent paid order for that project. After that, the files may be deleted.`,
      `Reorders within those ${months} months have no setup fee and keep the same per-disc rate as your previous run. If today's rate for the new quantity is lower, you get the lower rate. Sales tax and shipping still apply.`,
      'Reorders use your files and options exactly as before. Any change to audio, artwork, or options is a new order with a setup fee.',
      `Each paid reorder restarts the ${months}-month retention period.`,
    ],
  },
  {
    title: 'Rights & content',
    items: [
      'You confirm that you own, or are licensed to use, all audio and artwork you upload, and that reproducing it does not infringe anyone else\'s rights.',
      'We may decline any order we believe infringes copyright or is unlawful. Declined orders are refunded in full.',
      'Your files are used only to produce your order. We do not share them, and we do not use your work to promote Art Saturated without your permission.',
    ],
  },
]
