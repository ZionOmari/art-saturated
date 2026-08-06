import { useEffect, useRef } from 'react'

/**
 * EnigmaField — the reusable "Enigma" visual: white specks drifting on a black
 * field. Extracted from the landing/splash page so the SAME asset can back the
 * splash screen, the shop preorder cover, and the homepage banner Easter egg.
 * (Per the "Enigma Preorder" spec — this is the landing-page preorder visual.)
 *
 * Props:
 *   fullscreen   — fixed, covers the viewport (splash use). Otherwise fills its parent.
 *   density      — specks per 10,000 px²; count scales with area (default 0.9).
 *   background   — field color (default '#000').
 *   className    — forwarded to the wrapper.
 *   style        — merged into the wrapper style.
 *   contentStyle — style for the overlay layer that holds `children` (sits above the field).
 *   children     — overlay content (text, buttons) rendered above the specks.
 */
export default function EnigmaField({
  fullscreen = false,
  density    = 0.9,
  background = '#000',
  className,
  style,
  contentStyle,
  children,
}) {
  const canvasRef = useRef(null)
  const wrapRef   = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap   = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')
    let animId
    let particles = []

    function size() {
      const w = fullscreen ? window.innerWidth  : wrap.clientWidth
      const h = fullscreen ? window.innerHeight : wrap.clientHeight
      if (w === 0 || h === 0) return
      canvas.width  = w
      canvas.height = h
      const count = Math.max(20, Math.round((w * h) / 10000 * density))
      particles = Array.from({ length: count }, () => ({
        x:            Math.random() * w,
        y:            Math.random() * h,
        vx:           (Math.random() - 0.5) * 0.25,
        vy:           (Math.random() - 0.5) * 0.25,
        r:            Math.random() * 1.4 + 0.3,
        alpha:        Math.random() * 0.55 + 0.15,
        twinkleSpeed: Math.random() * 0.004 + 0.001,
        twinkleDir:   Math.random() > 0.5 ? 1 : -1,
      }))
    }
    size()

    function draw() {
      const w = canvas.width, h = canvas.height
      ctx.clearRect(0, 0, w, h)
      for (const p of particles) {
        p.x     += p.vx
        p.y     += p.vy
        p.alpha += p.twinkleSpeed * p.twinkleDir
        if (p.alpha > 0.8 || p.alpha < 0.08) p.twinkleDir *= -1
        if (p.x < 0) p.x = w
        if (p.x > w) p.x = 0
        if (p.y < 0) p.y = h
        if (p.y > h) p.y = 0
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255,255,255,${p.alpha.toFixed(3)})`
        ctx.fill()
      }
      animId = requestAnimationFrame(draw)
    }
    draw()

    let ro
    if (fullscreen) {
      window.addEventListener('resize', size)
    } else {
      ro = new ResizeObserver(size)
      ro.observe(wrap)
    }

    return () => {
      cancelAnimationFrame(animId)
      if (fullscreen) window.removeEventListener('resize', size)
      else if (ro) ro.disconnect()
    }
  }, [fullscreen, density])

  const wrapStyle = fullscreen
    ? { position: 'fixed', inset: 0, background, overflow: 'hidden', ...style }
    : { position: 'relative', width: '100%', height: '100%', background, overflow: 'hidden', ...style }

  return (
    <div ref={wrapRef} className={className} style={wrapStyle}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, display: 'block' }} />
      {children != null && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 1, ...contentStyle }}>
          {children}
        </div>
      )}
    </div>
  )
}
