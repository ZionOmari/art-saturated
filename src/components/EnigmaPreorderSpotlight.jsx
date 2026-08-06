import { useNavigate } from 'react-router-dom'
import EnigmaField from './EnigmaField'

/**
 * EnigmaPreorderSpotlight — pinned preorder card for the top of a shop section
 * (above Local Legends). The "cover" is the live Enigma visual instead of a
 * static image. Reuses the existing /preorder/:slug checkout flow.
 *
 * Reusable template: pass props for any future album release.
 */
export default function EnigmaPreorderSpotlight({
  slug        = 'enigma',
  title       = 'Enigma',
  artist      = 'Zionomari',
  price       = 10,
  pickupCopy  = 'Pickup on or after June 30',
  shipCopy    = 'Ships starting July 1',
}) {
  const navigate = useNavigate()

  return (
    <div className="max-w-4xl mx-auto px-6 pt-10 pb-2">
      <p className="font-mono text-[9px] tracking-[0.25em] uppercase mb-3" style={{ color: '#2a1a08' }}>
        ◆ Preorder · New Release
      </p>
      <div
        onClick={() => navigate(`/preorder/${slug}`)}
        style={{
          display: 'flex', gap: '0',
          background: '#0d0c0b', border: '1px solid rgba(0,0,0,0.25)',
          cursor: 'pointer', overflow: 'hidden',
          flexWrap: 'wrap',
        }}
      >
        {/* Animated Enigma "cover" */}
        <div style={{ width: '180px', height: '180px', flexShrink: 0, flexGrow: 1, minWidth: '160px', maxWidth: '220px' }}>
          <EnigmaField density={1.0} />
        </div>

        {/* Listing detail */}
        <div style={{
          flex: '1 1 260px', padding: '24px 28px',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
        }}>
          <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.3em', textTransform: 'uppercase', color: '#6b6560', marginBottom: '10px' }}>
            {artist}
          </p>
          <h3 style={{ fontFamily: 'Georgia, serif', fontSize: 'clamp(1.8rem, 4vw, 2.6rem)', color: '#fff', letterSpacing: '0.08em', margin: '0 0 10px', lineHeight: 1 }}>
            {title.toUpperCase()}
          </h3>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a857d', lineHeight: 1.7, margin: '0 0 18px' }}>
            {pickupCopy} · {shipCopy}<br />
            Local pickup free · Flat $5 shipping · Card only
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
            <button
              onClick={(e) => { e.stopPropagation(); navigate(`/preorder/${slug}`) }}
              style={{
                fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.16em',
                textTransform: 'uppercase', padding: '12px 26px',
                background: '#fff', color: '#000', border: 'none', cursor: 'pointer',
              }}
            >
              Preorder — ${Number(price).toFixed(0)}
            </button>
            <span style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', color: '#5a5550', textTransform: 'uppercase' }}>
              Secured by Stripe
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
