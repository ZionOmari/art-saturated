import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Home-page walkthrough.
 *
 * Two doors — buy or sell — each opening a short animated run-through of the
 * real flow. The animations are self-contained CSS on mock elements rather than
 * a spotlight over the live UI: nothing here breaks when the shop markup
 * changes, and it works for signed-out visitors, which is most of the traffic.
 *
 * Dismissal is remembered. Every animation is disabled under
 * prefers-reduced-motion — the steps still read fine as static diagrams.
 */

const DISMISS_KEY = 'as_walkthrough_dismissed_v1'

const TRACKS = {
  buy: {
    label: "I'm here to buy",
    hint: 'Art, records, and handmade goods',
    accent: '#7a5030',
    cta: { text: 'Browse the shop', to: '/shop' },
    steps: [
      { title: 'Browse the shop', body: 'Original art, vinyl, vintage tech and handmade goods — everything is one of a small run.', art: 'grid' },
      { title: 'Open a piece', body: 'Full photos, size, medium and year. Records get track previews you can play before buying.', art: 'detail' },
      { title: 'Add to cart', body: 'Shipping is calculated from the actual weight, so the price you see is the price you pay.', art: 'cart' },
      { title: 'Checkout securely', body: 'Card payment through Stripe. You get a confirmation email, then tracking when it ships.', art: 'done' },
    ],
  },
  sell: {
    label: "I'm here to sell",
    hint: 'List your work in the shop',
    accent: '#3a6a4a',
    cta: { text: 'Start uploading', to: '/gallery-upload' },
    steps: [
      { title: 'Join for $7.99/month', body: 'Unlimited uploads, no per-listing fees. Cancel any time — work you have listed stays up.', art: 'member' },
      { title: 'Add your photos', body: 'Drop a whole batch at once. Each photo becomes its own piece, ready to fill in.', art: 'upload' },
      { title: 'Fill in the details', body: 'Title, medium, size, year. Several shots of the same piece? Group them onto one card.', art: 'fields' },
      { title: 'Go live in the shop', body: 'Every piece is reviewed within 48 hours, then appears in the shop and on your artist profile.', art: 'live' },
    ],
  },
}

