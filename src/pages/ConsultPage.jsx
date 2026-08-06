import { useState, useEffect, useMemo } from 'react'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'
import { useAuth } from '../context/AuthContext'
import {
  getAvailableDates,
  getSlotsForDate,
  saveBooking,
  MIN_ADVANCE_HOURS,
} from '../data/booking'

// The only two things bookable on the site now. Ids match the existing
// SHOP_HOUR_SERVICE_IDS in data/booking.js so shop-hour rules still apply.
const CONSULTATIONS = [
  {
    id: 'consultation',
    label: 'One-Off Consultation',
    price: 50,
    duration: '1 hour',
    blurb: 'A focused single session — bring one problem, leave with a direction.',
  },
  {
    id: 'creative-consult',
    label: 'Creative Consult',
    price: 120,
    duration: '3 hours',
    blurb: 'A deep working session for a project that needs real time: direction, structure, and a plan you can act on.',
  },
]

const fmtDate = (ds) => {
  const [y, m, d] = ds.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

const fmtTime = (t) => {
  const [h, m] = t.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}

export default function ConsultPage() {
  const { user, profile } = useAuth()

  const [service, setService] = useState(CONSULTATIONS[0].id)
  const [dates,   setDates]   = useState([])
  const [date,    setDate]    = useState('')
  const [slots,   setSlots]   = useState([])
  const [slot,    setSlot]    = useState(null)

  const [loadingDates, setLoadingDates] = useState(true)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [submitting,   setSubmitting]   = useState(false)
  const [error,        setError]        = useState(null)
  const [done,         setDone]         = useState(null)

  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' })

  useEffect(() => {
    document.title = 'Consultations — Art Saturated'
    return () => { document.title = 'Art Saturated' }
  }, [])

  // Prefill from the signed-in profile, but never require an account —
  // an extra sign-up step is the last thing a first booking needs.
  useEffect(() => {
    if (!user) return
    setForm(f => ({
      ...f,
      name:  f.name  || profile?.name || user.displayName || '',
      email: f.email || user.email || '',
      phone: f.phone || profile?.phone || '',
    }))
  }, [user, profile])

  useEffect(() => {
    let cancelled = false
    getAvailableDates(60)
      .then(d => { if (!cancelled) { setDates(d); setLoadingDates(false) } })
      .catch(() => { if (!cancelled) { setError('Could not load availability.'); setLoadingDates(false) } })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!date) { setSlots([]); return }
    let cancelled = false
    setLoadingSlots(true)
    setSlot(null)
    getSlotsForDate(date)
      .then(s => { if (!cancelled) { setSlots(s.filter(x => !x.booked)); setLoadingSlots(false) } })
      .catch(() => { if (!cancelled) { setError('Could not load times.'); setLoadingSlots(false) } })
    return () => { cancelled = true }
  }, [date])

  const chosen = useMemo(
    () => CONSULTATIONS.find(c => c.id === service),
    [service],
  )

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)

    if (!slot)              { setError('Please pick a time.'); return }
    if (!form.name.trim())  { setError('Please enter your name.'); return }
    if (!/^\S+@\S+\.\S+$/.test(form.email)) { setError('Please enter a valid email.'); return }

    setSubmitting(true)
    try {
      await saveBooking({
        slotId:  slot.id,
        date:    slot.date,
        time:    slot.time,
        service: `${chosen.label} (${chosen.duration}) — $${chosen.price}`,
        name:    form.name.trim(),
        email:   form.email.trim(),
        phone:   form.phone.trim(),
        message: form.message.trim(),
      })
      setDone({ date: slot.date, time: slot.time, label: chosen.label })
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Confirmation ───────────────────────────────────────────────────────────
  if (done) {
    return (
      <main className="pt-[60px]" style={{ minHeight: '100vh' }}>
        <div className="max-w-xl mx-auto px-6 py-24 text-center">
          <p className="text-[2.5rem] mb-4" aria-hidden>✓</p>
          <h1 className="font-serif text-[2rem] font-normal mb-3">You're booked.</h1>
          <p className="font-mono text-[13px] text-warm-gray leading-relaxed mb-2">
            {done.label} — {fmtDate(done.date)} at {fmtTime(done.time)}
          </p>
          <p className="font-mono text-[13px] text-warm-gray leading-relaxed mb-10">
            A confirmation is on its way to {form.email}. Payment is handled at the session.
          </p>
          <a href="/shop" className="btn-outline">Browse the Shop</a>
        </div>
        <Footer />
      </main>
    )
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', fontFamily: 'monospace', fontSize: '13px',
    border: '1px solid rgb(var(--color-warm-gray-light))', background: 'transparent',
    color: 'rgb(var(--color-ink))',
  }

  return (
    <main className="pt-[60px]" style={{ minHeight: '100vh' }}>
      <div className="max-w-2xl mx-auto px-6 py-16">

        <p className="eyebrow mb-6">One-on-one</p>
        <h1 className="font-serif text-[clamp(2rem,5vw,2.6rem)] font-normal leading-tight mb-5">
          Book a consultation.
        </h1>
        <p className="font-mono text-[13px] text-warm-gray leading-relaxed mb-12 max-w-lg">
          Sit down with Zion one-on-one — in the shop at 3945 Parnell Ave, or remotely.
          Bookings need at least {MIN_ADVANCE_HOURS} hours' notice.
        </p>

        {/* ── Service ──────────────────────────────────────────────────────── */}
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 40px' }}>
          <legend className="eyebrow mb-4">What kind of session</legend>
          <div className="flex flex-col gap-3">
            {CONSULTATIONS.map(c => {
              const active = c.id === service
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setService(c.id)}
                  aria-pressed={active}
                  style={{
                    textAlign: 'left', padding: '16px 18px', cursor: 'pointer',
                    border: `1px solid ${active ? 'rgb(var(--color-ink))' : 'rgb(var(--color-warm-gray-light))'}`,
                    background: active ? 'rgb(var(--color-offwhite))' : 'transparent',
                    transition: 'all 0.15s',
                  }}
                >
                  <span className="flex items-baseline justify-between gap-4 mb-1">
                    <span className="font-mono text-[13px] text-ink">{c.label}</span>
                    <span className="font-mono text-[13px] text-earth">${c.price}</span>
                  </span>
                  <span className="font-mono text-[11px] text-warm-gray block mb-2">{c.duration}</span>
                  <span className="font-mono text-[12px] text-warm-gray leading-relaxed block">{c.blurb}</span>
                </button>
              )
            })}
          </div>
        </fieldset>

        {/* ── Date ─────────────────────────────────────────────────────────── */}
        <div className="mb-10">
          <p className="eyebrow mb-4">Pick a day</p>
          {loadingDates ? (
            <Spinner size={16} />
          ) : dates.length === 0 ? (
            <p className="font-mono text-[13px] text-warm-gray">
              No availability in the next 60 days. Email{' '}
              <a href="mailto:zionomari@artsaturated.com" className="underline">zionomari@artsaturated.com</a>.
            </p>
          ) : (
            <div className="flex gap-2 flex-wrap">
              {dates.slice(0, 30).map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDate(d)}
                  aria-pressed={d === date}
                  className="font-mono text-[11px] px-3 py-2 border cursor-pointer transition-colors"
                  style={{
                    borderColor: d === date ? 'rgb(var(--color-ink))' : 'rgb(var(--color-warm-gray-light))',
                    background:  d === date ? 'rgb(var(--color-ink))' : 'transparent',
                    color:       d === date ? 'rgb(var(--color-cream))' : 'rgb(var(--color-warm-gray))',
                  }}
                >
                  {fmtDate(d)}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Time ─────────────────────────────────────────────────────────── */}
        {date && (
          <div className="mb-10">
            <p className="eyebrow mb-4">Pick a time</p>
            {loadingSlots ? (
              <Spinner size={16} />
            ) : slots.length === 0 ? (
              <p className="font-mono text-[13px] text-warm-gray">No times left on that day.</p>
            ) : (
              <div className="flex gap-2 flex-wrap">
                {slots.map(s => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSlot(s)}
                    aria-pressed={slot?.id === s.id}
                    className="font-mono text-[11px] px-3 py-2 border cursor-pointer transition-colors"
                    style={{
                      borderColor: slot?.id === s.id ? 'rgb(var(--color-ink))' : 'rgb(var(--color-warm-gray-light))',
                      background:  slot?.id === s.id ? 'rgb(var(--color-ink))' : 'transparent',
                      color:       slot?.id === s.id ? 'rgb(var(--color-cream))' : 'rgb(var(--color-warm-gray))',
                    }}
                  >
                    {fmtTime(s.time)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Details ──────────────────────────────────────────────────────── */}
        {slot && (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 mb-8">
            <p className="eyebrow mb-1">Your details</p>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] text-warm-gray">Name</span>
              <input
                style={inputStyle} value={form.name} required
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] text-warm-gray">Email</span>
              <input
                type="email" style={inputStyle} value={form.email} required
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] text-warm-gray">Phone (optional)</span>
              <input
                type="tel" style={inputStyle} value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] text-warm-gray">
                What do you want to work on? (optional)
              </span>
              <textarea
                rows={4} style={{ ...inputStyle, resize: 'vertical' }} value={form.message}
                onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
              />
            </label>

            <div className="border-t border-warm-gray-light pt-5 mt-2">
              <p className="font-mono text-[12px] text-warm-gray mb-4">
                {chosen.label} · {fmtDate(slot.date)} at {fmtTime(slot.time)} · ${chosen.price}
                <br />Payment is taken at the session, not now.
              </p>
              <button type="submit" className="btn-outline" disabled={submitting}>
                {submitting ? 'Booking…' : 'Confirm Booking'}
              </button>
            </div>
          </form>
        )}

        {error && (
          <p role="alert" className="font-mono text-[12px]" style={{ color: '#b94040' }}>{error}</p>
        )}
      </div>
      <Footer />
    </main>
  )
}
