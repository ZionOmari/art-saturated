import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { getArtistsWithWork } from '../data/artists'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'

const PAGE_SIZE = 12

// ── Individual artist card ────────────────────────────────────────────────────
function ArtistCard({ artist }) {
  const navigate = useNavigate()
  const preview  = (artist.work || []).slice(0, 4)
  const initials = (artist.name || 'A').charAt(0).toUpperCase()

  return (
    <button
      onClick={() => navigate(`/artists/${artist.uid}`)}
      style={{
        display: 'flex', flexDirection: 'column', textAlign: 'left',
        background: 'rgb(var(--color-paper))',
        border: '1px solid rgb(var(--color-warm-gray-light))',
        cursor: 'pointer', padding: 0,
        transition: 'transform 0.15s, box-shadow 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(26,18,8,0.1)' }}
      onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '' }}
    >
      {/* Thumbnail — banner > first piece > placeholder */}
      <div style={{
        aspectRatio: '16/9',
        background: 'rgb(var(--color-warm-gray-light))',
        overflow: 'hidden',
      }}>
        {(artist.bannerURL || preview[0]?.imageURL) ? (
          <img
            src={artist.bannerURL || preview[0].imageURL}
            alt={artist.bannerURL ? `${artist.name} banner` : (preview[0]?.title || artist.name)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgb(var(--color-cream))' }}>
            <span style={{ fontSize: '2.5rem', opacity: 0.35 }}>🎨</span>
          </div>
        )}
      </div>

      {/* Profile row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px' }}>
        {/* Avatar */}
        <div style={{
          width: '38px', height: '38px', borderRadius: '50%', overflow: 'hidden',
          flexShrink: 0,
          background: 'rgb(var(--color-warm-gray-light))',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {artist.photoURL
            ? <img src={artist.photoURL} alt={artist.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            : <span style={{ fontFamily: 'monospace', fontSize: '14px', color: 'rgb(var(--color-earth))', fontWeight: 600 }}>{initials}</span>
          }
        </div>

        {/* Name + bio */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontFamily: 'serif', fontSize: '1rem', color: 'rgb(var(--color-ink))', margin: 0, lineHeight: 1.2 }}>
            {artist.name || 'Artist'}
          </p>
          {artist.artistBio && (
            <p style={{
              fontFamily: 'monospace', fontSize: '11px',
              color: 'rgb(var(--color-warm-gray))',
              margin: '3px 0 0',
              overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              lineHeight: 1.5,
            }}>
              {artist.artistBio}
            </p>
          )}
          <p style={{
            fontFamily: 'monospace', fontSize: '10px',
            color: 'rgb(var(--color-earth))',
            margin: '4px 0 0', letterSpacing: '0.06em',
          }}>
            {artist.work?.length || 0} {artist.work?.length === 1 ? 'piece' : 'pieces'}
          </p>
        </div>
      </div>
    </button>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ArtistsPage() {
  const [artists, setArtists] = useState([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [visible, setVisible] = useState(PAGE_SIZE)

  useEffect(() => {
    getArtistsWithWork()
      .then(setArtists)
      .catch(() => setArtists([]))
      .finally(() => setLoading(false))
  }, [])

  // Reset pagination whenever search changes
  useEffect(() => { setVisible(PAGE_SIZE) }, [search])

  const filtered = search.trim()
    ? artists.filter(a =>
        (a.name || '').toLowerCase().includes(search.toLowerCase()) ||
        (a.artistBio || '').toLowerCase().includes(search.toLowerCase())
      )
    : artists

  const shown   = filtered.slice(0, visible)
  const hasMore = visible < filtered.length
  const remaining = filtered.length - visible

  return (
    <main className="pt-[60px]">
      {/* Header */}
      <section className="max-w-5xl mx-auto px-6 pt-16 pb-10 border-b border-warm-gray-light">
        <p className="eyebrow mb-4">Community</p>
        <h1 className="font-serif text-[clamp(2rem,6vw,3.5rem)] font-normal leading-tight text-ink mb-3">
          Discover Artists
        </h1>
        <p className="font-mono text-[12px] text-warm-gray tracking-wide">
          Meet the people behind the work.
        </p>
      </section>

      {/* Search */}
      <section className="max-w-5xl mx-auto px-6 pt-10 pb-2">
        <input
          type="text"
          placeholder="Search by name or style…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            fontFamily: 'monospace', fontSize: '13px', padding: '10px 14px',
            border: '1px solid rgb(var(--color-earth))',
            background: 'rgb(var(--color-paper))',
            color: 'rgb(var(--color-ink))',
            outline: 'none', width: '100%', maxWidth: '420px',
            boxSizing: 'border-box',
          }}
        />
      </section>

      {/* Grid */}
      <section className="max-w-5xl mx-auto px-6 py-10 pb-24">
        {loading ? (
          <Spinner size={20} color="#3d2810" />
        ) : filtered.length === 0 ? (
          <p className="font-mono text-[13px] text-warm-gray">
            {search ? 'No artists match that search.' : 'No artists listed yet.'}
          </p>
        ) : (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '20px' }}>
              {shown.map(a => <ArtistCard key={a.uid} artist={a} />)}
            </div>

            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: '3rem' }}>
                <button
                  onClick={() => setVisible(v => v + PAGE_SIZE)}
                  className="btn-ghost"
                >
                  Load more — {remaining} artist{remaining !== 1 ? 's' : ''} remaining
                </button>
              </div>
            )}

            {!loading && filtered.length > 0 && (
              <p className="font-mono text-[11px] text-warm-gray text-center mt-6">
                Showing {shown.length} of {filtered.length} artist{filtered.length !== 1 ? 's' : ''}
              </p>
            )}
          </>
        )}
      </section>

      <Footer />
    </main>
  )
}
