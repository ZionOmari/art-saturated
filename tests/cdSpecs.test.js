// Print-size contract for CD packaging (functions/cdSpecs.mjs).
// These numbers decide whether a printer accepts a file, so they're pinned.
import { describe, it, expect } from 'vitest'
import { DPI, BLEED_IN, PIECES, sizeIn, sizePx, aspectOf, guides, effectiveDpi, dpiQuality } from '../functions/cdSpecs.mjs'

describe('cdSpecs — print sizes', () => {
  it('prints at 300 dpi with an 1/8" bleed', () => {
    expect(DPI).toBe(300)
    expect(BLEED_IN).toBe(0.125)
  })

  it('makes a booklet panel 4.75" trim + bleed = 1500 px square (what past orders used)', () => {
    expect(sizeIn('panel')).toEqual({ w: 5, h: 5 })
    expect(sizePx('panel')).toEqual({ w: 1500, h: 1500 })
  })

  it('makes a tray card 150 × 117.5 mm plus bleed, with 6.5 mm spines', () => {
    expect(PIECES.tray.trimW * 25.4).toBeCloseTo(150, 5)
    expect(PIECES.tray.trimH * 25.4).toBeCloseTo(117.5, 5)
    expect(PIECES.tray.spineW * 25.4).toBeCloseTo(6.5, 5)
    expect(sizePx('tray')).toEqual({ w: 1847, h: 1463 })
  })

  it('makes a disc exactly 120 mm with no bleed', () => {
    expect(sizePx('disc')).toEqual({ w: 1417, h: 1417 })
    expect(guides('disc').trim).toEqual({ x: 0, y: 0, w: 1, h: 1 })
    expect(guides('disc').hole).toBeCloseTo(15 / 120, 5)
    expect(guides('disc').hub).toBeCloseTo(36 / 120, 5)
  })

  it('keeps the crop frame the same shape as the print file', () => {
    for (const k of Object.keys(PIECES)) {
      const px = sizePx(k)
      expect(Math.abs(px.w / px.h - aspectOf(k))).toBeLessThan(0.002)
    }
  })

  it('puts the cut line one bleed in from each edge and the safe area inside it', () => {
    const g = guides('panel')
    expect(g.trim.x).toBeCloseTo(0.125 / 5, 6)
    expect(g.trim.x + g.trim.w).toBeCloseTo(1 - 0.125 / 5, 6)
    expect(g.safe.x).toBeGreaterThan(g.trim.x)
    expect(g.safe.w).toBeLessThan(g.trim.w)
  })

  it('places tray spine folds symmetrically, inside the cut line', () => {
    const { spines, trim } = guides('tray')
    expect(spines[0]).toBeGreaterThan(trim.x)
    expect(spines[0] + spines[1]).toBeCloseTo(1, 6)
  })

  it('reports the resolution an image will actually print at', () => {
    expect(effectiveDpi('panel', 1500)).toBe(300)   // exact fit
    expect(effectiveDpi('panel', 750)).toBe(150)    // half the pixels
    expect(effectiveDpi('disc', 1417)).toBe(300)
    expect(effectiveDpi('tray', 1847)).toBe(300)
  })

  it('grades print resolution at the 225 and 150 dpi lines', () => {
    expect(dpiQuality(300)).toBe('good')
    expect(dpiQuality(225)).toBe('good')
    expect(dpiQuality(224)).toBe('soft')
    expect(dpiQuality(150)).toBe('soft')
    expect(dpiQuality(149)).toBe('blurry')
  })
})
