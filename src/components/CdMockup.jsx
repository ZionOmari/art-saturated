// Live mock-up of a CD order: case front, case back (with spines on a jewel
// case), disc face, and the inside spread of a 4-panel booklet.
//
// `art` maps slot keys to image URLs — blob previews on the order page, stored
// download URLs in admin and on reorders:
//   disc, panel0 (front), panel1..panel3, tray (jewel back)
// It is a layout guide, not a colour proof.

const LABEL = { fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a857d', textAlign: 'center', marginTop: '6px' }

function Art({ url, label, style }) {
  if (url) return <img src={url} alt={label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', ...style }} />
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'repeating-linear-gradient(45deg,#ece6d9,#ece6d9 6px,#e4ddcd 6px,#e4ddcd 12px)', ...style }}>
      <span style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#a08060', textAlign: 'center', padding: '4px' }}>{label}</span>
    </div>
  )
}

// Light sweep across the plastic case.
function Sheen() {
  return (
    <div style={{
      position: 'absolute', inset: 0, pointerEvents: 'none',
      background: 'linear-gradient(115deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0) 35%)',
    }} />
  )
}

function Tile({ label, children }) {
  return (
    <figure style={{ margin: 0 }}>
      {children}
      <figcaption style={LABEL}>{label}</figcaption>
    </figure>
  )
}

