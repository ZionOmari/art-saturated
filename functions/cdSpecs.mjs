// CD packaging print specs — the ONE place these measurements live.
//
// Shared by the CD printing page (cropper, guides, proof, mock-up) and the
// server (print files), the same way cdPricing.mjs is. Change a number here
// and every one of them follows.
//
// Industry-standard jewel-case sizes. If the outside printer publishes its own
// template, match it here: bleed and the tray spine are the usual differences.

export const DPI = 300
export const BLEED_IN = 0.125   // extra image past the cut line, each side
export const SAFE_IN  = 0.125   // keep text this far inside the cut line

const MM = 1 / 25.4             // inches per millimetre

// Every printed piece. Sizes are the finished (trim) size in inches.
export const PIECES = {
  // Booklet panel: one face of the insert in the front of the case.
  panel: {
    label: 'Booklet panel',
    trimW: 4.75, trimH: 4.75,
    bleed: true,
  },
  // Tray card: behind the clear tray of a jewel case. The two narrow strips
  // at the ends fold into the case's spines.
  tray: {
    label: 'Tray card',
    trimW: 150 * MM, trimH: 117.5 * MM,     // 5.906" × 4.626"
    spineW: 6.5 * MM,                        // each end, 0.256"
    bleed: true,
  },
  // Disc face. Round, so no bleed: the file is the full 120 mm square and the
  // disc software handles alignment. The centre hole and clear hub are
  // marked on the guide so nothing important goes there.
  disc: {
    label: 'Disc face',
    trimW: 120 * MM, trimH: 120 * MM,        // 4.724"
    holeD: 15 * MM,
    hubD: 36 * MM,                           // clear plastic ring — nothing prints here
    bleed: false,
    round: true,
  },
}

/** Full image size in inches, including bleed where the piece has it. */
export function sizeIn(key) {
  const p = PIECES[key]
  const b = p.bleed ? BLEED_IN * 2 : 0
  return { w: p.trimW + b, h: p.trimH + b }
}

/** Full image size in pixels at print resolution. */
export function sizePx(key) {
  const { w, h } = sizeIn(key)
  return { w: Math.round(w * DPI), h: Math.round(h * DPI) }
}

/** Width / height of the full image — what the cropper frame uses. */
export function aspectOf(key) {
  const { w, h } = sizeIn(key)
  return w / h
}

/**
 * Guide lines as fractions (0–1) of the full image, for drawing on a crop or
 * proof at any display size: where the cut falls, the safe area for text,
 * and the spine folds on a tray card.
 */
export function guides(key) {
  const p = PIECES[key]
  const { w, h } = sizeIn(key)
  const b = p.bleed ? BLEED_IN : 0
  const box = (inset) => ({ x: (b + inset) / w, y: (b + inset) / h, w: (p.trimW - inset * 2) / w, h: (p.trimH - inset * 2) / h })
  const g = { trim: box(0), safe: box(SAFE_IN) }
  if (p.spineW) g.spines = [(b + p.spineW) / w, (b + p.trimW - p.spineW) / w]
  if (p.round) { g.hole = p.holeD / p.trimW; g.hub = p.hubD / p.trimW }
  return g
}
