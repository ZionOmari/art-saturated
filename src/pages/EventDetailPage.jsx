import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  doc, getDoc, collection, getDocs, addDoc,
  query, orderBy, where, serverTimestamp, setDoc,
} from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'

const MONTHS_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DOW_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

const eyebrow = {
  fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.15em',
  textTransform: 'uppercase', color: '#d4b870', marginBottom: '8px', display: 'block',
}
const inp = {
  width: '100%', fontFamily: 'monospace', fontSize: '13px', padding: '10px 12px',
  border: '1px solid #a08060', background: 'rgba(236,230,217,0.6)', color: '#1a1814',
  outline: 'none', boxSizing: 'border-box',
}
const darkBanner = {
  background: 'rgba(36,20,8,0.82)', color: '#ece6d9',
  padding: '10px 14px', borderRadius: '4px', display: 'inline-block',
}

export default function EventDetailPage() {
  const { eventId } = useParams()
  const navigate    = useNavigate()
  const { user, profile } = useAuth()

  const [event,         setEvent]         = useState(null)
  const [loading,       setLoading]       = useState(true)
  const [photos,        setPhotos]        = useState([])
  const [photosLoading, setPhotosLoading] = useState(true)

  // Notification opt-in
  const [notifySaving, setNotifySaving] = useState(false)
  const [notifyDone,   setNotifyDone]   = useState(false)
  const [linkCopied,   setLinkCopied]   = useState(false)

  // Photo submission
  const [photoFile,     setPhotoFile]     = useState(null)
  const [photoPreview,  setPhotoPreview]  = useState(null)
  const [caption,       setCaption]       = useState('')
  const [submitterName, setSubmitterName] = useState('')
  const [submitting,    setSubmitting]    = useState(false)
  const [submitted,     setSubmitted]     = useState(false)
  const [submitError,   setSubmitError]   = useState('')

  useEffect(() => {
    getDoc(doc(db, 'events', eventId))
      .then(snap => {
        if (snap.exists()) {
          const ev = { id: snap.id, ...snap.data() }
          setEvent(ev)
          document.title = `${ev.title} — Art Saturated`
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => { document.title = 'Art Saturated' }
  }, [eventId])

  const isOwner = !!(user && event && event.submitterUid && event.submitterUid === user.uid)

  useEffect(() => {
    if (!event) return
    const q = isOwner
      ? query(collection(db, 'eventRecaps', eventId, 'photos'), orderBy('submittedAt', 'asc'))
      : query(collection(db, 'eventRecaps', eventId, 'photos'), where('approved', '==', true), orderBy('submittedAt', 'asc'))
    getDocs(q)
      .then(snap => setPhotos(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {})
      .finally(() => setPhotosLoading(false))
  }, [eventId, event, isOwner]) // eslint-disable-line react-hooks/exhaustive-deps

  async function handleNotifyOptIn() {
    if (!user) { navigate('/login', { state: { from: `/events/${eventId}` } }); return }
    setNotifySaving(true)
    try {
      await setDoc(doc(db, 'users', user.uid), { notifyEvents: true }, { merge: true })
      setNotifyDone(true)
    } finally { setNotifySaving(false) }
  }

  function handlePhotoFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setPhotoFile(file)
    setPhotoPreview(URL.createObjectURL(file))
    e.target.value = ''
  }

  async function handlePhotoSubmit(e) {
    e.preventDefault()
    if (!photoFile) { setSubmitError('Please select a photo.'); return }
    setSubmitting(true); setSubmitError('')
    try {
      const imgRef   = ref(storage, `event-recaps/${eventId}/${Date.now()}_${photoFile.name}`)
      const snap     = await uploadBytes(imgRef, photoFile)
      const photoURL = await getDownloadURL(snap.ref)
      await addDoc(collection(db, 'eventRecaps', eventId, 'photos'), {
        photoURL,
        caption:       caption.trim(),
        submitterName: submitterName.trim() || profile?.name || '',
        submitterUid:  user?.uid || null,
        approved:      false,
        submittedAt:   serverTimestamp(),
      })
      setSubmitted(true)
      setPhotoFile(null); setPhotoPreview(null); setCaption(''); setSubmitterName('')
    } catch {
      setSubmitError('Upload failed. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <main className="pt-[60px] flex items-center justify-center min-h-screen">
      <Spinner size={20} color="#3d2810" />
    </main>
  )

  if (!event) return (
    <main className="pt-[60px]">
      <div className="max-w-2xl mx-auto px-6 py-20 text-center">
        <p className="font-serif text-[2rem] font-normal mb-4">Event not found.</p>
        <button className="btn-outline" onClick={() => navigate('/events')}>Back to Events</button>
      </div>
      <Footer />
    </main>
  )

  const [y, m, d] = (event.date || '').split('-').map(Number)
  const dateObj   = (y && m && d) ? new Date(y, m - 1, d) : null
  const dateStr   = dateObj
    ? `${DOW_LONG[dateObj.getDay()]}, ${MONTHS_S[m - 1]} ${d}, ${y}`
    : event.date || ''

  const shareURL = window.location.href

  async function copyLink() {
    await navigator.clipboard.writeText(shareURL)
    setLinkCopied(true)
    setTimeout(() => setLinkCopied(false), 2000)
  }

  return (
    <main className="pt-[60px]">
      <div className="max-w-2xl mx-auto px-6 pt-12 pb-24"
        style={{ background: 'rgba(250,248,244,0.96)', backdropFilter: 'blur(4px)', minHeight: 'calc(100vh - 60px)' }}>

        {/* Back */}
        <button
          onClick={() => navigate('/events')}
          style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7a5030', background: 'none', border: 'none', cursor: 'pointer', marginBottom: '32px', display: 'block', padding: 0 }}
        >
          ← Events Calendar
        </button>

        {/* ── Header ── */}
        <div style={{ marginBottom: '28px' }}>
          {event.eventType && <span style={eyebrow}>{event.eventType}</span>}
          <h1 style={{ fontFamily: 'serif', fontSize: 'clamp(1.8rem, 5vw, 2.6rem)', fontWeight: 'normal', lineHeight: 1.1, color: '#1a1208', margin: '0 0 8px' }}>
            {event.title}
          </h1>
          {event.subtitle && (
            <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#8a5c3a', lineHeight: 1.5, margin: 0 }}>
              {event.subtitle}
            </p>
          )}
        </div>

        {/* ── Flyer ── */}
        {event.flyerURL && (
          <div style={{ marginBottom: '28px' }}>
            <img
              src={event.flyerURL}
              alt={`${event.title} flyer`}
              style={{ width: '100%', maxHeight: '420px', objectFit: 'cover', border: '1px solid #a08060', display: 'block' }}
            />
          </div>
        )}

        {/* ── Details box ── */}
        <div style={{ border: '1px solid #a08060', padding: '20px', marginBottom: '24px' }}>
          <span style={eyebrow}>Event Details</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>

            <div style={{ display: 'flex', gap: '12px' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#a08060', width: '72px', flexShrink: 0, paddingTop: '2px' }}>Date</span>
              <div>
                <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#1a1814', margin: 0 }}>{dateStr}</p>
                {(event.startTime || event.time) && (
                  <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#8a5c3a', margin: '3px 0 0' }}>
                    {event.startTime || event.time}{event.endTime ? ` – ${event.endTime}` : ''}
                  </p>
                )}
              </div>
            </div>

            {event.location && (
              <div style={{ display: 'flex', gap: '12px' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#a08060', width: '72px', flexShrink: 0, paddingTop: '2px' }}>Location</span>
                <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#1a1814', margin: 0 }}>{event.location}</p>
              </div>
            )}

            {event.entryFee && (
              <div style={{ display: 'flex', gap: '12px' }}>
                <span style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#a08060', width: '72px', flexShrink: 0, paddingTop: '2px' }}>Entry</span>
                <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#1a1814', margin: 0 }}>{event.entryFee}</p>
              </div>
            )}

            {/* Badges */}
            {(event.allAges || event.alcohol || event.food) && (
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', paddingTop: '4px', borderTop: '1px solid #e8ddd0' }}>
                {event.allAges  && <span style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', border: '1px solid #a08060', padding: '3px 8px', color: '#8a5c3a' }}>All Ages</span>}
                {event.alcohol  && <span style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', border: '1px solid #a08060', padding: '3px 8px', color: '#8a5c3a' }}>Alcohol Served</span>}
                {event.food     && <span style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.12em', textTransform: 'uppercase', border: '1px solid #a08060', padding: '3px 8px', color: '#8a5c3a' }}>Food Available</span>}
              </div>
            )}
          </div>
        </div>

        {/* ── Description ── */}
        {event.description && (
          <div style={{ marginBottom: '24px' }}>
            <span style={eyebrow}>About</span>
            <p style={{ ...darkBanner, fontFamily: 'monospace', fontSize: '13px', lineHeight: 1.8, whiteSpace: 'pre-wrap', width: '100%', boxSizing: 'border-box' }}>
              {event.description}
            </p>
          </div>
        )}

        {/* ── Share + notify ── */}
        <div style={{ border: '1px solid #a08060', padding: '20px', marginBottom: '32px' }}>
          <span style={eyebrow}>Share This Event</span>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
            <button onClick={copyLink}
              style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '9px 18px', border: '1px solid #a08060', background: linkCopied ? '#1a1814' : 'transparent', color: linkCopied ? '#f5f2ec' : '#3d2810', cursor: 'pointer', transition: 'all 0.15s' }}>
              {linkCopied ? '✓ Copied' : '⎘ Copy Link'}
            </button>
            <button
              onClick={() => window.open(`https://x.com/intent/tweet?text=${encodeURIComponent(event.title)}&url=${encodeURIComponent(shareURL)}`, '_blank', 'noopener,noreferrer')}
              style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '9px 18px', border: '1px solid #a08060', background: 'transparent', color: '#3d2810', cursor: 'pointer' }}>
              Post on X
            </button>
          </div>

          {/* Notify opt-in */}
          {notifyDone || profile?.notifyEvents ? (
            <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#5a8a5a' }}>✓ You're signed up for event updates.</p>
          ) : (
            <div>
              <button onClick={handleNotifyOptIn} disabled={notifySaving}
                style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '9px 18px', border: '1px solid #a08060', background: 'transparent', color: '#3d2810', cursor: 'pointer', opacity: notifySaving ? 0.5 : 1 }}>
                {notifySaving ? 'Saving…' : '🔔 Keep Me Posted'}
              </button>
              {!user && (
                <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#7a5030', marginTop: '6px' }}>
                  <button onClick={() => navigate('/login', { state: { from: `/events/${eventId}` } })}
                    style={{ fontFamily: 'monospace', fontSize: '11px', color: '#7a5030', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
                    Sign in
                  </button>
                  {' '}to get notified of new events.
                </p>
              )}
            </div>
          )}
        </div>

        {/* ── Recap Section ── */}
        <div>
          <span style={eyebrow}>Event Recap</span>
          <h2 style={{ fontFamily: 'serif', fontSize: '1.5rem', fontWeight: 'normal', color: '#1a1208', margin: '0 0 6px' }}>Were you there?</h2>
          <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#8a5c3a', lineHeight: 1.7, marginBottom: '24px' }}>
            Share your photos from the event. Submitted photos are reviewed before appearing in the gallery.
          </p>

          {/* Owner notice */}
          {isOwner && (
            <div style={{ ...darkBanner, marginBottom: '20px', width: '100%', boxSizing: 'border-box' }}>
              <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#d4b870', lineHeight: 1.7, margin: 0 }}>
                You submitted this event. Pending photos are visible only to you — they appear publicly once approved.
              </p>
            </div>
          )}

          {/* Photo grid */}
          {photosLoading ? (
            <div style={{ padding: '32px 0', display: 'flex', justifyContent: 'center' }}>
              <Spinner size={16} color="#3d2810" />
            </div>
          ) : photos.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '6px', marginBottom: '32px' }}>
              {photos.map(p => (
                <div key={p.id} style={{ position: 'relative', overflow: 'hidden', border: '1px solid #a08060', opacity: isOwner && !p.approved ? 0.65 : 1 }}>
                  <img src={p.photoURL} alt={p.caption || 'Event photo'} style={{ width: '100%', aspectRatio: '1/1', objectFit: 'cover', display: 'block' }} />
                  {isOwner && !p.approved && (
                    <div style={{ position: 'absolute', top: '4px', left: '4px' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '8px', letterSpacing: '0.1em', textTransform: 'uppercase', background: 'rgba(185,122,48,0.92)', color: '#fff', padding: '2px 5px' }}>
                        Pending
                      </span>
                    </div>
                  )}
                  {(p.caption || p.submitterName) && (
                    <div className="group absolute inset-0 flex flex-col justify-end p-2"
                      style={{ background: 'rgba(26,18,8,0)', transition: 'background 0.18s' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(26,18,8,0.78)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'rgba(26,18,8,0)'}>
                      {p.caption && <p className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ fontFamily: 'monospace', fontSize: '10px', color: '#f5f0e8', margin: 0, lineHeight: 1.4 }}>{p.caption}</p>}
                      {p.submitterName && <p className="opacity-0 group-hover:opacity-100 transition-opacity" style={{ fontFamily: 'monospace', fontSize: '9px', color: '#d4b870', margin: '2px 0 0' }}>📷 {p.submitterName}</p>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#7a5030', marginBottom: '28px' }}>
              No recap photos yet — be the first to share yours.
            </p>
          )}

          {/* Submit form */}
          <div style={{ border: '1px solid #a08060', padding: '20px' }}>
            <span style={eyebrow}>Share a Photo</span>

            {submitted ? (
              <div>
                <p style={{ ...darkBanner, fontFamily: 'monospace', fontSize: '12px', marginBottom: '12px', width: '100%', boxSizing: 'border-box' }}>
                  Thanks for sharing! Your photo is pending review.
                </p>
                <button onClick={() => setSubmitted(false)}
                  style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a5c3a', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  Submit another →
                </button>
              </div>
            ) : (
              <form onSubmit={handlePhotoSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '360px' }}>
                {/* Upload area */}
                <label style={{ display: 'block', width: '100%', aspectRatio: '4/3', border: `1px solid ${photoPreview ? '#1a1814' : '#a08060'}`, background: 'rgba(236,230,217,0.4)', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}>
                  {photoPreview
                    ? <img src={photoPreview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '8px' }}>
                        <span style={{ fontSize: '1.4rem' }}>📷</span>
                        <span style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7a5030' }}>Select photo</span>
                      </div>
                  }
                  {photoPreview && (
                    <button type="button" onClick={e => { e.preventDefault(); setPhotoFile(null); setPhotoPreview(null) }}
                      style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(26,20,8,0.7)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', padding: '3px 7px' }}>
                      ✕
                    </button>
                  )}
                  <input type="file" accept="image/*" onChange={handlePhotoFile} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
                </label>

                <input style={inp} type="text" placeholder="Caption (optional)" value={caption} onChange={e => setCaption(e.target.value)} maxLength={120} />
                <input style={inp} type="text" placeholder={profile?.name ? `Your name (${profile.name})` : 'Your name (optional)'} value={submitterName} onChange={e => setSubmitterName(e.target.value)} maxLength={60} />

                {submitError && (
                  <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b94040', margin: 0 }}>{submitError}</p>
                )}

                <button type="submit" disabled={submitting || !photoFile} className="btn-outline"
                  style={{ opacity: submitting || !photoFile ? 0.45 : 1 }}>
                  {submitting
                    ? <span className="flex items-center gap-2"><Spinner size={12} />Uploading…</span>
                    : 'Submit Photo'
                  }
                </button>
                <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#a08060', margin: 0 }}>
                  Photos are reviewed before appearing in the gallery.
                </p>
              </form>
            )}
          </div>
        </div>
      </div>
      <Footer />
    </main>
  )
}