// ── Mock artwork per step — pure CSS, no live data ──────────────────────────
function StepArt({ kind, accent }) {
  const box = {
    position: 'relative', width: '100%', height: 150,
    border: '1px solid rgb(var(--color-warm-gray-light))',
    background: 'rgb(var(--color-offwhite))',
    overflow: 'hidden', display: 'grid', placeItems: 'center',
  }
  const tile = (extra = {}) => ({
    background: 'rgb(var(--color-warm-gray-light))', borderRadius: 1, ...extra,
  })

  if (kind === 'grid') return (
    <div style={box}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,40px)', gap: 8 }}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="wt-pop" style={{ ...tile({ height: 40 }), animationDelay: `${i * 90}ms` }} />
        ))}
      </div>
    </div>
  )

  if (kind === 'detail') return (
    <div style={box}>
      <div className="wt-rise" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={tile({ width: 62, height: 62 })} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={tile({ width: 66, height: 7 })} />
          <div style={tile({ width: 44, height: 7, opacity: 0.6 })} />
          <div style={{ ...tile({ width: 30, height: 9 }), background: accent, marginTop: 3 }} />
        </div>
      </div>
    </div>
  )

  if (kind === 'cart') return (
    <div style={box}>
      <div style={{ position: 'relative', width: 130, height: 74 }}>
        <div style={tile({ width: 44, height: 44, position: 'absolute', left: 0, top: 14 })} />
        <div className="wt-fly" style={{ ...tile({ width: 20, height: 20, position: 'absolute', left: 12, top: 26 }), background: accent }} />
        <div style={{
          position: 'absolute', right: 0, top: 18, width: 34, height: 30,
          border: `1.5px solid ${accent}`, borderRadius: 2,
        }} />
        <span className="wt-badge" style={{
          position: 'absolute', right: -6, top: 10, width: 17, height: 17, borderRadius: '50%',
          background: accent, color: '#fff', fontSize: 10, fontFamily: 'monospace',
          display: 'grid', placeItems: 'center',
        }}>1</span>
      </div>
    </div>
  )

  if (kind === 'done' || kind === 'live') return (
    <div style={box}>
      <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r="24" fill="none" stroke={accent} strokeWidth="2.5"
                className="wt-ring" strokeDasharray="151" strokeDashoffset="151" />
        <path d="M21 33 l8 8 l15 -16" fill="none" stroke={accent} strokeWidth="3"
              strokeLinecap="round" strokeLinejoin="round"
              className="wt-check" strokeDasharray="40" strokeDashoffset="40" />
      </svg>
    </div>
  )

  if (kind === 'member') return (
    <div style={box}>
      <div className="wt-rise" style={{
        border: `1.5px solid ${accent}`, padding: '14px 20px', textAlign: 'center', background: 'rgb(var(--color-cream))',
      }}>
        <p style={{ fontFamily: 'serif', fontSize: '1.5rem', color: accent, margin: 0, lineHeight: 1 }}>$7.99</p>
        <p style={{ fontFamily: 'monospace', fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'rgb(var(--color-warm-gray))', margin: '5px 0 0' }}>
          per month
        </p>
      </div>
    </div>
  )

  if (kind === 'upload') return (
    <div style={box}>
      <div style={{ position: 'relative', width: 150, height: 96 }}>
        <div style={{
          position: 'absolute', inset: 0, border: '1px dashed rgb(var(--color-warm-gray-light))',
        }} />
        {[0, 1, 2].map(i => (
          <div key={i} className="wt-drop" style={{
            ...tile({ width: 34, height: 34 }),
            position: 'absolute', left: 14 + i * 44, top: 30,
            animationDelay: `${i * 220}ms`,
          }} />
        ))}
      </div>
    </div>
  )

  if (kind === 'fields') return (
    <div style={box}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <div style={tile({ width: 46, height: 46 })} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {[80, 60, 68].map((w, i) => (
            <div key={i} style={{ position: 'relative', width: w, height: 8, border: '1px solid rgb(var(--color-warm-gray-light))' }}>
              <div className="wt-type" style={{ position: 'absolute', inset: 0, background: accent, opacity: 0.35, animationDelay: `${i * 300}ms` }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  return <div style={box} />
}

export default function Walkthrough() {
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(true)   // assume hidden until storage is read
  const [track, setTrack] = useState(null)           // 'buy' | 'sell'
  const [step, setStep] = useState(0)
  const panelRef = useRef(null)

  useEffect(() => {
    try { setDismissed(localStorage.getItem(DISMISS_KEY) === '1') }
    catch { setDismissed(false) }   // private mode — just show it
  }, [])

  // Move focus to the panel when a track opens, so keyboard and screen-reader
  // users land on the content they just asked for.
  useEffect(() => { if (track) panelRef.current?.focus() }, [track])

  function dismiss() {
    setDismissed(true)
    setTrack(null)
    try { localStorage.setItem(DISMISS_KEY, '1') } catch { /* non-fatal */ }
  }

  if (dismissed) return null

  const t = track ? TRACKS[track] : null
  const isLast = t && step === t.steps.length - 1

  return (
    <section aria-labelledby="wt-heading" className="max-w-4xl mx-auto px-6 pb-16">
      <style>{`
        @keyframes wtPop   { from { opacity:0; transform:scale(.82) } to { opacity:1; transform:none } }
        @keyframes wtRise  { from { opacity:0; transform:translateY(10px) } to { opacity:1; transform:none } }
        @keyframes wtFly   { 0%{transform:translate(0,0);opacity:1} 70%{transform:translate(74px,-6px) scale(.6);opacity:1} 100%{transform:translate(74px,-6px) scale(.3);opacity:0} }
        @keyframes wtBadge { 0%,55%{transform:scale(0);opacity:0} 70%{transform:scale(1.25);opacity:1} 100%{transform:scale(1);opacity:1} }
        @keyframes wtDraw  { to { stroke-dashoffset:0 } }
        @keyframes wtDrop  { from { opacity:0; transform:translateY(-24px) } to { opacity:1; transform:none } }
        @keyframes wtType  { from { transform:scaleX(0) } to { transform:scaleX(1) } }
        .wt-pop   { animation: wtPop   .45s ease-out both }
        .wt-rise  { animation: wtRise  .5s  ease-out both }
        .wt-fly   { animation: wtFly   1.5s ease-in-out .3s infinite }
        .wt-badge { animation: wtBadge 1.5s ease-out   .3s infinite }
        .wt-ring  { animation: wtDraw  .7s  ease-out .1s forwards }
        .wt-check { animation: wtDraw  .45s ease-out .55s forwards }
        .wt-drop  { animation: wtDrop  .5s  ease-out both }
        .wt-type  { transform-origin: left center; animation: wtType .7s ease-out both }
        @media (prefers-reduced-motion: reduce) {
          .wt-pop,.wt-rise,.wt-fly,.wt-badge,.wt-ring,.wt-check,.wt-drop,.wt-type {
            animation: none !important;
            stroke-dashoffset: 0 !important;
            opacity: 1 !important;
            transform: none !important;
          }
        }
      `}</style>

      <div className="flex items-baseline justify-between gap-4 mb-5 flex-wrap">
        <h2 id="wt-heading" className="font-serif text-[1.35rem] font-normal">
          New here? Take the short version.
        </h2>
        <button
          onClick={dismiss}
          className="font-mono text-[11px] tracking-[0.1em] uppercase text-warm-gray hover:text-ink bg-transparent border-0 cursor-pointer"
        >
          No thanks
        </button>
      </div>

      {!track ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {Object.entries(TRACKS).map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => { setTrack(key); setStep(0) }}
              className="text-left group"
              style={{
                padding: '22px 24px', cursor: 'pointer', background: 'transparent',
                border: '1px solid rgb(var(--color-warm-gray-light))', transition: 'border-color .18s, background .18s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = cfg.accent; e.currentTarget.style.background = 'rgb(var(--color-offwhite))' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgb(var(--color-warm-gray-light))'; e.currentTarget.style.background = 'transparent' }}
            >
              <span className="block font-serif text-[1.3rem] leading-tight mb-1">{cfg.label}</span>
              <span className="block font-mono text-[11px] text-warm-gray mb-3">{cfg.hint}</span>
              <span className="font-mono text-[11px] tracking-[0.1em] uppercase" style={{ color: cfg.accent }}>
                Show me →
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div
          ref={panelRef}
          tabIndex={-1}
          style={{ border: '1px solid rgb(var(--color-warm-gray-light))', padding: '20px', outline: 'none' }}
        >
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <span className="font-mono text-[10px] tracking-[0.14em] uppercase" style={{ color: t.accent }}>
              {t.label} · {step + 1} of {t.steps.length}
            </span>
            <button
              onClick={() => setTrack(null)}
              className="font-mono text-[11px] text-warm-gray hover:text-ink bg-transparent border-0 cursor-pointer"
            >
              ← Back
            </button>
          </div>

          {/* Progress */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 18 }}>
            {t.steps.map((_, i) => (
              <div key={i} style={{
                height: 2, flex: 1,
                background: i <= step ? t.accent : 'rgb(var(--color-warm-gray-light))',
                transition: 'background .25s',
              }} />
            ))}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
            {/* key forces the animation to replay on each step */}
            <StepArt key={`${track}-${step}`} kind={t.steps[step].art} accent={t.accent} />
            <div>
              <h3 className="font-serif text-[1.2rem] font-normal mb-2">{t.steps[step].title}</h3>
              <p className="font-mono text-[12px] text-warm-gray leading-relaxed">{t.steps[step].body}</p>
            </div>
          </div>

          <div className="flex items-center gap-3 mt-6 flex-wrap">
            {step > 0 && (
              <button onClick={() => setStep(s => s - 1)} className="btn-ghost">Back</button>
            )}
            {!isLast ? (
              <button onClick={() => setStep(s => s + 1)} className="btn-outline">Next</button>
            ) : (
              <button onClick={() => { dismiss(); navigate(t.cta.to) }} className="btn-outline">
                {t.cta.text} →
              </button>
            )}
            <button
              onClick={dismiss}
              className="font-mono text-[11px] tracking-[0.1em] uppercase text-warm-gray hover:text-ink bg-transparent border-0 cursor-pointer ml-auto"
            >
              Skip
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
