import { SPINE_FONT_PX, normalizeSpine, spineFontPx, spineLayout, spineText, spineTextColor } from '../../functions/cdSpecs.mjs'

const fontAt = (px) => `700 ${px}px Helvetica, Arial, sans-serif`

/** Font size for this spine text, or null if it can't fit even at the minimum. */
export function fitSpineFont(ctx, text) {
  ctx.font = fontAt(SPINE_FONT_PX)
  return spineFontPx(ctx.measureText(text).width, spineLayout().maxTextLength)
}

export function spineTextFits(artist, title) {
  const ctx = document.createElement('canvas').getContext('2d')
  return fitSpineFont(ctx, spineText(artist, title)) !== null
}

/**
 * Paints both spines onto a full-size tray card canvas. 'solid' covers the
 * strip with its own colour; 'extend' leaves the art and outlines the text so
 * it reads on any image.
 */
export function drawSpines(ctx, { artistName, albumTitle, ...raw }) {
  const { spineStyle, spineColor } = normalizeSpine(raw)
  const { strips, height } = spineLayout()
  const text = spineText(artistName, albumTitle)
  const font = fitSpineFont(ctx, text) ?? 24

  for (const s of strips) {
    if (spineStyle === 'solid') {
      ctx.fillStyle = spineColor
      ctx.fillRect(s.x, 0, s.w, height)
    }
    ctx.save()
    ctx.translate(s.cx, height / 2)
    ctx.rotate((s.rotate * Math.PI) / 180)
    ctx.font = fontAt(font)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    if (spineStyle === 'extend') {
      ctx.lineWidth = 6
      ctx.lineJoin = 'round'
      ctx.strokeStyle = '#000000'
      ctx.strokeText(text, 0, 0)
      ctx.fillStyle = '#ffffff'
    } else {
      ctx.fillStyle = spineTextColor(spineColor)
    }
    ctx.fillText(text, 0, 0)
    ctx.restore()
  }
}
