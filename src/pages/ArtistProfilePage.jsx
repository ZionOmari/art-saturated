import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { addDoc, collection, getDocs, getDoc, doc, query, where, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { getArtistProfile, getArtistWork, getArtistBySlug } from '../data/artists'
import { getPublishedPosts } from '../data/blogPosts'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { useToast } from '../hooks/useToast'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'
import MessageThread from '../components/MessageThread'

const BLANK_REQ = { name: '', email: '', description: '', budget: '', timeline: '' }
const TABS = ['bio', 'portfolio', 'blog']

const tabBtnStyle = (active) => ({
  fontFamily: 'monospace',
  fontSize: '11px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '10px 20px',
  background: 'transparent',
  border: 'none',
  borderBottom: active ? '2px solid #1a1814' : '2px solid transparent',
  color: active ? '#1a1814' : '#8a857d',
  cursor: 'pointer',
  transition: 'color 0.15s, border-color 0.15s',
})

const linkStyle = {
  fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em',
  textTransform: 'uppercase', color: '#7a5030', textDecoration: 'none',
  borderBottom: '1px solid #a08060', paddingBottom: '1px',
  transition: 'color 0.15s, border-color 0.15s',
}

export default function ArtistProfilePage() {
  const params         = useParams()
  const navigate       = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user }       = useAuth()
  const { addToCart }  = useCart()
  const { toast, showToast } = useToast()
  const [artist, setArtist]   = useState(null)
  const [work,   setWork]     = useState([])
  const [posts,  setPosts]    = useState([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)

  const activeTab = TABS.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'bio'
  function setTab(t) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      if (t === 'bio') next.delete('tab'); else next.set('tab', t)
      return next
    }, { replace: true })
  }

  // Commission request form
  const [commForm,     setCommForm]     = useState(BLANK_REQ)
  const [commBusy,     setCommBusy]     = useState(false)
  const [commSent,     setCommSent]     = useState(false)
  const [commError,    setCommError]    = useState('')
  const [showCommForm, setShowCommForm] = useState(false)
  const [newRequestId, setNewRequestId] = useState(null)

  // Portfolio filters
  const [statusFilter, setStatusFilter] = useState('all')
  const [mediumFilter, setMediumFilter] = useState('all')

  const paramValue = params.slug || params.uid

  useEffect(() => {
    async function load() {
      try {
        let prof = await getArtistBySlug(paramValue)
        if (!prof) prof = await getArtistProfile(paramValue)
        const uid = prof?.uid
        if (!uid) { setArtist(null); setWork([]); setLoading(false); return }

        const [submissionWork, productSnap, blogPosts] = await Promise.all([
          getArtistWork(uid),
          getDocs(query(collection(db, 'products'), where('artistUid', '==', uid))),
          getPublishedPosts(uid).catch(() => []),
        ])

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

        const subProductIds = new Set(submissionWork.map(s => s.productId).filter(Boolean))

        const productWork = productSnap.docs
          .map(d => {
            const p = { id: d.id, ...d.data() }
            const imgArr = Array.isArray(p.imageURLs) ? p.imageURLs
                         : Array.isArray(p.images)    ? p.images : null
            return {
              id: p.id, _source: 'product', slug: p.slug || null,
              title: p.name || '', imageURL: imgArr ? imgArr[0] : (p.imageURL || p.image || null),
              price: p.price, medium: p.medium || '', description: p.description || '',
              submittedAt: p.createdAt || null, active: p.active !== false,
              source: p.source || '', sold: p.sold || false, productData: p,
            }
          })
          .filter(p => p.active && !subProductIds.has(p.id))

        const seen = new Set()
        const merged = [...enrichedSubs, ...productWork]
          .filter(w => { if (seen.has(w.id)) return false; seen.add(w.id); return true })
          .sort((a, b) => (b.submittedAt?.seconds || 0) - (a.submittedAt?.seconds || 0))

        setArtist(prof)
        setWork(merged)
        setPosts(blogPosts)
      } catch (err) {
        console.error('ArtistProfilePage load error:', err)
        setArtist(null); setWork([]); setPosts([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [paramValue])

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
        artistId: artist.uid, artistEmail: artist.email || '', artistName: artist.name || '',
        collectorName: commForm.name, collectorEmail: commForm.email,
        collectorUid: user?.uid || null, description: commForm.description,
        budget: commForm.budget || null, timeline: commForm.timeline || null,
        status: 'new', createdAt: serverTimestamp(),
      })
      setNewRequestId(docRef.id)
      setCommSent(true)
      setCommForm(BLANK_REQ)
    } catch { setCommError('Something went wrong — please try again.') }
    finally { setCommBusy(false) }
  }

  // Compute artist theme background style
  const themeStyle = {}
  if (artist?.theme) {
    const { backgroundType, color1, color2 } = artist.theme
    if (backgroundType === 'gradient' && color1 && color2) {
      themeStyle.background = `linear-gradient(135deg, ${color1}, ${color2})`
    } else if (backgroundType === 'solid' && color1) {
      themeStyle.background = color1
    }
  }

  if (loading) {
    return (
      <main className="pt-[60px]">
        <div className="max-w-5xl mx-auto px-6 pt-20"><Spinner size={20} color="#3d2810" /></div>
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
  const externalLinks = artist.externalLinks || []
  const allMediums = [...new Set(work.map(w => w.medium).filter(Boolean))].sort()

  const filteredWork = work.filter(w => {
    if (statusFilter === 'for-sale' && w.sold) return false
    if (statusFilter === 'sold' && !w.sold) return false
    if (mediumFilter !== 'all' && w.medium !== mediumFilter) return false
    return true
  })

  return (
    <main className="pt-[60px]" style={themeStyle.background ? { ...themeStyle, minHeight: '100vh' } : undefined}>
      {/* Banner */}
      {artist.bannerURL && (
        <div style={{ width: '100%', maxHeight: '360px', overflow: 'hidden', background: '#e8e0d4' }}>
          <img src={artist.bannerURL} alt="" style={{ width: '100%', maxHeight: '360px', objectFit: 'cover', display: 'block' }} />
        </div>
      )}

      {/* Secondary nav */}
      <div className="max-w-5xl mx-auto px-6 pt-6 flex gap-6 flex-wrap">
        <button onClick={() => navigate('/artists')}
          style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7a5030', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          ← Browse All Artists
        </button>
        <button onClick={() => navigate('/shop')}
          style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#7a5030', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          Visit the Shop →
        </button>
      </div>

      {/* Profile header */}
      <section className="max-w-5xl mx-auto px-6 pt-8 pb-8">
        <div style={{ display: 'flex', gap: '28px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
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
          <div style={{ flex: 1, minWidth: '220px' }}>
            <p className="eyebrow mb-2">Artist</p>
            <h1 className="font-serif text-[clamp(1.8rem,5vw,3rem)] font-normal leading-tight text-ink">
              {artist.name || 'Artist'}
            </h1>
            <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#7a5030', marginTop: '8px', letterSpacing: '0.06em' }}>
              {work.filter(w => !w.sold).length} available · {work.filter(w => w.sold).length} sold
              {posts.length > 0 && <> · {posts.length} post{posts.length !== 1 ? 's' : ''}</>}
            </p>
          </div>
        </div>
      </section>

      {/* Tab bar */}
      <div className="max-w-5xl mx-auto px-6 border-b border-warm-gray-light">
        <div style={{ display: 'flex', gap: '4px' }}>
          <button style={tabBtnStyle(activeTab === 'bio')} onClick={() => setTab('bio')}>Bio</button>
          <button style={tabBtnStyle(activeTab === 'portfolio')} onClick={() => setTab('portfolio')}>
            Portfolio{work.length > 0 ? ` (${work.length})` : ''}
          </button>
          <button style={tabBtnStyle(activeTab === 'blog')} onClick={() => setTab('blog')}>
            Blog{posts.length > 0 ? ` (${posts.length})` : ''}
          </button>
        </div>
      </div>

      {/* ── Bio Tab ────────────────────────────────────────────── */}
      {activeTab === 'bio' && (
        <>
          <section className="max-w-5xl mx-auto px-6 py-14">
            {artist.artistBio && (
              <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#7a5030', lineHeight: 1.7, maxWidth: '560px', marginBottom: '24px' }}>
                {artist.artistBio}
              </p>
            )}

            {/* Social / external links */}
            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
              {instaHandle && (
                <a href={`https://instagram.com/${instaHandle}`} target="_blank" rel="noreferrer" style={linkStyle}
                  onMouseEnter={e => { e.currentTarget.style.color = '#1a1814'; e.currentTarget.style.borderColor = '#1a1814' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#7a5030'; e.currentTarget.style.borderColor = '#a08060' }}>
                  Instagram ↗
                </a>
              )}
              {artist.website && (
                <a href={artist.website} target="_blank" rel="noreferrer" style={linkStyle}
                  onMouseEnter={e => { e.currentTarget.style.color = '#1a1814'; e.currentTarget.style.borderColor = '#1a1814' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#7a5030'; e.currentTarget.style.borderColor = '#a08060' }}>
                  Website ↗
                </a>
              )}
              {externalLinks.map((link, i) => (
                <a key={i} href={link.url} target="_blank" rel="noreferrer" style={linkStyle}
                  onMouseEnter={e => { e.currentTarget.style.color = '#1a1814'; e.currentTarget.style.borderColor = '#1a1814' }}
                  onMouseLeave={e => { e.currentTarget.style.color = '#7a5030'; e.currentTarget.style.borderColor = '#a08060' }}>
                  {link.label || link.url} ↗
                </a>
              ))}
            </div>
          </section>

          {/* Commission Inquiry */}
          <section className="max-w-5xl mx-auto px-6 pb-20 border-t border-warm-gray-light pt-14">
            <p className="eyebrow mb-4">Custom Work</p>
            {commSent ? (
              <div style={{ maxWidth: '520px' }}>
                <div style={{ padding: '24px', border: '1px solid #a08060', background: 'rgba(58,122,64,0.04)' }}>
                  <p className="font-serif text-[1.1rem] font-normal mb-2">Inquiry sent!</p>
                  <p className="font-mono text-[12px] text-warm-gray leading-relaxed">
                    {artist.name?.split(' ')[0] || 'The artist'} will reach out to you directly.
                    Payment and terms are arranged privately — Art Saturated takes no fee on custom commissions.
                  </p>
                  <button onClick={() => { setCommSent(false); setShowCommForm(false); setNewRequestId(null) }}
                    style={{ marginTop: '16px', fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '6px 14px', background: 'transparent', border: '1px solid #a08060', cursor: 'pointer', color: '#8a5c3a' }}>
                    Send another
                  </button>
                </div>
                {newRequestId && user && (
                  <div>
                    <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a5c3a', padding: '10px 14px 0', background: '#faf8f4', border: '1px solid #a08060', borderTop: 'none', borderBottom: 'none' }}>
                      Message thread
                    </p>
                    <MessageThread requestId={newRequestId} currentUid={user.uid}
                      currentName={user.displayName || commForm.name || 'Collector'} role="collector" />
                  </div>
                )}
              </div>
            ) : !showCommForm ? (
              <div>
                <h2 className="font-serif text-[1.4rem] font-normal mb-3">Interested in a custom piece?</h2>
                <p className="font-mono text-[12px] text-warm-gray leading-relaxed max-w-md mb-6">
                  Send {artist.name?.split(' ')[0] || 'this artist'} an inquiry. They'll follow up with you directly — payment and terms are handled privately.
                  Art Saturated takes no commission on custom work.
                </p>
                <button onClick={() => setShowCommForm(true)}
                  style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', padding: '12px 24px', border: '1px solid #1a1814', background: 'transparent', cursor: 'pointer', color: '#1a1814', transition: 'all 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#1a1814'; e.currentTarget.style.color = '#f5f2ec' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#1a1814' }}>
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
                  { key: 'name', label: 'Your Name', placeholder: 'Full name', required: true },
                  { key: 'email', label: 'Your Email', placeholder: 'email@example.com', required: true, type: 'email' },
                  { key: 'budget', label: 'Budget (optional)', placeholder: 'e.g. $200–$400' },
                  { key: 'timeline', label: 'Timeline (optional)', placeholder: 'e.g. 4 weeks, by end of July' },
                ].map(f => (
                  <div key={f.key}>
                    <p style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8a5c3a', marginBottom: '4px' }}>{f.label}</p>
                    <input type={f.type || 'text'} required={f.required} placeholder={f.placeholder}
                      value={commForm[f.key]} onChange={e => setCommForm(p => ({ ...p, [f.key]: e.target.value }))}
                      style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px', padding: '10px 12px', border: '1px solid #d4c9bb', background: '#faf8f4', color: '#1a1208', outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                ))}
                <div>
                  <p style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8a5c3a', marginBottom: '4px' }}>Project Description *</p>
                  <textarea required rows={5} placeholder="Describe what you have in mind — subject, style, size, any reference images you have…"
                    value={commForm.description} onChange={e => setCommForm(p => ({ ...p, description: e.target.value }))}
                    style={{ width: '100%', fontFamily: 'monospace', fontSize: '13px', padding: '10px 12px', border: '1px solid #d4c9bb', background: '#faf8f4', color: '#1a1208', outline: 'none', resize: 'vertical', boxSizing: 'border-box' }} />
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
        </>
      )}

      {/* ── Portfolio Tab ──────────────────────────────────────── */}
      {activeTab === 'portfolio' && (
        <section className="max-w-5xl mx-auto px-6 py-10 pb-24">
          {/* Filters */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '24px', alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: '6px' }}>
              {[
                { value: 'all', label: 'All' },
                { value: 'for-sale', label: 'For Sale' },
                { value: 'sold', label: 'Sold' },
              ].map(f => (
                <button key={f.value} onClick={() => setStatusFilter(f.value)}
                  style={{
                    fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase',
                    padding: '6px 14px', cursor: 'pointer', transition: 'all 0.15s',
                    background: statusFilter === f.value ? '#1a1814' : 'transparent',
                    color: statusFilter === f.value ? '#f5f2ec' : '#7a5030',
                    border: `1px solid ${statusFilter === f.value ? '#1a1814' : '#d4c9bb'}`,
                  }}>
                  {f.label}
                </button>
              ))}
            </div>
            {allMediums.length > 1 && (
              <select value={mediumFilter} onChange={e => setMediumFilter(e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: '11px', padding: '6px 10px', border: '1px solid #d4c9bb', background: 'transparent', color: '#1a1814', cursor: 'pointer' }}>
                <option value="all">All Mediums</option>
                {allMediums.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            )}
            <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a857d' }}>
              {filteredWork.length} piece{filteredWork.length !== 1 ? 's' : ''}
            </span>
          </div>

          {filteredWork.length === 0 ? (
            <p className="font-mono text-[13px] text-warm-gray">
              {work.length === 0 ? 'No published work yet.' : 'No pieces match these filters.'}
            </p>
          ) : (
            <div style={{ columns: '2', columnGap: '10px' }} className="sm:columns-3 lg:columns-4">
              {filteredWork.map(piece => (
                <div key={piece.id} onClick={() => setSelected(piece)}
                  style={{ breakInside: 'avoid', marginBottom: '10px', cursor: 'pointer', position: 'relative' }}>
                  <div style={{ overflow: 'hidden', background: '#e8e0d4', position: 'relative' }}
                    onMouseEnter={e => e.currentTarget.querySelector('.overlay')?.style && (e.currentTarget.querySelector('.overlay').style.opacity = '1')}
                    onMouseLeave={e => e.currentTarget.querySelector('.overlay')?.style && (e.currentTarget.querySelector('.overlay').style.opacity = '0')}>
                    {piece.imageURL
                      ? <img src={piece.imageURL} alt={piece.title || ''} style={{ width: '100%', display: 'block', transition: 'transform 0.25s' }}
                          onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.03)'}
                          onMouseLeave={e => e.currentTarget.style.transform = ''} />
                      : <div style={{ aspectRatio: '1', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2rem' }}>🖼️</div>
                    }
                    {piece.sold && (
                      <div style={{ position: 'absolute', top: '7px', left: '7px', background: 'rgba(26,24,20,0.78)', color: '#f5f2ec',
                        fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', padding: '3px 7px' }}>
                        Sold
                      </div>
                    )}
                    <div className="overlay" style={{ position: 'absolute', inset: 0, background: 'rgba(26,24,20,0.55)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0, transition: 'opacity 0.2s' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#f5f2ec', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                        {piece.sold ? 'View' : 'View · Add to Cart'}
                      </span>
                    </div>
                  </div>
                  <div style={{ paddingTop: '6px', paddingBottom: '4px' }}>
                    <p style={{ fontFamily: 'serif', fontSize: '0.9rem', color: '#1a1814', margin: 0, lineHeight: 1.3 }}>{piece.title}</p>
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
      )}

      {/* ── Blog Tab ───────────────────────────────────────────── */}
      {activeTab === 'blog' && (
        <section className="max-w-5xl mx-auto px-6 py-10 pb-24">
          {posts.length === 0 ? (
            <p className="font-mono text-[13px] text-warm-gray">No blog posts yet.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '32px', maxWidth: '640px' }}>
              {posts.map(post => {
                const date = post.publishedAt?.toDate ? post.publishedAt.toDate() : post.publishedAt ? new Date(post.publishedAt) : null
                return (
                  <article key={post.id} style={{ borderBottom: '1px solid #e8e0d4', paddingBottom: '28px' }}>
                    <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a857d', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '8px' }}>
                      {date ? date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'Draft'}
                    </p>
                    <h2 style={{ fontFamily: 'serif', fontSize: '1.4rem', color: '#1a1814', margin: '0 0 12px', fontWeight: 400, lineHeight: 1.3 }}>
                      {post.title}
                    </h2>
                    <div style={{ fontFamily: 'monospace', fontSize: '13px', color: '#5a3820', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                      {post.body}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      )}

      <Footer />

      {/* Toast */}
      {toast.visible && (
        <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 300,
          background: '#1a1814', color: '#f5f2ec', fontFamily: 'monospace', fontSize: '12px',
          letterSpacing: '0.08em', padding: '12px 20px', pointerEvents: 'none' }}>
          {toast.message}
        </div>
      )}

      {/* Lightbox */}
      {selected && (
        <div onClick={() => setSelected(null)} style={{ position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(10,8,6,0.88)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
          <div onClick={e => e.stopPropagation()} style={{ position: 'relative', maxWidth: '90vw', maxHeight: '90vh' }}>
            <button onClick={() => setSelected(null)} style={{ position: 'absolute', top: '-36px', right: 0,
              fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'rgba(245,242,236,0.6)', background: 'none', border: 'none', cursor: 'pointer' }}>
              ✕ close
            </button>
            {selected.imageURL && (
              <img src={selected.imageURL} alt={selected.title || ''} style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain', display: 'block' }} />
            )}
            <div style={{ marginTop: '12px' }}>
              <p style={{ fontFamily: 'serif', fontSize: '1.1rem', color: '#f5f2ec', margin: 0 }}>{selected.title}</p>
              <div style={{ display: 'flex', gap: '16px', marginTop: '4px', alignItems: 'baseline' }}>
                {selected.sold
                  ? <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a857d', margin: 0, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Sold</p>
                  : <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#d2a564', margin: 0 }}>${selected.price}</p>}
                {selected.medium && <p style={{ fontFamily: 'monospace', fontSize: '11px', color: 'rgba(245,242,236,0.45)', margin: 0 }}>{selected.medium}</p>}
              </div>
              {selected.description && (
                <p style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgba(245,242,236,0.55)', marginTop: '8px', lineHeight: 1.6, maxWidth: '480px' }}>
                  {selected.description}
                </p>
              )}
              <div style={{ display: 'flex', gap: '8px', marginTop: '14px', flexWrap: 'wrap' }}>
                {!selected.sold && selected.productData && (
                  <button onClick={() => { addToCart(selected.productData); showToast('Added to cart') }}
                    style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '9px 20px',
                      background: '#f5f2ec', border: 'none', color: '#1a1814', cursor: 'pointer', transition: 'opacity 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                    onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                    Add to Cart
                  </button>
                )}
                {selected.slug && (
                  <button onClick={() => navigate(`/shop/${selected.slug}`)}
                    style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '9px 18px',
                      background: 'transparent', border: '1px solid rgba(245,242,236,0.3)', color: 'rgba(245,242,236,0.7)', cursor: 'pointer', transition: 'all 0.15s' }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(245,242,236,0.7)'; e.currentTarget.style.color = '#f5f2ec' }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(245,242,236,0.3)'; e.currentTarget.style.color = 'rgba(245,242,236,0.7)' }}>
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
