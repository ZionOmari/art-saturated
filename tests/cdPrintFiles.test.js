// The disc file's resolution stamp: disc software sizes an image from this
// header, so a wrong value means a wrongly sized print.
import { describe, it, expect } from 'vitest'
import { setJpegDpi } from '../src/lib/cdPrintFiles.js'

const jfif = () => Uint8Array.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10,
  ...[...'JFIF'].map(c => c.charCodeAt(0)), 0x00,
  0x01, 0x01,     // version
  0x00,           // units
  0x00, 0x60, 0x00, 0x60,   // 96 × 96
  0x00, 0x00,
])

describe('setJpegDpi', () => {
  it('writes the resolution in dots per inch', () => {
    const out = setJpegDpi(jfif(), 300)
    expect(out[13]).toBe(1)
    expect((out[14] << 8) | out[15]).toBe(300)
    expect((out[16] << 8) | out[17]).toBe(300)
  })

  it('leaves the original bytes alone', () => {
    const src = jfif()
    setJpegDpi(src, 300)
    expect(src[13]).toBe(0)
  })

  it('passes through a file with no JFIF header rather than corrupting it', () => {
    const notJfif = Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
    expect(setJpegDpi(notJfif, 300)).toEqual(notJfif)
  })
})
