import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, query, where, orderBy } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { getPastEvents } from '../data/events'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function fmtDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

function fmtYear(dateStr) {
  return dateStr ? dateStr.split('-')[0] : ''
}

// ── Single event strip ────────────────────────────────────────────────────────
function EventStrip({ event }) {
  const navigate  = useNavigate()
  const [photos,  setPhotos]  = useState(null)  // null = loading
  const stripRef  = useRef(null)
  const [canLeft,  setCanLeft]  = useState(false)
  const [canRight, setCanRight] = useState(false)

  useEffect(() => {
    getDocs(
      query(
        collection(db, 'eventRecaps', event.id, 'photos'),
        where('approved', '==', true),
        orderBy('submittedAt', 'asc'),
      )
    )
      .then(snap => setPhotos(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => setPhotos([]))
  }, [event.id])

  function updateArrows() {
    const el = stripRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 8)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8)
  }

  useEffect(() => {
    const el = stripRef.current
    if (!el || !photos?.length) return
    updateArrows()
    el.addEventListener('scroll', updateArrows, { passive: true })
    window.addEventListener('resize', updateArrows)
    return () => { el.removeEventListener('scroll', updateArrows); window.removeEventListener('resize', updateArrows) }
  }, [photos])

  function scroll(dir) {
    const el = stripRef.current
    if (!el) return
    el.scrollBy({ left: dir * 320, behavior: 'smooth' })
  }

  const hasPhotos = photos && photos.length > 0

  return (
    <article style={{ marginBottom: '48px' }}>
      {/* ── Event header ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '14px' }}>
        <div>
          {event.eventType && (
            <p style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#b97a30', margin: '0 0 4px' }}>
              {event.eventType}
            </p>
          )}
          <h2
            onClick={() => navigate(`/events/${event.id}`)}
            style={{ fontFamily: 'serif', fontSize: 'clamp(1.1rem, 3vw, 1.4rem)', fontWeight: 'normal', color: '#ece6d9', margin: '0 0 4px', cursor: 'pointer', lineHeight: 1.2 }}
            onMouseEnter={e => e.currentTarget.style.color = '#d4b870'}
            onMouseLeave={e => e.currentTarget.style.color = '#ece6d9'}
          >
            {event.title}
          </h2>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: 'rgba(236,230,217,0.45)', margin: 0 }}>
            {fmtDate(event.date)}{event.location ? ` · ${event.location}` : ''}
          </p>
        </div>
        <button
          onClick={() => navigate(`/events/${event.id}`)}
          style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(212,184,112,0.7)', background: 'none', border: '1px solid rgba(212,184,112,0.25)', padding: '5px 12px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, transition: 'all 0.15s' }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(212,184,112,0.6)'; e.currentTarget.style.color = '#d4b870' }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(212,184,112,0.25)'; e.currentTarget.style.color = 'rgba(212,184,112,0.7)' }}
        >
          View →
        </button>
      </div>

      {/* ── Photo carousel or flyer ── */}
      {photos === null ? (
        <div style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spinner size={18} color="#a08060" />
        </div>
      ) : hasPhotos ? (
        <div style={{ position: 'relative' }}>
          {/* Scroll arrows */}
          {canLeft && (
            <button
              onClick={() => scroll(-1)}
              style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 2, background: 'rgba(10,6,2,0.75)', border: '1px solid rgba(255,255,255,0.12)', color: '#ece6d9', width: '36px', height: '36px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              aria-label="Scroll left"
            >‹</button>
          )}
          {canRight && (
            <button
              onClick={() => scroll(1)}
              style={{ position: 'absolute', right: 0, top: '50%', transform: 'translateY(-50%)', zIndex: 2, background: 'rgba(10,6,2,0.75)', border: '1px solid rgba(255,255,255,0.12)', color: '#ece6d9', width: '36px', height: '36px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              aria-label="Scroll right"
            >›</button>
          )}

          {/* Strip */}
          <div
            ref={stripRef}
            style={{
              display: 'flex',
              gap: '6px',
              overflowX: 'auto',
              scrollSnapType: 'x mandatory',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
              paddingBottom: '2px',
            }}
          >
            {/* Flyer first if present */}
            {event.flyerURL && (
              <div
                style={{ flexShrink: 0, width: '180px', height: '240px', scrollSnapAlign: 'start', overflow: 'hidden', position: 'relative' }}
              >
                <img
                  src={event.flyerURL}
                  alt={`${event.title} flyer`}
                  style={{ width: '100%', height: '100%', objectFit: 'cover', filter: 'brightness(0.85) contrast(1.05)' }}
                  loading="lazy"
                />
                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '6px 8px', background: 'linear-gradient(transparent, rgba(0,0,0,0.7))', fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' }}>
                  Flyer
                </div>
              </div>
            )}

            {photos.map((photo, i) => (
              <div
                key={photo.id}
                style={{ flexShrink: 0, scrollSnapAlign: 'start', position: 'relative', overflow: 'hidden' }}
              >
                <img
                  src={photo.photoURL}
                  alt={photo.caption || `Photo ${i + 1}`}
                  style={{ height: '240px', width: 'auto', maxWidth: '380px', minWidth: '160px', objectFit: 'cover', display: 'block', filter: 'brightness(0.9) contrast(1.05)' }}
                  loading="lazy"
                />
                {photo.caption && (
                  <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '6px 8px', background: 'linear-gradient(transparent, rgba(0,0,0,0.7))', fontFamily: 'monospace', fontSize: '10px', color: 'rgba(255,255,255,0.75)', lineHeight: 1.4 }}>
                    {photo.caption}
                  </div>
                )}
              </div>
            ))}
          </div>

          <p style={{ fontFamily: 'monospace', fontSize: '10px', color: 'rgba(236,230,217,0.3)', marginTop: '8px', letterSpacing: '0.05em' }}>
            {photos.length} photo{photos.length !== 1 ? 's' : ''}
          </p>
        </div>
      ) : event.flyerURL ? (
        /* No recap photos — show flyer only */
        <div style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
          <img
            src={event.flyerURL}
            alt={`${event.title} flyer`}
            style={{ height: '160px', width: 'auto', maxWidth: '120px', objectFit: 'cover', filter: 'brightness(0.8) contrast(1.05)', flexShrink: 0 }}
            loading="lazy"
          />
          {event.description && (
            <p style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgba(236,230,217,0.4)', lineHeight: 1.7, margin: 0 }}>
              {event.description.length > 200 ? event.description.slice(0, 200) + '…' : event.description}
            </p>
          )}
        </div>
      ) : (
        /* No flyer, no photos */
        <div style={{ padding: '20px 0', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          {event.description && (
            <p style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgba(236,230,217,0.35)', lineHeight: 1.7, margin: 0 }}>
              {event.description.length > 200 ? event.description.slice(0, 200) + '…' : event.description}
            </p>
          )}
          <button
            onClick={() => navigate(`/events/${event.id}`)}
            style={{ marginTop: '10px', fontFamily: 'monospace', fontSize: '10px', color: 'rgba(212,184,112,0.5)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, letterSpacing: '0.08em' }}
          >
            Add recap photos →
          </button>
        </div>
      )}
    </article>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PastEventsPage() {
  const navigate = useNavigate()
  const [events,  setEvents]  = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getPastEvents()
      .then(setEvents)
      .catch(() => setEvents([]))
      .finally(() => setLoading(false))
  }, [])

  // Group by year for section headers
  const byYear = events.reduce((acc, ev) => {
    const yr = fmtYear(ev.date)
    if (!acc[yr]) acc[yr] = []
    acc[yr].push(ev)
    return acc
  }, {})
  const years = Object.keys(byYear).sort((a, b) => b - a)

  return (
    <main style={{ background: '#0e0e0e', minHeight: '100vh', paddingTop: '60px' }}>
      {/* ── Header ── */}
      <section style={{ maxWidth: '860px', margin: '0 auto', padding: '48px 24px 32px' }}>
        <button
          onClick={() => navigate('/events')}
          style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(236,230,217,0.4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: '32px', display: 'block' }}
        >
          ← Events Calendar
        </button>

        <p style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.25em', textTransform: 'uppercase', color: '#b97a30', marginBottom: '10px' }}>Archive</p>
        <h1 style={{ fontFamily: 'serif', fontSize: 'clamp(2rem, 6vw, 3rem)', fontWeight: 'normal', color: '#ece6d9', margin: '0 0 10px', lineHeight: 1.1 }}>
          Past Events
        </h1>
        <p style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgba(236,230,217,0.4)', margin: 0, lineHeight: 1.7 }}>
          Memories from the Fort Wayne art community. Recap photos courtesy of attendees.
        </p>
      </section>

      {/* ── Content ── */}
      <section style={{ maxWidth: '860px', margin: '0 auto', padding: '0 24px 80px' }}>
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
            <Spinner size={22} color="#a08060" />
          </div>
        )}

        {!loading && events.length === 0 && (
          <p style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgba(236,230,217,0.35)', padding: '40px 0' }}>
            No past events yet — check back after the first one wraps up.
          </p>
        )}

        {!loading && years.map(yr => (
          <div key={yr}>
            {/* Year divider */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '32px', marginTop: '8px' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.2em', color: 'rgba(236,230,217,0.25)', textTransform: 'uppercase' }}>
                {yr}
              </span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.07)' }} />
            </div>

            {byYear[yr].map(ev => (
              <EventStrip key={ev.id} event={ev} />
            ))}
          </div>
        ))}
      </section>

      <Footer />
    </main>
  )
}