// Standard jewel/slim case: 142 × 125 mm, cover 120 × 120 mm.
function CaseFront({ url, slim }) {
  return (
    <div style={{ position: 'relative', aspectRatio: '142 / 125', background: '#2a2724', borderRadius: '3px', boxShadow: '0 6px 14px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
      {/* hinge */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: slim ? '4%' : '9%', background: 'linear-gradient(90deg,#141210,#3a3632 60%,#23201d)' }}>
        {!slim && [20, 40, 60, 80].map(t => (
          <div key={t} style={{ position: 'absolute', left: '20%', right: '20%', top: `${t}%`, height: '1px', background: 'rgba(255,255,255,0.12)' }} />
        ))}
      </div>
      <div style={{ position: 'absolute', right: '2.5%', top: '2%', height: '96%', aspectRatio: '1 / 1', overflow: 'hidden' }}>
        <Art url={url} label="Front cover" />
      </div>
      <Sheen />
    </div>
  )
}

function SpineText({ text, side }) {
  return (
    <div style={{
      position: 'absolute', top: 0, bottom: 0, [side]: 0, width: '4.2%',
      background: 'rgba(26,24,20,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
    }}>
      <span style={{
        writingMode: 'vertical-rl', transform: side === 'left' ? 'rotate(180deg)' : 'none',
        fontFamily: 'monospace', fontSize: '7px', letterSpacing: '0.12em', textTransform: 'uppercase',
        color: '#f5f2ec', whiteSpace: 'nowrap',
      }}>{text}</span>
    </div>
  )
}

// Jewel tray card: 150 × 118 mm including two 6.5 mm spines.
function JewelBack({ url, spine }) {
  return (
    <div style={{ position: 'relative', aspectRatio: '142 / 125', background: '#2a2724', borderRadius: '3px', boxShadow: '0 6px 14px rgba(0,0,0,0.25)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: '96%', aspectRatio: '5.91 / 4.63', overflow: 'hidden' }}>
        <Art url={url} label="Tray card" />
        <SpineText text={spine} side="left" />
        <SpineText text={spine} side="right" />
      </div>
      <Sheen />
    </div>
  )
}

function SlimBack({ url }) {
  return (
    <div style={{ position: 'relative', aspectRatio: '142 / 125', background: '#2a2724', borderRadius: '3px', boxShadow: '0 6px 14px rgba(0,0,0,0.25)', overflow: 'hidden' }}>
      {/* clear back: the disc tray shows through */}
      <div style={{ position: 'absolute', left: '2.5%', top: '2%', height: '96%', aspectRatio: '1 / 1', overflow: 'hidden' }}>
        <Art url={url} label="Back cover" />
      </div>
      <Sheen />
    </div>
  )
}

// Disc: 120 mm, 15 mm hole, clear hub out to ~36 mm.
export function Disc({ url }) {
  return (
    <div style={{ position: 'relative', aspectRatio: '1 / 1', borderRadius: '50%', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.25)', background: '#d8d4cc' }}>
      <Art url={url} label="Disc face" />
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: '30%', height: '30%', transform: 'translate(-50%,-50%)', borderRadius: '50%', background: 'radial-gradient(circle, rgba(230,228,222,0.95) 0%, rgba(200,198,192,0.9) 100%)', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.1)' }} />
      <div style={{ position: 'absolute', left: '50%', top: '50%', width: '12.5%', height: '12.5%', transform: 'translate(-50%,-50%)', borderRadius: '50%', background: '#faf8f4', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.2)' }} />
    </div>
  )
}

// Paper window sleeve with the disc inside.
function Sleeve({ url }) {
  return (
    <div style={{ position: 'relative', aspectRatio: '1 / 1', background: '#f4f1ea', boxShadow: '0 4px 12px rgba(0,0,0,0.18)', border: '1px solid #e0d9cb' }}>
      <div style={{ position: 'absolute', left: '8%', top: '8%', width: '84%', height: '84%' }}>
        <Disc url={url} />
      </div>
      {/* sleeve face with a round window */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 50%, transparent 0 33%, #f4f1ea 33.5%)', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: 0, left: '35%', right: '35%', height: '5%', background: '#ebe6db', borderRadius: '0 0 50% 50%' }} />
    </div>
  )
}

function Spread({ left, right }) {
  return (
    <div style={{ position: 'relative', aspectRatio: '2 / 1', display: 'flex', boxShadow: '0 4px 12px rgba(0,0,0,0.18)' }}>
      <div style={{ flex: 1, overflow: 'hidden', borderRight: '1px solid rgba(0,0,0,0.15)' }}><Art url={left} label="Inside left" /></div>
      <div style={{ flex: 1, overflow: 'hidden' }}><Art url={right} label="Inside right" /></div>
      <Sheen />
    </div>
  )
}

export default function CdMockup({ packaging, panelCount = 4, art = {}, artistName, albumTitle }) {
  const spine = `${artistName || 'Artist'} — ${albumTitle || 'Title'}`
  const discUrl = art.disc || (packaging !== 'sleeve' ? art.panel0 : null)
  const backUrl = panelCount === 4 ? art.panel3 : art.panel1

  const tiles = []
  if (packaging === 'sleeve') {
    tiles.push(<Tile key="sleeve" label="In the sleeve"><Sleeve url={art.disc} /></Tile>)
  } else {
    tiles.push(<Tile key="front" label="Front"><CaseFront url={art.panel0} slim={packaging === 'slim'} /></Tile>)
    tiles.push(packaging === 'jewel'
      ? <Tile key="back" label="Back + spines"><JewelBack url={art.tray} spine={spine} /></Tile>
      : <Tile key="back" label="Back"><SlimBack url={backUrl} /></Tile>)
    if (panelCount === 4) tiles.push(<Tile key="spread" label="Inside booklet"><Spread left={art.panel1} right={art.panel2} /></Tile>)
  }
  tiles.push(<Tile key="disc" label={art.disc || packaging === 'sleeve' ? 'Disc' : 'Disc (front cover art)'}><div style={{ width: '82%', margin: '0 auto' }}><Disc url={discUrl} /></div></Tile>)

  return (
    <div>
      <div className="grid grid-cols-2 gap-5" style={{ alignItems: 'end' }}>{tiles}</div>
      <p style={{ ...LABEL, marginTop: '14px', textTransform: 'none', letterSpacing: 0, fontSize: '10px' }}>
        Mock-up for layout only. Printed colors can differ slightly from your screen.
      </p>
    </div>
  )
}
