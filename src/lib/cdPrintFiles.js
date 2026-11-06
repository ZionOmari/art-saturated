import { BLEED_IN, DPI, PIECES, guides, normalizeSpine, printFileList, sizeIn, sizePx, spineText } from '../../functions/cdSpecs.mjs'
import { drawSpines } from './cdSpine'

// Builds an order's print package in the browser: exact-size PDFs for the
// outside printer, and a 300 dpi disc image for the alignment software. Run on
// demand from the admin, so a corrected spec applies to any order. pdf-lib and
// fflate load here rather than in the main bundle — customers never need them.

const PT = 72   // PDF points per inch

function canvasOf(w, h) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  return { canvas, ctx }
}

async function jpegBytes(canvas) {
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.95))
  return new Uint8Array(await blob.arrayBuffer())
}

/**
 * Stamps a JPEG's header with its print resolution. Canvas output says 96 dpi,
 * which would make disc software read a 120 mm image as about 15 inches wide.
 */
export function setJpegDpi(bytes, dpi) {
  const isJfif = bytes[2] === 0xff && bytes[3] === 0xe0
    && String.fromCharCode(...bytes.slice(6, 10)) === 'JFIF'
  if (!isJfif) return bytes
  const out = bytes.slice()
  out[13] = 1   // units: dots per inch
  out[14] = out[16] = dpi >> 8
  out[15] = out[17] = dpi & 255
  return out
}

// One PDF page of a JPEG, with the cut marked as the TrimBox so a printer's
// software knows where the bleed ends without marks being drawn on the art.
async function pdfOf(PDFDocument, jpeg, widthIn, heightIn) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([widthIn * PT, heightIn * PT])
  const img = await doc.embedJpg(jpeg)
  page.drawImage(img, { x: 0, y: 0, width: widthIn * PT, height: heightIn * PT })
  const b = BLEED_IN * PT
  page.setBleedBox(0, 0, widthIn * PT, heightIn * PT)
  page.setTrimBox(b, b, widthIn * PT - b * 2, heightIn * PT - b * 2)
  return doc.save()
}

async function buildSpread(load, PDFDocument, file) {
  const p = sizePx('panel')
  const bleed = BLEED_IN * DPI
  const W = Math.round(p.w * 2 - bleed * 2), H = p.h
  const { canvas, ctx } = canvasOf(W, H)
  const left  = await load(file.left)
  const right = await load(file.right)
  // Each panel keeps its bleed on the outer edge only; they meet at the fold.
  ctx.drawImage(left,  0, 0, p.w - bleed, p.h, 0, 0, W / 2, H)
  ctx.drawImage(right, bleed, 0, p.w - bleed, p.h, W / 2, 0, W / 2, H)
  const size = sizeIn('panel')
  return pdfOf(PDFDocument, await jpegBytes(canvas), size.w * 2 - BLEED_IN * 2, size.h)
}

async function buildTray(load, PDFDocument, file, order) {
  const p = sizePx('tray')
  const { canvas, ctx } = canvasOf(p.w, p.h)
  ctx.drawImage(await load(file.art), 0, 0, p.w, p.h)
  drawSpines(ctx, order)
  const size = sizeIn('tray')
  return pdfOf(PDFDocument, await jpegBytes(canvas), size.w, size.h)
}

async function buildDisc(load, file) {
  const p = sizePx('disc')
  const { canvas, ctx } = canvasOf(p.w, p.h)
  const img = await load(file.art)
  if (file.fromCover) {
    // Front cover art has bleed: use only what's inside its cut line.
    const t = guides('panel').trim
    ctx.drawImage(img, t.x * img.width, t.y * img.height, t.w * img.width, t.h * img.height, 0, 0, p.w, p.h)
  } else {
    ctx.drawImage(img, 0, 0, p.w, p.h)
  }
  return setJpegDpi(await jpegBytes(canvas), DPI)
}

function readme(order, files) {
  const inches = (k) => `${PIECES[k].trimW.toFixed(3)}" x ${PIECES[k].trimH.toFixed(3)}"`
  const spine = normalizeSpine(order)
  return [
    `Art Saturated CD order ${order.id.slice(-6).toUpperCase()}`,
    `${order.artistName} - ${order.albumTitle}`,
    `${order.qty} x ${order.packaging}, ${order.panelCount || 0}-panel, ${order.stock || 'standard'}`,
    '',
    'All files are 300 dpi. PDFs include a 1/8" bleed; the cut is set as the TrimBox.',
    `Booklet panel finished size: ${inches('panel')}`,
    order.packaging === 'jewel' ? `Tray card finished size: ${inches('tray')}, spines ${PIECES.tray.spineW.toFixed(3)}" each` : '',
    order.packaging === 'jewel' ? `Spine: ${spine.spineStyle === 'extend' ? 'cover art extended' : `solid ${spine.spineColor}`} / "${spineText(order.artistName, order.albumTitle)}"` : '',
    `Disc: 120 mm${files.some(f => f.fromCover) ? ', made from the front cover (no disc art supplied)' : ''}`,
    '',
    'Files:',
    ...files.map(f => `  ${f.name}`),
    '',
  ].filter(l => l !== '').join('\n') + '\n'
}

/** Resolves with { blob, filename, files }. onProgress gets a short status string. */
export async function buildPrintPackage(order, onProgress = () => {}) {
  const [{ PDFDocument }, { zipSync, strToU8 }] = await Promise.all([import('pdf-lib'), import('fflate')])
  const files = printFileList(order)
  if (!files.length) throw new Error('This order has no artwork to build from.')

  const bytes = {}, images = {}
  const fetchBytes = async (key) => {
    if (bytes[key]) return bytes[key]
    const res = await fetch(order.artwork[key])
    if (!res.ok) throw new Error(`Could not download ${key} (${res.status}).`)
    return (bytes[key] = new Uint8Array(await res.arrayBuffer()))
  }
  const load = async (key) => {
    if (images[key]) return images[key]
    const b = await fetchBytes(key)
    return (images[key] = await createImageBitmap(new Blob([b], { type: 'image/jpeg' })))
  }

  const zip = {}
  for (const [i, file] of files.entries()) {
    onProgress(`Building ${i + 1} of ${files.length}…`)
    if (file.kind === 'single') {
      const size = sizeIn('panel')
      zip[file.name] = await pdfOf(PDFDocument, await fetchBytes(file.art), size.w, size.h)
    } else if (file.kind === 'spread') {
      zip[file.name] = await buildSpread(load, PDFDocument, file)
    } else if (file.kind === 'tray') {
      zip[file.name] = await buildTray(load, PDFDocument, file, order)
    } else {
      zip[file.name] = await buildDisc(load, file)
    }
  }
  zip['README.txt'] = strToU8(readme(order, files))

  const out = zipSync(zip, { level: 0 })   // PDFs and JPEGs are already compressed
  return {
    blob: new Blob([out], { type: 'application/zip' }),
    filename: `cd-order-${order.id.slice(-6).toUpperCase()}-print-files.zip`,
    files: Object.keys(zip),
  }
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}
