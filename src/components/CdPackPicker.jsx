// Step 1 of a CD order: pick one of three packages, each shown as a small
// looping animation. Pure CSS, so nothing extra downloads, and it holds still
// for anyone who has asked their device for reduced motion.

const OPTIONS = [
  { key: 'jewel',  label: 'Jewel case', sub: 'Front cover + tray card with your title on the spines' },
  { key: 'slim',   label: 'Slim case',  sub: 'Thin case with a printed front and back cover' },
  { key: 'sleeve', label: 'Disc only',  sub: 'Printed disc in a paper sleeve' },
]

const CSS = `
.cdpk-stage { position: relative; height: 112px; perspective: 520px; display: flex; align-items: center; justify-content: center; background: #ece6d9; overflow: hidden; }
.cdpk-disc { position: absolute; border-radius: 50%; background:
  radial-gradient(circle, #f4f1ea 0 9%, #c9c4ba 9.5% 26%, transparent 26.5%),
  conic-gradient(from 0deg, #c0392b, #e0a030, #2a6f97, #5e548e, #c0392b);
  box-shadow: inset 0 0 0 1px rgba(0,0,0,0.15); }
.cdpk-disc::after { content: ''; position: absolute; inset: 0; border-radius: 50%;
  background: conic-gradient(from 90deg, rgba(255,255,255,0.35), transparent 25%, rgba(255,255,255,0.2) 50%, transparent 75%); }
.cdpk-spin { animation: cdpk-spin 3s linear infinite; }

/* Jewel: the lid swings open on its hinge, the disc turns in the tray. */
.cdpk-jewel { position: relative; width: 92px; height: 81px; transform-style: preserve-3d; }
.cdpk-jewel .tray { position: absolute; inset: 0; background: #2a2724; border-radius: 2px; box-shadow: 0 4px 10px rgba(0,0,0,0.25); }
.cdpk-jewel .cdpk-disc { width: 70px; height: 70px; left: 11px; top: 5.5px; }
.cdpk-jewel .lid { position: absolute; inset: 0; transform-origin: left center; animation: cdpk-lid 4.5s ease-in-out infinite;
  background: linear-gradient(115deg, rgba(255,255,255,0.28), rgba(255,255,255,0.06) 40%), linear-gradient(135deg, #c0392b, #e0a030);
  border-left: 7px solid #141210; border-radius: 2px; box-shadow: 0 2px 6px rgba(0,0,0,0.2); }

/* Slim: a thin case slides in and the disc shows through its clear front. */
.cdpk-slim { position: relative; width: 92px; height: 81px; animation: cdpk-slide 4.5s ease-in-out infinite; }
.cdpk-slim .back { position: absolute; inset: 0; background: linear-gradient(135deg, #2a6f97, #61a5c2); border-radius: 2px; box-shadow: 0 4px 10px rgba(0,0,0,0.25); }
.cdpk-slim .cdpk-disc { width: 66px; height: 66px; left: 13px; top: 7.5px; }
.cdpk-slim .glass { position: absolute; inset: 0; border-radius: 2px; border-left: 3px solid #141210;
  background: linear-gradient(115deg, rgba(255,255,255,0.4), rgba(255,255,255,0.05) 45%); }

/* Disc only: the disc rises out of its paper sleeve, spins, and drops back. */
.cdpk-stage.low { align-items: flex-end; padding-bottom: 6px; }
.cdpk-sleeve { position: relative; width: 74px; height: 74px; }
.cdpk-sleeve .cdpk-disc { width: 66px; height: 66px; left: 4px; top: 4px; animation: cdpk-rise 4.5s ease-in-out infinite; }
.cdpk-sleeve .paper { position: absolute; inset: 0; background: linear-gradient(180deg, #efe8da 0 14%, #f7f3ea 14%);
  border: 1px solid #ddd4c4; box-shadow: 0 3px 8px rgba(0,0,0,0.15); }

@keyframes cdpk-spin  { to { transform: rotate(360deg) } }
@keyframes cdpk-lid   { 0%, 15% { transform: rotateY(0) } 45%, 70% { transform: rotateY(-115deg) } 100% { transform: rotateY(0) } }
@keyframes cdpk-slide { 0% { transform: translateX(70px); opacity: 0 } 20%, 80% { transform: translateX(0); opacity: 1 } 100% { transform: translateX(-70px); opacity: 0 } }
@keyframes cdpk-rise  { 0%, 15% { transform: translateY(0) } 45%, 70% { transform: translateY(-33px) } 100% { transform: translateY(0) } }

@media (prefers-reduced-motion: reduce) {
  .cdpk-spin, .cdpk-jewel .lid, .cdpk-slim, .cdpk-sleeve .cdpk-disc { animation: none; }
  .cdpk-jewel .lid { transform: rotateY(-115deg); }
  .cdpk-sleeve .cdpk-disc { transform: translateY(-33px); }
}
`

function Jewel() {
  return (
    <div className="cdpk-jewel">
      <div className="tray" />
      <div className="cdpk-disc cdpk-spin" />
      <div className="lid" />
    </div>
  )
}

function Slim() {
  return (
    <div className="cdpk-slim">
      <div className="back" />
      <div className="cdpk-disc cdpk-spin" />
      <div className="glass" />
    </div>
  )
}

function Sleeve() {
  return (
    <div className="cdpk-sleeve">
      <div className="cdpk-disc cdpk-spin" />
      <div className="paper" />
    </div>
  )
}

const ART = { jewel: Jewel, slim: Slim, sleeve: Sleeve }

export default function CdPackPicker({ value, onChange }) {
  return (
    <>
      <style>{CSS}</style>
      <div role="radiogroup" aria-label="Packaging" className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        {OPTIONS.map(o => {
          const on = value === o.key
          const Art = ART[o.key]
          return (
            <button key={o.key} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.key)}
              data-testid={`pack-${o.key}`}
              className="text-left border transition-colors overflow-hidden"
              style={{ borderColor: on ? '#1a1814' : '#c5bfb5', borderWidth: on ? 2 : 1, background: on ? '#1a1814' : 'transparent', color: on ? '#f5f2ec' : '#1a1814' }}>
              <div className={`cdpk-stage${o.key === 'sleeve' ? ' low' : ''}`} aria-hidden="true"><Art /></div>
              <span className="block px-4 pt-3 font-mono text-[11px] uppercase tracking-[0.08em]">{o.label}</span>
              <span className="block px-4 pb-3 pt-1 font-mono text-[10px]" style={{ color: on ? '#d4c4a8' : '#8a857d' }}>{o.sub}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}
