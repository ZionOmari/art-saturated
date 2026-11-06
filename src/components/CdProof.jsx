import { useEffect, useState } from 'react'
import { Art, Disc } from './CdMockup'
import { dpiQuality, printFileList, sizePx } from '../../functions/cdSpecs.mjs'
import { drawSpines } from '../lib/cdSpine'

// The checkout proof: each piece flat and cut as it will print, using the same
// spine drawing as the print files, so what's approved is what gets printed.
// `art` maps slot keys to { preview, dpi }.

const mono = { fontFamily: 'monospace' }

const PANEL_TITLE = { front: 'Front cover', back: 'Back', 'inside-left': 'Inside left', 'inside-right': 'Inside right' }

function QualityNote({ dpi }) {
  const q = dpi ? dpiQuality(dpi) : 'good'
  if (q === 'good') return null
  return (
    <p style={{ ...mono, fontSize: '10px', lineHeight: 1.4, margin: '4px 0 0', color: q === 'blurry' ? '#b03020' : '#a06a10' }}>
      {q === 'blurry' ? `Will look blurry (${dpi} dpi)` : `May look soft (${dpi} dpi)`}
    </p>
  )
}

function Piece({ title, dpi, note, children }) {
  return (
    <figure style={{ margin: 0 }}>
      {children}
      <figcaption style={{ ...mono, fontSize: '10px', color: '#6a5a48', marginTop: '6px' }}>{title}</figcaption>
      {note && <p style={{ ...mono, fontSize: '10px', color: '#6a5a48', lineHeight: 1.4, margin: '2px 0 0' }}>{note}</p>}
      <QualityNote dpi={dpi} />
    </figure>
  )
}

// Tray art with its spines painted on, exactly as the print file does it.
function TrayProof({ url, spine, artistName, albumTitle }) {
  const [src, setSrc] = useState(null)

  useEffect(() => {
    let live = true, made = null
    const img = new Image()
    img.onload = () => {
      if (!live) return
      const { w, h } = sizePx('tray')
      const canvas = document.createElement('canvas')
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      drawSpines(ctx, { artistName, albumTitle, ...spine })
      canvas.toBlob(blob => {
        if (!live) return
        made = URL.createObjectURL(blob)
        setSrc(made)
      }, 'image/jpeg', 0.9)
    }
    img.src = url
    return () => { live = false; if (made) URL.revokeObjectURL(made) }
  }, [url, spine, artistName, albumTitle])

  return (
    <div style={{ aspectRatio: '150 / 117.5', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }}>
      {src && <Art url={src} label="Tray card" spec="tray" />}
    </div>
  )
}

export default function CdProof({ packaging, panelCount, art, spine, artistName, albumTitle }) {
  const artwork = Object.fromEntries(Object.entries(art).filter(([, a]) => a).map(([k, a]) => [k, a.preview]))
  const files = printFileList({ packaging, panelCount, artwork })
  const panels = files.filter(f => f.kind === 'single')
  const tray   = files.find(f => f.kind === 'tray')
  const disc   = files.find(f => f.kind === 'disc')

  if (!files.length) {
    return <p style={{ ...mono, fontSize: '11px', color: '#6a5a48' }}>Your proof appears here once you've added your artwork.</p>
  }

  return (
    <div data-testid="cd-proof" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: '16px' }}>
      {panels.map(f => (
        <Piece key={f.art} title={PANEL_TITLE[f.name.match(/panel-\d-(.+)\.pdf/)[1]]} dpi={art[f.art]?.dpi}>
          <div style={{ aspectRatio: '1 / 1', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.25)' }}>
            <Art url={artwork[f.art]} label="" spec="panel" />
          </div>
        </Piece>
      ))}
      {tray && (
        <div style={{ gridColumn: 'span 2', minWidth: 0 }}>
          <Piece title="Tray card with spines" dpi={art.tray?.dpi}
            note={spine.spineStyle === 'extend' ? 'Your art runs through the spines.' : null}>
            <TrayProof url={artwork.tray} spine={spine} artistName={artistName} albumTitle={albumTitle} />
          </Piece>
        </div>
      )}
      {disc && (
        <Piece title="Disc" dpi={art[disc.art]?.dpi} note={disc.fromCover ? 'Using your front cover.' : null}>
          <Disc url={artwork[disc.art]} spec={disc.fromCover ? 'panel' : 'disc'} />
        </Piece>
      )}
    </div>
  )
}
