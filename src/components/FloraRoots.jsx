import { useEffect, useRef } from 'react'

const COLORS      = ['#7a5c3a', '#5e4228', '#a07850', '#4a3520', '#6b4c2a']
const NUM_ROOTS   = 12
const SPEED       = 1.4

function rand(min, max) { return Math.random() * (max - min) + min }
function randInt(min, max) { return Math.floor(rand(min, max)) }

function spawnFromEdge(w, h) {
  const edge = randInt(0, 4)
  if (edge === 0) return { x: rand(0, w), y: 0 }
  if (edge === 1) return { x: rand(0, w), y: h }
  if (edge === 2) return { x: 0,          y: rand(0, h) }
  return              { x: w,             y: rand(0, h) }
}

class Root {
  constructor(w, h, isRoot = true) {
    const start   = isRoot ? spawnFromEdge(w, h) : { x: 0, y: 0 }
    this.pts      = [start]
    this.drawnTo  = 0
    this.color    = COLORS[randInt(0, COLORS.length)]
    this.width    = rand(0.6, 1.8)
    this.opacity  = rand(0.3, 0.65)
    this.drift    = { x: rand(-0.8, 0.8), y: rand(-0.8, 0.8) }
    this.branches = []

    if (isRoot) {
      const count = randInt(4, 7)
      for (let i = 0; i < count; i++) {
        const b   = new Root(0, 0, false)
        b.pts     = [{ ...start }]
        b.width   = this.width * rand(0.3, 0.6)
        b.opacity = this.opacity * rand(0.45, 0.75)
        b.drift   = { x: rand(-1, 1), y: rand(-1, 1) }
        this.branches.push(b)
      }
    }
  }

  grow(tx, ty, speedFactor) {
    const last = this.pts[this.pts.length - 1]
    const dx   = tx - last.x
    const dy   = ty - last.y
    const dist = Math.sqrt(dx * dx + dy * dy) || 1
    const spd  = SPEED * speedFactor

    this.drift.x += (dx / dist) * 0.3 * speedFactor + rand(-0.08, 0.08)
    this.drift.y += (dy / dist) * 0.3 * speedFactor + rand(-0.08, 0.08)
    this.drift.x *= 0.92
    this.drift.y *= 0.92

    const dmag = Math.sqrt(this.drift.x ** 2 + this.drift.y ** 2) || 1
    if (dmag > spd) {
      this.drift.x = (this.drift.x / dmag) * spd
      this.drift.y = (this.drift.y / dmag) * spd
    }

    this.pts.push({ x: last.x + this.drift.x, y: last.y + this.drift.y })

    if (this.pts.length > 20 && Math.random() < 0.006 && this.branches.length < 2) {
      const b   = new Root(0, 0, false)
      b.pts     = [{ x: last.x, y: last.y }]
      b.drawnTo = 0
      b.width   = this.width * rand(0.35, 0.55)
      b.opacity = this.opacity * rand(0.45, 0.7)
      b.drift   = { x: this.drift.x + rand(-0.5, 0.5), y: this.drift.y + rand(-0.5, 0.5) }
      this.branches.push(b)
    }

    this.branches.forEach(b => b.grow(tx, ty, speedFactor))
  }

  drawNew(ctx) {
    const start = this.drawnTo
    const end   = this.pts.length - 1
    if (end - start < 1) return

    ctx.save()
    ctx.globalAlpha = this.opacity
    ctx.strokeStyle = this.color
    ctx.lineWidth   = this.width
    ctx.lineCap     = 'round'
    ctx.lineJoin    = 'round'
    ctx.beginPath()
    ctx.moveTo(this.pts[start].x, this.pts[start].y)
    for (let i = start + 1; i <= end; i++) {
      const prev = this.pts[i - 1]
      const curr = this.pts[i]
      ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + curr.x) / 2, (prev.y + curr.y) / 2)
    }
    ctx.stroke()
    ctx.restore()

    this.drawnTo = end
    this.branches.forEach(b => b.drawNew(ctx))
  }
}

export default function FloraRoots() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas    = canvasRef.current
    const ctx       = canvas.getContext('2d')
    let roots       = []
    let cursor      = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    let frameId     = null
    const startTime = Date.now()

    function resize() {
      canvas.width  = window.innerWidth
      canvas.height = window.innerHeight
      roots.forEach(r => { r.drawnTo = 0 })
    }
    resize()
    window.addEventListener('resize', resize)

    function onMove(e) { cursor.x = e.clientX; cursor.y = e.clientY }
    window.addEventListener('mousemove', onMove)

    function onTouch(e) {
      const t = e.touches[0]
      if (t) { cursor.x = t.clientX; cursor.y = t.clientY }
    }
    window.addEventListener('touchmove', onTouch, { passive: true })

    for (let i = 0; i < NUM_ROOTS; i++) roots.push(new Root(canvas.width, canvas.height))

    function loop() {
      const elapsed     = (Date.now() - startTime) / 1000
      const speedFactor = Math.exp(-0.038 * elapsed)
      roots.forEach(r => { r.grow(cursor.x, cursor.y, speedFactor); r.drawNew(ctx) })
      frameId = requestAnimationFrame(loop)
    }
    loop()

    return () => {
      cancelAnimationFrame(frameId)
      window.removeEventListener('resize', resize)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('touchmove', onTouch)
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh', pointerEvents: 'none', zIndex: 0 }}
    />
  )
}
