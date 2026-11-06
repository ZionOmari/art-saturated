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

// Below GOOD_DPI a print looks soft; below MIN_DPI it looks visibly blurry.
export const GOOD_DPI = 225
export const MIN_DPI  = 150

/**
 * Print resolution an image will have, given how many of its own pixels fall
 * across the width of the crop frame.
 */
export function effectiveDpi(key, sourcePxAcross) {
  return Math.round(sourcePxAcross / sizeIn(key).w)
}

/** 'good' | 'soft' | 'blurry' for a resolution from effectiveDpi(). */
export function dpiQuality(dpi) {
  if (dpi >= GOOD_DPI) return 'good'
  return dpi >= MIN_DPI ? 'soft' : 'blurry'
}

// ── Tray card spines ─────────────────────────────────────────────────────────
// A spine is its own design by default: a solid strip with the text set
// automatically. 'extend' keeps the customer's tray art running through it.
export const SPINE_STYLES = ['solid', 'extend']
export const DEFAULT_SPINE = { spineStyle: 'solid', spineColor: '#000000' }

export const SPINE_FONT_PX = 42   // ≈ 2.5 mm capitals at 300 dpi
const SPINE_MIN_FONT  = 24
const SPINE_MARGIN_IN = 0.2       // keep text this far from the top and bottom cut

// Degrees to rotate the text, on the flat printed tray card seen from the
// printed side. The spines read in opposite directions: letter tops face
// outward on the flat sheet, which is toward the front of the case once folded.
export const SPINE_ROTATION = { left: -90, right: 90 }

/** Valid spine settings from whatever was stored on an order. */
export function normalizeSpine(raw = {}) {
  return {
    spineStyle: SPINE_STYLES.includes(raw.spineStyle) ? raw.spineStyle : DEFAULT_SPINE.spineStyle,
    spineColor: /^#[0-9a-f]{6}$/i.test(raw.spineColor || '') ? raw.spineColor.toLowerCase() : DEFAULT_SPINE.spineColor,
  }
}

/** Black or white, whichever reads better on a spine colour. */
export function spineTextColor(hex) {
  const n = parseInt(hex.slice(1), 16)
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.55 ? '#000000' : '#ffffff'
}

export const spineText = (artist, title) => `${artist || 'Artist'} — ${title || 'Title'}`.toUpperCase()

/**
 * Where the spines fall in the full tray file, in pixels. Each strip runs out
 * through the bleed so a solid colour reaches past the cut. cx is the centre
 * of the visible spine, where the text sits.
 */
export function spineLayout() {
  const t = PIECES.tray
  const { w, h } = sizePx('tray')
  const bleed = BLEED_IN * DPI
  const spine = t.spineW * DPI
  return {
    height: h,
    maxTextLength: Math.round((t.trimH - SPINE_MARGIN_IN * 2) * DPI),
    strips: [
      { side: 'left',  x: 0,                 w: bleed + spine, cx: bleed + spine / 2,     rotate: SPINE_ROTATION.left },
      { side: 'right', x: w - bleed - spine, w: bleed + spine, cx: w - bleed - spine / 2, rotate: SPINE_ROTATION.right },
    ],
  }
}

/** Font size that fits, given the text's width at SPINE_FONT_PX. Null = too long even at the minimum. */
export function spineFontPx(widthAtFull, maxLength) {
  if (widthAtFull <= maxLength) return SPINE_FONT_PX
  const size = Math.floor((SPINE_FONT_PX * maxLength) / widthAtFull)
  return size >= SPINE_MIN_FONT ? size : null
}

// ── Print package ────────────────────────────────────────────────────────────
const PANEL_NAMES = {
  2: ['front', 'back'],
  4: ['front', 'inside-left', 'inside-right', 'back'],
}

/**
 * What goes to print for an order. Each entry names a file and what it's built
 * from: `single` is one piece, `spread` is two panels joined at the fold, left
 * then right as seen from the printed side. The disc falls back to the front
 * cover when no disc art was uploaded.
 */
export function printFileList({ packaging, panelCount, artwork = {} }) {
  const files = []
  const panels = packaging === 'sleeve' ? [] : (PANEL_NAMES[panelCount] || PANEL_NAMES[4])
  panels.forEach((name, i) => {
    if (artwork[`panel${i}`]) files.push({ name: `booklet/panel-${i + 1}-${name}.pdf`, kind: 'single', art: `panel${i}` })
  })
  const backIdx = panels.indexOf('back')
  if (backIdx >= 0 && artwork[`panel${backIdx}`] && artwork.panel0) {
    files.push({ name: 'booklet/spread-outside.pdf', kind: 'spread', left: `panel${backIdx}`, right: 'panel0' })
  }
  if (panels.length === 4 && artwork.panel1 && artwork.panel2) {
    files.push({ name: 'booklet/spread-inside.pdf', kind: 'spread', left: 'panel1', right: 'panel2' })
  }
  if (packaging === 'jewel' && artwork.tray) files.push({ name: 'tray-card.pdf', kind: 'tray', art: 'tray' })
  if (artwork.disc) files.push({ name: 'disc-120mm.jpg', kind: 'disc', art: 'disc' })
  else if (artwork.panel0) files.push({ name: 'disc-120mm.jpg', kind: 'disc', art: 'panel0', fromCover: true })
  return files
}
