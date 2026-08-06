import { useEffect, useRef } from 'react'

// ── Tuning ────────────────────────────────────────────────────────────────────
const FADE_MS  = 5000   // ms until a point is fully invisible
const MIN_DIST = 2      // px — min movement before adding a new point

// Three strands: main + two echoes that lag further behind.
// lerp  = spring factor (lower = more lag / more expressive)
// width = stroke width
// alpha = peak opacity
// drift = pixels of organic wander applied to this strand's draw head
const STRANDS = [
  { lerp: 0.050, width: 1.8, alpha: 0.90, drift: 0   },   // main
  { lerp: 0.028, width: 1.1, alpha: 0.55, drift: 10  },   // echo 1
  { lerp: 0.016, width: 0.7, alpha: 0.32, drift: 18  },   // echo 2 — furthest lag
]

export default function DrawingCanvas() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx    = canvas.getContext('2d')

    canvas.width  = window.innerWidth
    canvas.height = window.innerHeight

    // ── Per-strand state ──────────────────────────────────────────────────────
    const state = STRANDS.map(() => ({
      draw:  null,          // {x, y} smoothed draw head
      pts:   [],            // [{x, y, t}]
      wander: { x: 0, y: 0 }, // accumulated organic drift
    }))

    let real = null   // raw cursor
    let raf  = null

    function resize() {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
      state.forEach(s => { s.pts = []; s.draw = null })
    }
    window.addEventListener('resize', resize)

    // ── Helpers ───────────────────────────────────────────────────────────────

    function dist2(a, b) {
      const dx = a.x - b.x, dy = a.y - b.y
      return dx * dx + dy * dy
    }

    // Colour shifts gently with position
    function getHue(x, y) {
      return ((x / canvas.width) * 260 + (y / canvas.height) * 100) % 360
    }

    // ── Animation loop ────────────────────────────────────────────────────────

    function loop(now) {
      raf = requestAnimationFrame(loop)

      const cutoff = now - FADE_MS - 80

      for (let si = 0; si < STRANDS.length; si++) {
        const cfg = STRANDS[si]
        const s   = state[si]

        if (real) {
          // Organic wander (only for echo strands)
          if (cfg.drift > 0) {
            s.wander.x += (Math.random() - 0.5) * 0.6
            s.wander.y += (Math.random() - 0.5) * 0.6
            s.wander.x *= 0.88
            s.wander.y *= 0.88
          }

          const targetX = real.x + s.wander.x * cfg.drift
          const targetY = real.y + s.wander.y * cfg.drift

          if (!s.draw) {
            s.draw = { x: targetX, y: targetY }
          } else {
            s.draw.x += (targetX - s.draw.x) * cfg.lerp
            s.draw.y += (targetY - s.draw.y) * cfg.lerp
          }

          const last = s.pts[s.pts.length - 1]
          if (!last || dist2(s.draw, last) > MIN_DIST * MIN_DIST) {
            s.pts.push({ x: s.draw.x, y: s.draw.y, t: now })
          }
        }

        // Prune expired points
        if (s.pts.length && s.pts[0].t < cutoff) {
          s.pts = s.pts.filter(p => p.t >= cutoff)
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      // Draw strands back-to-front so main is on top
      for (let si = STRANDS.length - 1; si >= 0; si--) {
        renderStrand(ctx, state[si].pts, STRANDS[si], now)
      }
    }

    // Midpoint quadratic Bézier — eliminates all jaggedness
    function renderStrand(ctx, pts, cfg, now) {
      if (pts.length < 2) return

      for (let i = 1; i < pts.length; i++) {
        const p0    = pts[i - 1]
        const p1    = pts[i]
        const age   = now - p0.t
        const fade  = Math.max(0, 1 - age / FADE_MS)
        if (fade < 0.01) continue

        const mx  = (p0.x + p1.x) / 2
        const my  = (p0.y + p1.y) / 2
        const hue = getHue(mx, my)

        ctx.save()
        ctx.globalAlpha = fade * cfg.alpha
        ctx.strokeStyle = `hsl(${hue}, 60%, 20%)`
        ctx.lineWidth   = cfg.width
        ctx.lineCap     = 'round'
        ctx.lineJoin    = 'round'
        ctx.beginPath()

        if (i === 1) {
          ctx.moveTo(p0.x, p0.y)
          ctx.lineTo(mx, my)
        } else {
          const prev = pts[i - 2]
          const pm   = { x: (prev.x + p0.x) / 2, y: (prev.y + p0.y) / 2 }
          ctx.moveTo(pm.x, pm.y)
          ctx.quadraticCurveTo(p0.x, p0.y, mx, my)
        }

        ctx.stroke()
        ctx.restore()
      }
    }

    // ── Input ─────────────────────────────────────────────────────────────────

    function onMove(e) {
      const x = e.clientX ?? e.touches?.[0]?.clientX
      const y = e.clientY ?? e.touches?.[0]?.clientY
      if (x == null) return
      real = { x, y }
    }

    function onLeave() {
      // Let existing strokes fade naturally — just stop advancing draw heads
      real = null
      state.forEach(s => { s.draw = null })
    }

    raf = requestAnimationFrame(loop)
    window.addEventListener('mousemove',  onMove)
    window.addEventListener('mouseleave', onLeave)
    window.addEventListener('touchmove',  onMove,   { passive: true })
    window.addEventListener('touchend',   onLeave)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize',      resize)
      window.removeEventListener('mousemove',   onMove)
      window.removeEventListener('mouseleave',  onLeave)
      window.removeEventListener('touchmove',   onMove)
      window.removeEventListener('touchend',    onLeave)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', inset: 0,
        width: '100vw', height: '100vh',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  )
}
