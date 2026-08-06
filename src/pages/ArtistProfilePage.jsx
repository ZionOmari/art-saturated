import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { addDoc, collection, getDocs, getDoc, doc, query, where, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { getArtistProfile, getArtistWork } from '../data/artists'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { useToast } from '../hooks/useToast'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'
import MessageThread from '../components/MessageThread'

const BLANK_REQ = { name: '', email: '', description: '', budget: '', timeline: '' }

export default function ArtistProfilePage() {
  const { uid }        = useParams()
  const navigate       = useNavigate()
  const { user }       = useAuth()
  const { addToCart }  = useCart()
  const { toast, showToast } = useToast()
  const [artist, setArtist] = useState(null)
  const [work,   setWork]   = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)   // lightbox

  // Commission request form
  const [commForm,     setCommForm]     = useState(BLANK_REQ)
  const [commBusy,     setCommBusy]     = useState(false)
  const [commSent,     setCommSent]     = useState(false)
  const [commError,    setCommError]    = useState('')
  const [showCommForm, setShowCommForm] = useState(false)
  const [newRequestId, setNewRequestId] = useState(null)  // doc id after submit

  useEffect(() => {
    async function load() {
      try {
        // Run all three independently so a permissions error on submissions
        // never prevents products from loading
        const [prof, submissionWork, productSnap] = await Promise.all([
          getArtistProfile(uid),
          getArtistWork(uid),   // already returns [] on permissions error
          getDocs(query(
            collection(db, 'products'),
            where('artistUid', '==', uid),
          )),
        ])

        // Normalize products to the same shape as submissions
        console.log(`[ArtistProfile] uid=${uid} | productSnap.size=${productSnap.size} | submissionWork.length=${submissionWork.length}`)

        // Enrich submissions with product data (slug, sold status, cart item)
        const enrichedSubs = await Promise.all(
          submissionWork.map(async s => {
            if (!s.productId) return s
            try {
              const snap = await getDoc(doc(db, 'products', s.productId))
              if (!snap.exists()) return s
              const p = { id: snap.id, ...snap.data() }
              return { ...s, slug: p.slug || null, sold: p.sold || false, productData: p }
            } catch { return s }
          })
        )

        // A submission and its approved product are the same piece. Viewers who can
        // read submissions (the artist themselves, admin) get the piece from the
        // submissions query, so we dedupe its product out to avoid showing it twice.
        // But the PUBLIC can't read submissions — for them this set is empty and the
        // submission-sourced product is the ONLY thing that makes the work visible.
        // So never exclude products by `source` here, only by productId overlap.
        const subProductIds = new Set(submissionWork.map(s => s.productId).filter(Boolean))

        const productWork = productSnap.docs
          .map(d => {
            const p = { id: d.id, ...d.data() }
            const imgArr = Array.isArray(p.imageURLs) ? p.imageURLs
                         : Array.isArray(p.images)    ? p.images
                         : null
            return {
              id:          p.id,
              _source:     'product',
              slug:        p.slug || null,
              title:       p.name || '',
              imageURL:    imgArr ? imgArr[0] : (p.imageURL || p.image || null),
              price:       p.price,
              medium:      p.medium || '',
              description: p.description || '',
              submittedAt: p.createdAt || null,
              active:      p.active !== false,
              source:      p.source || '',
              sold:        p.sold   || false,
              productData: p,
            }
          })
          .filter(p => p.active && !subProductIds.has(p.id))

        // Merge, deduplicate by id, sort newest first
        const seen = new Set()
        const merged = [...enrichedSubs, ...productWork]
          .filter(w => { if (seen.has(w.id)) return false; seen.add(w.id); return true })
          .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0))

        setArtist(prof)
        setWork(merged)
      } catch (err) {
        console.error('ArtistProfilePage load error:', err)
        setArtist(null)
        setWork([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [uid])

  // Close lightbox on Escape
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') setSelected(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const initials = (artist?.name || 'A').charAt(0).toUpperCase()

  async function handleCommissionSubmit(e) {
    e.preventDefault()
    if (!commForm.name || !commForm.email || !commForm.description) return
    setCommBusy(true); setCommError('')
    try {
      const docRef = await addDoc(collection(db, 'commissionRequests'), {
        artistId:       uid,
        artistEmail:    artist.email || '',
        artistName:     artist.name  || '',
        collectorName:  commForm.name,
        collectorEmail: commForm.email,
        collectorUid:   user?.uid || null,
        description:    commForm.description,
        budget:         commForm.budget   || null,
        timeline:       commForm.timeline || null,
        status:         'new',
        createdAt:      serverTimestamp(),
      })
      setNewRequestId(docRef.id)
      setCommSent(true)
      setCommForm(BLANK_REQ)
    } catch (err) {
      setCommError('Something went wrong — please try again.')
    } finally {
      setCommBusy(false)
    }
  }

  if (loading) {
    return (
      <main className="pt-[60px]">
        <div className="max-w-5xl mx-auto px-6 pt-20">
          <Spinner size={20} color="#3d2810" />
        </div>
      </main>
    )
  }

  if (!artist) {
    return (
      <main className="pt-[60px]">
        <div className="max-w-5xl mx-auto px-6 pt-20 text-center">
          <p className="font-serif text-[2rem] text-ink mb-4">Artist not found.</p>
          <button onClick={() => navigate('/artists')} className="btn-outline">← Back to Artists</button>
        </div>
      </main>
    )
  }

  const instaHandle = artist.instagram?.replace('@', '')

  return (
    <main className="pt-[60px]">
      {/* Banner */}
      {artist.bannerURL && (
        <div style={{ width: '100%', maxHeight: '360px', overflow: 'hidden', background: '#e8e0d4' }}>
          <img
            src={artist.bannerURL}
            alt=""
            style={{ width: '100%', maxHeight: '360px', objectFit: 'cover', display: 'block' }}
          />
        </div>
      )}

      {/* Back nav */}
      <div className="max-w-5xl mx-auto px-6 pt-10">
        <button
          onClick={() => navigate('/artists')}
          style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7a5030', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
        >
          ← All Artists
        </button>
      </div>

      {/* Profile header */}
      <section className="max-w-5xl mx-auto px-6 pt-10 pb-12 border-b border-warm-gray-light">
        <div style={{ display: 'flex', gap: '28px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* Avatar */}
          <div style={{
            width: '100px', height: '100px', borderRadius: '50%', overflow: 'hidden',
            flexShrink: 0, background: '#ddd5c8', display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '2px solid #e8e0d4',
          }}>
            {artist.photoURL
              ? <img src={artist.photoURL} alt={artist.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              : <span style={{ fontFamily: 'serif', fontSize: '2.2rem', color: '#7a5030', fontWeight: 600 }}>{initials}</span>
            }
          </div>

          {/* Text */}
          <div style={{ flex: 1, minWidth: '220px' }}>
            <p className="eyebrow mb-2">Artist</p>
            <h1 className="font-serif text-[clamp(1.8rem,5vw,3rem)] font-normal leading-tight text-ink">
              {artist.name || 'Artist'}
            </h1>

            {artist.artistBio && (
              <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#7a5030', marginTop: '12px', lineHeight: 1.7, maxWidth: '560px' }}>
                {artist.artistBio}
              </p>
            )}

            {/* Social links */}
            <div style={{ display: 'flex', gap: '20px', marginTop: '16px', flexWrap: 'wrap' }}>
              {instaHandle && (
                <a
                  href={`https://instagram.com/${instaHandle}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7a5030', textDecoration: 'none', borderBottom: '1px solid #a08060', paddingBottom: '1px', transition: 'color 0.15s, border-color 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#1a1814'; e.currentTarget.style.borderColor = '#1a1814' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#7a5030'; e.currentTarget.style.borderColor = '#a08060' }}
                >
                  Instagram ↗
                </a>
              )}
              {artist.website && (
                <a
                  href={artist.website}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7a5030', textDecoration: 'none', borderBottom: '1px solid #a08060', paddingBottom: '1px', transition: 'color 0.15s, border-color 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.color = '#1a1814'; e.currentTarget.style.borderColor = '#1a1814' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#7a5030'; e.currentTarget.style.borderColor = '#a08060' }}
                >
                  Website ↗
                </a>
              )}
            </div>

            {/* Piece count */}
            <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#7a5030', marginTop: '12px', letterSpacing: '0.06em' }}>
              {work.filter(w => !w.sold).length} available · {work.filter(w => w.sold).length} sold
            </p>
          </div>
        </div>
      </section>

      {/* Work collage */}
      <section className="max-w-5xl mx-auto px-6 py-14 pb-24">
        {work.length === 0 ? (
          <p className="font-mono text-[13px] text-warm-gray">No published work yet.</p>
        ) : (
          <div style={{ columns: '2', columnGap: '10px' }} className="sm:columns-3 lg:columns-4">
            {work.map(piece => (
              <div
                key={piece.id}
                onClick={() => setSelected(piece)}
                style={{ breakInside: 'avoid', marginBottom: '10px', cursor: 'pointer', position: 'relative' }}
              >
                <div style={{ overflow: 'hidden', background: '#e8e0d4', position: 'relative' }}
                  onMouseEnter={e => e.currentTarget.querySelector('.overlay')?.style && (e.currentTarget.querySelector('.overlay').style.opacity = '1')}
                  onMouseLeave={e => e.currentTarget.querySelector('.overlay')?.style && (e.currentTarget.querySelector('.overlay').style.opacity = '0')}
                >
                  {piece.imageURL
                    ? <img src={piece.imageURL} alt={piece.title || ''} style={{ width: '100%', display: 'block', transition: 'transform 0.25s' }}
                        onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.03)'}
                        onMouseLeave={e => e.currentTarget.style.transform = ''}
                      />
                    : <div style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem' }}>🖼️</div>
                  }
                  {/* Sold badge */}
                  {piece.sold && (
                    <div style={{
                      position: 'absolute', top: '7px', left: '7px',
                      background: 'rgba(26,24,20,0.78)', color: '#f5f2ec',
                      fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.12em',
                      textTransform: 'uppercase', padding: '3px 7px',
                    }}>
                      Sold
                    </div>
                  )}
                  {/* Hover overlay */}
                  <div className="overlay" style={{
                    position: 'absolute', inset: 0, background: 'rgba(26,24,20,0.55)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    opacity: 0, transition: 'opacity 0.2s',
                  }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#f5f2ec', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                      {piece.sold ? 'View' : 'View · Add to Cart'}
                    </span>
                  </div>
                </div>

                {/* Label */}
                <div style={{ paddingTop: '6px', paddingBottom: '4px' }}>
                  <p style={{ fontFamily: 'serif', fontSize: '0.9rem', color: '#1a1814', margin: 0, lineHeight: 1.3 }}>
                    {piece.title}
                  </p>
                  <p style={{ fontFamily: 'monospace', fontSize: '10px', color: piece.sold ? '#9a8e80' : '#7a5030', margin: '2px 0 0' }}>
                    {piece.sold ? 'Sold' : `$${piece.price}`}
                    {!piece.sold && piece.medium && <span style={{ color: '#7a5030', marginLeft: '6px' }}>· {piece.medium}</span>}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Commission Inquiry ───────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-6 pb-20 border-t border-warm-gray-light pt-14">
        <p className="eyebrow mb-4">Custom Work</p>
        {commSent ? (
          <div style={{ maxWidth: '520px' }}>
            <div style={{ padding: '24px', border: '1px solid #a08060', background: 'rgba(58,122,64,0.04)', marginBottom: newRequestId && user ? '0' : '0', borderBottom: newRequestId && user ? 'none' : undefined }}>
              <p className="font-serif text-[1.1rem] font-normal mb-2">Inquiry sent!</p>
              <p className="font-mono text-[12px] text-warm-gray leading-relaxed">
                {artist.name?.split(' ')[0] || 'The artist'} will reach out to you directly.
                Payment and terms are arranged privately —
                Art Saturated takes no fee on custom commissions.
              </p>
              <button onClick={() => { setCommSent(false); setShowCommForm(false); setNewRequestId(null) }}
                style={{ marginTop: '16px', fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '6px 14px', background: 'transparent', border: '1px solid #a08060', cursor: 'pointer', color: '#8a5c3a' }}>
                Send another
              </button>
            </div>
            {/* Thread — only shown when logged in */}
            {newRequestId && user && (
              <div>
                <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a5c3a', padding: '10px 14px 0', background: '#faf8f4', border: '1px solid #a08060', borderTop: 'none', borderBottom: 'none' }}>
                  Message thread
                </p>
                <MessageThread
                  requestId={newRequestId}
                  currentUid={user.uid}
                  currentName={profile?.name || user.displayName || commForm.name || 'Collector'}
                  role="collector"
                />
              </div>
            )}
          </div>
        ) : !showCommForm ? (
          <div>
            <h2 className="font-serif text-[1.4rem] font-normal mb-3">
              Interested in a custom piece?
            </h2>
            <p className="font-mono text-[12px] text-warm-gray leading-relaxed max-w-md mb-6">
              Send {artist.name?.split(' ')[0] || 'this artist'} an inquiry. They'll follow up with you directly — payment and terms are handled privately.
              Art Saturated takes no commission on custom work.
            </p>
            <button
              onClick={() => setShowCommForm(true)}
              style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', padding: '12px 24px', border: '1px solid #1a1814', background: 'transparent', cursor: 'pointer', color: '#1a1814', transition: 'all 0.15s' }}
              onMouseEnter={e => { e.currentTarget.style.background = '#1a1814'; e.currentTarget.style.color = '#f5f2ec' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#1a1814' }}
            >
              Request a Commission
            </button>
          </div>
        ) : (
          <form onSubmit={handleCommissionSubmit} style={{ maxWidth: '520px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <h2 className="font-serif text-[1.3rem] font-normal mb-1">Commission Inquiry</h2>
            <p className="font-mono text-[11px] text-warm-gray">
              Your contact info and project details will be sent directly to {artist.name?.split(' ')[0] || 'the artist'}.
            </p>
            {[
              { key: 'name',     label: 'Your Name',         placeholder: 'Full name', required: true },
              { key: 'email',    label: 'Your Email',        placeholder: 'email@example.com', required: true, type: 'email' },
              { key: 'budget',   label: 'Budget (optional)', placeholder: 'e.g. $200–$400' },
              { key: 'timeline', label: 'Timeline (optional)', placeholder: 'e.g. 4 weeks, by end of July' },
            ].map(f => (
              <div key={f.key}>
                <p style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8a5c3a', marginBottom: '4px' }}>{f.label}</p>
                <input
                  type={f.type || 'text'}
                  required={f.required}
                  placeholder={f.placeholder}
                  value={commForm[f.key]}
                  onChange={e => setCommForm(p => ({ ...p, [f.key]: e.target.value }))}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px', padding: '10px 12px', border: '1px solid #d4c9bb', background: '#faf8f4', color: '#1a1208', outline: 'none', boxSizing: 'border-box' }}
                />
              </div>
            ))}
            <div>
              <p style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8a5c3a', marginBottom: '4px' }}>Project Description *</p>
              <textarea
                required
                rows={5}
                placeholder="Describe what you have in mind — subject, style, size, any reference images you have…"
                value={commForm.description}
                onChange={e => setCommForm(p => ({ ...p, description: e.target.value }))}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px', padding: '10px 12px', border: '1px solid #d4c9bb', background: '#faf8f4', color: '#1a1208', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }}
              />
            </div>
            {commError && <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#b94040' }}>{commError}</p>}
            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" disabled={commBusy}
                style={{ fontFamily: 'monospace', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '11px 24px', background: '#1a1814', color: '#f5f2ec', border: 'none', cursor: 'pointer', opacity: commBusy ? 0.5 : 1 }}>
                {commBusy ? 'Sending…' : 'Send Inquiry'}
              </button>
              <button type="button" onClick={() => { setShowCommForm(false); setCommError('') }}
                style={{ fontFamily: 'monospace', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '11px 18px', background: 'transparent', color: '#8a5c3a', border: '1px solid #d4c9bb', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>

      <Footer />

      {/* Toast */}
      {toast.visible && (
        <div style={{
          position: 'fixed', bottom: '24px', right: '24px', zIndex: 300,
          background: '#1a1814', color: '#f5f2ec',
          fontFamily: 'monospace', fontSize: '12px', letterSpacing: '0.08em',
          padding: '12px 20px', pointerEvents: 'none',
        }}>
          {toast.message}
        </div>
      )}

      {/* Lightbox */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 200,
            background: 'rgba(10,8,6,0.88)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <button
              onClick={() => setSelected(null)}
              style={{
                position: 'absolute', top: '-36px', right: 0,
                fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase',
                color: 'rgba(245,242,236,0.6)', background: 'none', border: 'none', cursor: 'pointer',
              }}
            >
              ✕ close
            </button>

            {selected.imageURL && (
              <img
                src={selected.imageURL}
                alt={selected.title || ''}
                style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', display: 'block' }}
              />
            )}

            <div style={{ marginTop: '12px' }}>
              <p style={{ fontFamily: 'serif', fontSize: '1.1rem', color: '#f5f2ec', margin: 0 }}>{selected.title}</p>
              <div style={{ display: 'flex', gap: '16px', marginTop: '4px', alignItems: 'baseline' }}>
                {selected.sold
                  ? <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a857d', margin: 0, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Sold</p>
                  : <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#d2a564', margin: 0 }}>${selected.price}</p>
                }
                {selected.medium && <p style={{ fontFamily: 'monospace', fontSize: '11px', color: 'rgba(245,242,236,0.45)', margin: 0 }}>{selected.medium}</p>}
              </div>
              {selected.description && (
                <p style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgba(245,242,236,0.55)', marginTop: '8px', lineHeight: 1.6, maxWidth: '480px' }}>
                  {selected.description}
                </p>
              )}
              <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
                {!selected.sold && selected.productData && (
                  <button
                    onClick={() => { addToCart(selected.productData); showToast('Added to cart') }}
                    style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '9px 20px', background: '#f5f2ec', border: 'none', color: '#1a1814', cursor: 'pointer', transition: 'opacity 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}
                  >
                    Add to Cart
                  </button>
                )}
                {selected.slug && (
                  <button
                    onClick={() => navigate(`/shop/${selected.slug}`)}
                    style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '9px 18px', background: 'transparent', border: '1px solid rgba(245,242,236,0.3)', color: 'rgba(245,242,236,0.7)', cursor: 'pointer', transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(245,242,236,0.7)'; e.currentTarget.style.color = '#f5f2ec' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(245,242,236,0.3)'; e.currentTarget.style.color = 'rgba(245,242,236,0.7)' }}
                  >
                    View in Shop →
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
