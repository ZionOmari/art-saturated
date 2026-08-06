/**
 * Applies a subtle "© Art Saturated" watermark to an image file.
 * Returns a Blob ready for Firebase Storage upload.
 */
export async function applyWatermark(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width  = img.width
      canvas.height = img.height

      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)

      const fontSize = Math.max(14, Math.round(img.width * 0.025))
      ctx.font         = `${fontSize}px monospace`
      ctx.fillStyle    = 'rgba(255,255,255,0.35)'
      ctx.textAlign    = 'right'
      ctx.textBaseline = 'bottom'
      const padding    = fontSize * 0.6
      ctx.fillText('© Art Saturated', img.width - padding, img.height - padding)

      URL.revokeObjectURL(url)
      canvas.toBlob(
        blob => blob ? resolve(blob) : reject(new Error('Watermark failed')),
        file.type || 'image/jpeg',
        0.92,
      )
    }

    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image load failed')) }
    img.src = url
  })
}
