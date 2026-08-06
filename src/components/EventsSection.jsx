import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { getUpcomingEvents, submitEventRequest } from '../data/events'
import Spinner from './Spinner'

const EMPTY_FORM = { title: '', date: '', time: '', location: '', description: '' }

function fmt(dateStr) {
  const [y, m, d] = dateStr.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m) - 1]} ${parseInt(d)}, ${y}`
}

// ── Day-of photo upload widget ────────────────────────────────────────────────
function TonightUpload({ event }) {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const fileRef  = useRef(null)

  const [file,     setFile]     = useState(null)
  const [preview,  setPreview]  = useState(null)
  const [caption,  setCaption]  = useState('')
  const [name,     setName]     = useState('')
  const [busy,     setBusy]     = useState(false)
  const [done,     setDone]     = useState(false)
  const [err,      setErr]      = useState('')

  useEffect(() => {
    if (profile?.name) setName(profile.name)
    else if (user?.displayName) setName(user.displayName)
  }, [profile, user])

  function handleFile(e) {
    const f = e.target.files[0]
    if (!f) return
    setFile(f)
    setPreview(URL.createObjectURL(f))
    e.target.value = ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!file) { setErr('Choose a photo first.'); return }
    setBusy(true); setErr('')
    try {
      const imgRef   = ref(storage, `event-recaps/${event.id}/${Date.now()}_${file.name}`)
      const snap     = await uploadBytes(imgRef, file)
      const photoURL = await getDownloadURL(snap.ref)
      await addDoc(collection(db, 'eventRecaps', event.id, 'photos'), {
        photoURL,
        caption:       caption.trim(),
        submitterName: name.trim() || '',
        submitterUid:  user?.uid || null,
        approved:      false,
        submittedAt:   serverTimestamp(),
      })
      setDone(true)
      setFile(null); setPreview(null); setCaption('')
    } catch {
      setErr('Upload failed — please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      margin: '0 0 24px',
      padding: '18px 20px',
      background: 'rgba(185,122,48,0.08)',
      border: '1px solid rgba(185,122,48,0.35)',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
        <span style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#b97a30', background: 'rgba(185,122,48,0.15)', padding: '3px 8px', border: '1px solid rgba(185,122,48,0.4)' }}>
          Tonight
        </span>
        <p
          className="font-serif"
          style={{ fontSize: '1rem', fontWeight: 'normal', color: '#1a1208', margin: 0, cursor: 'pointer' }}
          onClick={() => navigate(`/events/${event.id}`)}
        >
          {event.title}
        </p>
      </div>
      {event.location && (
        <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a5c3a', margin: '0 0 14px' }}>
          {event.location}{event.startTime ? ` · ${event.startTime}` : ''}
        </p>
      )}

      {done ? (
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#3a7a40', margin: '0 0 8px' }}>
            ✓ Photo submitted — it'll appear once approved.
          </p>
          <button
            onClick={() => setDone(false)}
            style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#8a5c3a', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            Share another →
          </button>
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#7a5030', margin: '0 0 12px', lineHeight: 1.6 }}>
            Were you there? Share a photo from tonight — it'll show up in the event recap.
          </p>

          {/* File picker */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={handleFile}
            style={{ display: 'none' }}
          />

          {preview ? (
            <div style={{ position: 'relative', marginBottom: '10px', display: 'inline-block' }}>
              <img src={preview} alt="preview" style={{ height: '100px', width: 'auto', maxWidth: '200px', objectFit: 'cover', display: 'block' }} />
              <button
                type="button"
                onClick={() => { setFile(null); setPreview(null) }}
                style={{ position: 'absolute', top: '4px', right: '4px', background: 'rgba(0,0,0,0.6)', border: 'none', color: '#fff', width: '20px', height: '20px', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >×</button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 16px', border: '1px solid rgba(185,122,48,0.5)', background: 'transparent', color: '#8a5c3a', cursor: 'pointer', marginBottom: '10px', display: 'block', transition: 'all 0.15s' }}
            >
              + Choose Photo
            </button>
          )}

          {file && (
            <>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Your name (optional)"
                maxLength={60}
                style={{ display: 'block', width: '100%', fontFamily: 'monospace', fontSize: '12px', padding: '7px 10px', border: '1px solid rgba(185,122,48,0.3)', background: 'rgba(255,255,255,0.5)', color: '#1a1208', outline: 'none', marginBottom: '6px', boxSizing: 'border-box' }}
              />
              <input
                type="text"
                value={caption}
                onChange={e => setCaption(e.target.value)}
                placeholder="Caption (optional)"
                maxLength={120}
                style={{ display: 'block', width: '100%', fontFamily: 'monospace', fontSize: '12px', padding: '7px 10px', border: '1px solid rgba(185,122,48,0.3)', background: 'rgba(255,255,255,0.5)', color: '#1a1208', outline: 'none', marginBottom: '10px', boxSizing: 'border-box' }}
              />
              {err && <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b94040', margin: '0 0 8px' }}>{err}</p>}
              <button
                type="submit"
                disabled={busy}
                style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '8px 20px', background: '#1a1208', color: '#f2ebe0', border: 'none', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.7 : 1, transition: 'opacity 0.15s' }}
              >
                {busy ? 'Uploading…' : 'Share Photo →'}
              </button>
            </>
          )}
        </form>
      )}
    </div>
  )
}

// ── Main section ──────────────────────────────────────────────────────────────
export default function EventsSection() {
  const { user, profile } = useAuth()
  const navigate          = useNavigate()

  const [events,    setEvents]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [showForm,  setShowForm]  = useState(false)
  const [form,      setForm]      = useState(EMPTY_FORM)
  const [sent,      setSent]      = useState(false)
  const [busy,      setBusy]      = useState(false)

  useEffect(() => {
    getUpcomingEvents()
      .then(setEvents)
      .finally(() => setLoading(false))
  }, [])

  // Detect today's events for the day-of upload widget
  const today       = new Date().toISOString().split('T')[0]
  const tonightEvents = events.filter(ev => ev.date === today)

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!user) return
    setBusy(true)
    try {
      await submitEventRequest(form, user.uid, profile?.name || user.displayName || user.email)
      setForm(EMPTY_FORM)
      setSent(true)
      setTimeout(() => { setSent(false); setShowForm(false) }, 3500)
    } finally {
      setBusy(false)
    }
  }

  // Upcoming events excluding today (tonight shown separately)
  const upcomingEvents = events.filter(ev => ev.date > today)

  return (
    <section className="border-t border-warm-gray-light">
      <div className="max-w-4xl mx-auto px-6 pt-14 pb-6 flex items-baseline justify-between flex-wrap gap-4">
        <div className="flex items-baseline gap-5">
          <h2 className="font-serif text-[1.4rem] font-normal">Upcoming</h2>
          <span className="eyebrow">Events & happenings</span>
        </div>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <button
            onClick={() => navigate('/events/past')}
            className="font-mono text-[11px] tracking-[0.1em] uppercase text-warm-gray hover:text-ink transition-colors"
          >
            Past events →
          </button>
          <button
            onClick={() => navigate('/events')}
            className="font-mono text-[11px] tracking-[0.1em] uppercase text-warm-gray hover:text-ink transition-colors"
          >
            See all →
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 pb-12">
        {/* ── Tonight's event upload ── */}
        {!loading && tonightEvents.map(ev => (
          <TonightUpload key={ev.id} event={ev} />
        ))}

        {loading ? (
          <p className="font-mono text-[13px] text-warm-gray py-6">Loading…</p>
        ) : upcomingEvents.length === 0 && tonightEvents.length === 0 ? (
          <p className="font-mono text-[13px] text-warm-gray py-6">
            No upcoming events.{' '}
            <button
              onClick={() => navigate('/events/past')}
              className="underline hover:text-ink transition-colors"
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', color: 'inherit' }}
            >
              See past events →
            </button>
          </p>
        ) : (
          <div className="space-y-0 border-t border-warm-gray-light">
            {upcomingEvents.slice(0, 3).map(ev => (
              <div
                key={ev.id}
                className="flex flex-col sm:flex-row sm:items-start gap-3 py-5 border-b border-warm-gray-light cursor-pointer group"
                onClick={() => navigate(`/events/${ev.id}`)}
              >
                <div className="min-w-[110px]">
                  <p className="font-mono text-[12px] text-earth tracking-wide">{fmt(ev.date)}</p>
                  {(ev.startTime || ev.time) && <p className="font-mono text-[11px] text-warm-gray">{ev.startTime || ev.time}</p>}
                </div>
                <div>
                  <p className="font-serif text-[1rem] font-normal text-ink mb-0.5 group-hover:text-earth transition-colors">{ev.title}</p>
                  {ev.location && (
                    <p className="font-mono text-[11px] text-warm-gray tracking-wide uppercase mb-1">{ev.location}</p>
                  )}
                  {ev.description && (
                    <p className="font-mono text-[12px] text-warm-gray leading-relaxed">{ev.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Submit button — account holders only */}
        {!showForm && !sent && (
          user ? (
            <button onClick={() => setShowForm(true)} className="btn-outline mt-8">
              Submit an Event
            </button>
          ) : (
            <button
              onClick={() => navigate('/login', { state: { from: '/events' } })}
              className="btn-ghost mt-8"
            >
              Sign in to submit an event
            </button>
          )
        )}

        {sent && (
          <p className="font-mono text-[13px] text-earth mt-8">
            Submitted — we'll review it and add it to the calendar.
          </p>
        )}

        {showForm && !sent && (
          <form onSubmit={handleSubmit} className="mt-8 space-y-5 border-t border-warm-gray-light pt-8">
            <p className="font-serif text-[1.1rem] font-normal mb-2">Submit an Event</p>
            <p className="font-mono text-[12px] text-warm-gray mb-6">
              Free to submit. We'll review it before adding it to the calendar.
            </p>

            {[
              { name: 'title',    label: 'Event Title', required: true  },
              { name: 'date',     label: 'Date',        required: true,  type: 'date' },
              { name: 'time',     label: 'Time',        required: false, type: 'time' },
              { name: 'location', label: 'Location',    required: false },
            ].map(({ name, label, required, type }) => (
              <div key={name}>
                <label className="eyebrow block mb-1">{label}{required && ' *'}</label>
                <input
                  type={type || 'text'}
                  name={name}
                  value={form[name]}
                  onChange={handleChange}
                  required={required}
                  className="w-full border border-warm-gray-light bg-paper font-mono text-[13px] px-3 py-2 focus:outline-none focus:border-ink"
                />
              </div>
            ))}

            <div>
              <label className="eyebrow block mb-1">Description</label>
              <textarea
                name="description"
                value={form.description}
                onChange={handleChange}
                rows={3}
                className="w-full border border-warm-gray-light bg-paper font-mono text-[13px] px-3 py-2 focus:outline-none focus:border-ink resize-none"
              />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit" disabled={busy} className="btn-outline">
                {busy ? <span className="flex items-center justify-center gap-2"><Spinner />Sending…</span> : 'Send'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }}
                className="font-mono text-[12px] text-warm-gray hover:text-ink transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  )
}
