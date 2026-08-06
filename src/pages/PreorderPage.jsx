import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { checkoutPreorder } from '../lib/stripe'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'

const DEFAULT_TIERS = [4.99, 7.99, 12.99, 18.99]

// Built-in fallbacks for known releases, used when the Firestore
// `albumPreorders/<slug>` doc hasn't been seeded yet (the doc is only
// created as a side effect of an admin opening the Album Preorders panel).
// Keeps the public checkout page working — the Cloud Function looks up the
// authoritative price itself and falls back to the same default.
const FALLBACK_ALBUMS = {
  enigma: {
    artistName: 'Zionomari', albumTitle: 'Enigma', price: 10,
    releaseDate: 'May 2026', description: '', coverArt: '',
    digitalAvailable: true, physicalAvailable: true, pickupAvailable: true,
    active: true,
  },
}

export default function PreorderPage() {
  const { slug }   = useParams()
  const navigate   = useNavigate()
  const { user }   = useAuth()

  const [album,       setAlbum]       = useState(null)
  const [storeConfig, setStoreConfig] = useState(null)
  const [notFound,    setNotFound]    = useState(false)
  const [loading,     setLoading]     = useState(true)
  const [method,      setMethod]      = useState('digital')
  const [busy,        setBusy]        = useState(false)
  const [error,       setError]       = useState(null)

  // Load album config + store config in parallel
  useEffect(() => {
    async function load() {
      const [albumSnap, configSnap] = await Promise.all([
        getDoc(doc(db, 'albumPreorders', slug)),
        getDoc(doc(db, 'settings', 'storeConfig')),
      ])
      const data = albumSnap.exists() ? albumSnap.data() : FALLBACK_ALBUMS[slug]
      if (!data || data.active === false) {
        setNotFound(true)
      } else {
        setAlbum(data)
        document.title = `Preorder ${data.albumTitle} — Art Saturated`
      }
      if (configSnap.exists()) setStoreConfig(configSnap.data())
      setLoading(false)
    }
    load().catch(() => { setNotFound(true); setLoading(false) })
    return () => { document.title = 'Art Saturated' }
  }, [slug])

  const tiers        = storeConfig?.shippingTiers ?? DEFAULT_TIERS
  const albumPrice   = album?.price ?? 10
  // Per-album flat shipping override (e.g. Enigma = $5). Falls back to tier 0.
  const shipFlat     = album?.shippingFlat ?? tiers[0]
  const shippingCost = method === 'ship' ? shipFlat : 0
  const total        = albumPrice + shippingCost

  const digitalAvailable  = album?.digitalAvailable  !== false
  const physicalAvailable = album?.physicalAvailable !== false
  const pickupAvailable   = album?.pickupAvailable  !== false

  // Reset method if selected option isn't available
  useEffect(() => {
    if (!digitalAvailable)  setMethod(physicalAvailable ? 'ship' : 'pickup')
  }, [album]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handlePreorder() {
    if (!user) { navigate('/login'); return }
    setError(null)
    setBusy(true)
    try {
      await checkoutPreorder({
        customerEmail:  user.email,
        shippingCost,
        shippingMethod: method,
        albumSlug:      slug,
        albumName:      album?.albumTitle ?? slug,
        artistName:     album?.artistName ?? '',
      })
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <main className="pt-[60px] min-h-screen flex items-center justify-center">
        <Spinner size={20} color="#3d2810" />
      </main>
    )
  }

  if (notFound) {
    return (
      <main className="pt-[60px] min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <p className="font-serif text-[2rem] mb-4">Preorder not found.</p>
        <button className="btn-outline" onClick={() => navigate('/')}>Back to Home</button>
        <Footer />
      </main>
    )
  }

  const deliveryOptions = [
    digitalAvailable  && { id: 'digital', label: 'Digital Download',  note: 'Download link sent on release day',                 cost: 0 },
    physicalAvailable && { id: 'ship',    label: 'Ship Physical Copy', note: 'Shipped when the album drops',                      cost: shipFlat },
    pickupAvailable   && { id: 'pickup',  label: 'Local Pickup',       note: "Fort Wayne, IN — we'll reach out with details",     cost: 0 },
  ].filter(Boolean)

  return (
    <main className="pt-[60px] min-h-screen flex flex-col">

      {/* Hero */}
      <section style={{
        background: '#0d0c0b',
        padding: 'clamp(60px, 10vw, 120px) 24px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'radial-gradient(ellipse at 50% 60%, rgba(160,128,96,0.07) 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        {album.coverArt && (
          <div style={{ marginBottom: '28px', position: 'relative' }}>
            <img
              src={album.coverArt}
              alt={`${album.albumTitle} cover art`}
              style={{ width: '180px', height: '180px', objectFit: 'cover', display: 'inline-block', border: '1px solid rgba(255,255,255,0.08)' }}
            />
          </div>
        )}

        <p style={{
          fontFamily: 'monospace', fontSize: '10px',
          letterSpacing: '0.3em', color: '#6b6560',
          textTransform: 'uppercase', marginBottom: '20px',
          position: 'relative',
        }}>
          {album.artistName}
        </p>

        <h1 style={{
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontSize: 'clamp(3rem, 10vw, 6rem)',
          fontWeight: 'normal',
          color: '#fff',
          letterSpacing: '0.12em',
          margin: '0 0 16px',
          lineHeight: 1,
          position: 'relative',
          textTransform: 'uppercase',
        }}>
          {album.albumTitle}
        </h1>

        {album.releaseDate && (
          <p style={{
            fontFamily: 'monospace', fontSize: '10px',
            letterSpacing: '0.22em', color: '#5a5550',
            textTransform: 'uppercase', marginBottom: 0,
            position: 'relative',
          }}>
            {album.releaseDate}
          </p>
        )}

        {album.description && (
          <p style={{
            fontFamily: 'monospace', fontSize: '12px',
            color: '#6b6560', marginTop: '20px',
            lineHeight: 1.7, maxWidth: '420px',
            marginLeft: 'auto', marginRight: 'auto',
            position: 'relative',
          }}>
            {album.description}
          </p>
        )}
      </section>

      {/* Preorder form */}
      <section style={{ flex: 1, maxWidth: '480px', margin: '0 auto', padding: '56px 24px 40px', width: '100%' }}>

        <h2 className="font-serif" style={{ fontSize: '1.5rem', fontWeight: 'normal', marginBottom: '6px', color: '#1a1814' }}>
          Preorder
        </h2>
        <p className="font-mono" style={{ fontSize: '12px', letterSpacing: '0.06em', color: '#8a857d', marginBottom: '36px' }}>
          Lock in your copy. Pay now, receive when it drops.
        </p>

        {/* Delivery options */}
        <fieldset style={{ border: 'none', padding: 0, margin: '0 0 32px' }}>
          <legend className="font-mono" style={{ fontSize: '10px', letterSpacing: '0.18em', textTransform: 'uppercase', color: '#8a857d', marginBottom: '14px' }}>
            Delivery
          </legend>

          {deliveryOptions.map(opt => (
            <label
              key={opt.id}
              onClick={() => setMethod(opt.id)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '12px',
                padding: '14px 16px', marginBottom: '8px',
                border: `1px solid ${method === opt.id ? '#1a1814' : '#d8d3cb'}`,
                background: method === opt.id ? '#f2ebe0' : 'transparent',
                cursor: 'pointer', transition: 'border-color 0.15s, background 0.15s',
              }}
            >
              <span style={{
                width: '16px', height: '16px', borderRadius: '50%', flexShrink: 0, marginTop: '2px',
                border: `2px solid ${method === opt.id ? '#1a1814' : '#c5bfb5'}`,
                background: method === opt.id ? '#1a1814' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {method === opt.id && (
                  <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#fff' }} />
                )}
              </span>
              <span style={{ flex: 1 }}>
                <span className="font-mono" style={{ fontSize: '11px', letterSpacing: '0.08em', color: '#1a1814', display: 'block' }}>
                  {opt.label}
                </span>
                <span className="font-mono" style={{ fontSize: '10px', color: '#8a857d', display: 'block', marginTop: '2px' }}>
                  {opt.note}
                </span>
              </span>
              <span className="font-mono" style={{ fontSize: '11px', color: '#a08060', flexShrink: 0 }}>
                {opt.cost > 0 ? `+$${opt.cost.toFixed(2)}` : 'Free'}
              </span>
            </label>
          ))}

          {method === 'ship' && (
            <p className="font-mono" style={{ fontSize: '10px', letterSpacing: '0.06em', color: '#8a857d', marginTop: '10px', padding: '0 4px' }}>
              Your shipping address will be collected securely on the next screen.
            </p>
          )}
        </fieldset>

        {/* Order summary */}
        <div style={{ borderTop: '1px solid #d8d3cb', paddingTop: '20px', marginBottom: '28px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
            <span className="font-mono" style={{ fontSize: '11px', color: '#8a857d' }}>{album.albumTitle} — {album.artistName}</span>
            <span className="font-mono" style={{ fontSize: '11px', color: '#1a1814' }}>${albumPrice.toFixed(2)}</span>
          </div>
          {shippingCost > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span className="font-mono" style={{ fontSize: '11px', color: '#8a857d' }}>Shipping</span>
              <span className="font-mono" style={{ fontSize: '11px', color: '#1a1814' }}>${shippingCost.toFixed(2)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #d8d3cb', paddingTop: '12px', marginTop: '4px' }}>
            <span className="font-mono" style={{ fontSize: '12px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1a1814' }}>Total</span>
            <span className="font-mono" style={{ fontSize: '14px', color: '#1a1814', fontWeight: '600' }}>${total.toFixed(2)}</span>
          </div>
        </div>

        {error && (
          <p className="font-mono" style={{ fontSize: '11px', color: '#c0392b', marginBottom: '16px', lineHeight: 1.6 }}>
            {error}
          </p>
        )}

        {user ? (
          <button
            onClick={handlePreorder}
            disabled={busy}
            className="btn-outline"
            style={{ width: '100%', padding: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}
          >
            {busy ? <><Spinner size={14} color="#1a1814" /> Processing…</> : `Preorder Now — $${total.toFixed(2)}`}
          </button>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <p className="font-mono" style={{ fontSize: '11px', color: '#8a857d', marginBottom: '14px' }}>
              You need an account to preorder.
            </p>
            <button onClick={() => navigate('/login')} className="btn-outline" style={{ width: '100%', padding: '14px' }}>
              Sign In to Preorder
            </button>
          </div>
        )}

        <p className="font-mono" style={{ fontSize: '10px', color: '#b5b0a8', textAlign: 'center', marginTop: '20px', lineHeight: 1.7 }}>
          Secured by Stripe. Cancel anytime before release for a full refund.
        </p>
      </section>

      <Footer />
    </main>
  )
}
