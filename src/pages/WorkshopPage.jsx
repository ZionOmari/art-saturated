import { useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { checkoutWorkshopDeposit } from '../lib/stripe'
import Footer from '../components/Footer'

const DONATION_LINKS = {
  cashApp: 'https://cash.app/$artsaturated',
  venmo:   'https://venmo.com/zionomari',
  stripe:  null, // PLACEHOLDER — Zion to supply Stripe donation link
}

// Live sessions — "Join Now" points at whichever session is today or next up.
const SESSIONS = [
  { n: 1, label: 'Tuesday, July 1',    date: '2026-07-01', meet: 'https://meet.google.com/aty-fpji-tja' },
  { n: 2, label: 'Wednesday, July 8',  date: '2026-07-08', meet: 'https://meet.google.com/zgy-fcnt-msz' },
  { n: 3, label: 'Wednesday, July 15', date: '2026-07-15', meet: 'https://meet.google.com/vxt-tgrs-ddz' },
]

function nextSession() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const upcoming = SESSIONS.find(s => new Date(s.date + 'T00:00:00') >= today)
  return upcoming || SESSIONS[SESSIONS.length - 1]
}

function DonationSection() {
  return (
    <div className="border border-warm-gray-light p-6 mt-8">
      <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray mb-4">
        Support the Workshop
      </p>
      <p className="font-serif text-ink text-[15px] leading-relaxed mb-6">
        This workshop is donation-based. Your contribution helps sustain future
        sessions and keeps them accessible to everyone.
      </p>
      <div className="flex flex-wrap gap-3">
        <a
          href={DONATION_LINKS.cashApp}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] uppercase tracking-widest border border-ink px-5 py-2 text-ink hover:bg-ink hover:text-cream transition-colors"
        >
          Cash App — $artsaturated
        </a>
        <a
          href={DONATION_LINKS.venmo}
          target="_blank"
          rel="noopener noreferrer"
          className="font-mono text-[11px] uppercase tracking-widest border border-ink px-5 py-2 text-ink hover:bg-ink hover:text-cream transition-colors"
        >
          Venmo — @zionomari
        </a>
        {DONATION_LINKS.stripe && (
          <a
            href={DONATION_LINKS.stripe}
            target="_blank"
            rel="noopener noreferrer"
            className="font-mono text-[11px] uppercase tracking-widest border border-ink px-5 py-2 text-ink hover:bg-ink hover:text-cream transition-colors"
          >
            Donate via Stripe
          </a>
        )}
      </div>
      <p className="font-mono text-[10px] text-warm-gray mt-3">
        Stripe link coming soon.
      </p>
    </div>
  )
}

function RsvpForm() {
  const { user, profile } = useAuth()
  const [form, setForm] = useState({ name: '', email: '' })
  const [honeypot, setHoneypot] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted]  = useState(false)
  const [error, setError]          = useState('')
  const lastSubmitRef = useRef(0)

  useEffect(() => {
    if (user) {
      setForm(f => ({
        ...f,
        name:  f.name || profile?.name || user.displayName || '',
        email: f.email || profile?.email || user.email || '',
      }))
    }
  }, [user, profile])

  function update(field) {
    return e => { setForm(f => ({ ...f, [field]: e.target.value })); setError('') }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (honeypot) return

    const now = Date.now()
    if (now - lastSubmitRef.current < 30_000) {
      setError('Please wait a moment before submitting again.')
      return
    }

    const name  = form.name.trim()
    const email = form.email.trim()

    if (!name)  { setError('Name is required.'); return }
    if (!email) { setError('Email is required.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Please enter a valid email.'); return }

    setSubmitting(true)
    setError('')
    try {
      await addDoc(collection(db, 'workshopRsvps'), {
        name,
        email,
        uid:           user?.uid || null,
        hasAccount:    !!user,
        assignedLevel: null,
        status:        'pending',
        submittedAt:   serverTimestamp(),
      })
      lastSubmitRef.current = Date.now()
      setSubmitted(true)
    } catch (err) {
      console.error('RSVP submit error:', err)
      setError('Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="border border-warm-gray-light p-6">
        <p className="font-serif text-ink text-[1.3rem] mb-3">You're in.</p>
        <p className="font-serif text-ink text-[15px] leading-relaxed">
          Check your email for your Google Meet link and session details.
        </p>
      </div>
    )
  }

  const inputClass = 'w-full border border-warm-gray-light px-4 py-3 font-serif text-[15px] text-ink bg-cream focus:border-ink focus:outline-none transition-colors'

  return (
    <form onSubmit={handleSubmit} className="border border-warm-gray-light p-6">
      <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray mb-6">
        RSVP
      </p>

      <div className="flex flex-col gap-4">
        <div>
          <label className="font-mono text-[10px] uppercase tracking-widest text-warm-gray block mb-1">
            Name
          </label>
          <input
            type="text"
            value={form.name}
            onChange={update('name')}
            maxLength={200}
            className={inputClass}
            placeholder="Your name"
          />
        </div>

        <div>
          <label className="font-mono text-[10px] uppercase tracking-widest text-warm-gray block mb-1">
            Email
          </label>
          <input
            type="email"
            value={form.email}
            onChange={update('email')}
            maxLength={320}
            required
            className={inputClass}
            placeholder="you@email.com"
          />
        </div>

        {/* Honeypot */}
        <div style={{ position: 'absolute', left: '-9999px' }} aria-hidden="true">
          <input
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={e => setHoneypot(e.target.value)}
          />
        </div>

        {error && (
          <p className="font-mono text-[12px] text-red-600">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="font-mono text-[11px] uppercase tracking-widest border border-ink px-6 py-3 text-ink hover:bg-ink hover:text-cream transition-colors disabled:opacity-50"
        >
          {submitting ? 'Submitting...' : 'RSVP'}
        </button>
      </div>
    </form>
  )
}

function OneOnOneSection() {
  const { user } = useAuth()
  const [searchParams] = useSearchParams()
  const depositSuccess = searchParams.get('deposit') === 'success'
  const [form, setForm] = useState({ name: '', email: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const inputClass = 'w-full border border-warm-gray-light px-4 py-3 font-serif text-[15px] text-ink bg-cream focus:border-ink focus:outline-none transition-colors'

  async function handleDeposit(e) {
    e.preventDefault()
    const name  = form.name.trim()
    const email = form.email.trim()
    if (!name)  { setError('Name is required.'); return }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('Valid email is required.'); return }
    if (!user)  { setError('Please sign in to book a 1:1 session.'); return }

    setBusy(true)
    setError('')
    try {
      await checkoutWorkshopDeposit({ customerEmail: email, bookingName: name })
    } catch (err) {
      console.error('Deposit checkout error:', err)
      setError(err.message || 'Something went wrong. Please try again.')
      setBusy(false)
    }
  }

  if (depositSuccess) {
    return (
      <section className="mb-16">
        <div className="border border-earth/40 p-6">
          <p className="font-serif text-ink text-[1.3rem] mb-3">Deposit received.</p>
          <p className="font-serif text-ink text-[15px] leading-relaxed mb-4">
            Your $25 deposit has been received. Zion will confirm your slot within
            24 hours and collect the remaining $25 at that time. Your Google Meet
            link will be sent 10–15 minutes before your session.
          </p>
          <DonationSection />
        </div>
      </section>
    )
  }

  return (
    <section className="mb-16">
      <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray mb-2">
        Alternative
      </p>
      <h2 className="font-serif text-[1.6rem] md:text-[2rem] text-ink mb-4">
        1:1 Deep Consciousness Session
      </h2>
      <p className="font-serif text-ink text-[15px] leading-relaxed mb-6">
        Prefer a private, personalized session? Book a one-on-one session for
        a deeper, tailored experience.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 mb-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray">Price</p>
          <p className="font-serif text-ink text-[15px]">$50 total</p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray">Deposit</p>
          <p className="font-serif text-ink text-[15px]">$25 via Stripe to hold your slot</p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray">Remainder</p>
          <p className="font-serif text-ink text-[15px]">$25 collected upon booking confirmation</p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray">Format</p>
          <p className="font-serif text-ink text-[15px]">Google Meet — link sent 10–15 min before start</p>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray">Confirmation</p>
          <p className="font-serif text-ink text-[15px]">Slot confirmed within 24 hours</p>
        </div>
      </div>

      {user ? (
        <form onSubmit={handleDeposit} className="border border-warm-gray-light p-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray mb-4">
            Pay $25 Deposit to Hold Your Slot
          </p>
          <div className="flex flex-col gap-4">
            <input
              type="text"
              value={form.name}
              onChange={e => { setForm(f => ({ ...f, name: e.target.value })); setError('') }}
              maxLength={200}
              className={inputClass}
              placeholder="Your name"
            />
            <input
              type="email"
              value={form.email}
              onChange={e => { setForm(f => ({ ...f, email: e.target.value })); setError('') }}
              maxLength={320}
              required
              className={inputClass}
              placeholder="you@email.com"
            />
            {error && <p className="font-mono text-[12px] text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy}
              className="font-mono text-[11px] uppercase tracking-widest border border-ink px-6 py-3 text-ink hover:bg-ink hover:text-cream transition-colors disabled:opacity-50"
            >
              {busy ? 'Processing...' : 'Pay $25 Deposit →'}
            </button>
          </div>
        </form>
      ) : (
        <div className="border border-warm-gray-light p-6">
          <p className="font-serif text-ink text-[15px] mb-3">
            Sign in to book a 1:1 session and pay the $25 deposit.
          </p>
          <a
            href="/login?from=/workshop"
            className="inline-block font-mono text-[11px] uppercase tracking-widest border border-ink px-6 py-3 text-ink hover:bg-ink hover:text-cream transition-colors"
          >
            Sign In →
          </a>
        </div>
      )}

      <div className="mt-6">
        <DonationSection />
      </div>
    </section>
  )
}

export default function WorkshopPage() {
  useEffect(() => {
    document.title = 'Exploring Deep States of Consciousness — Art Saturated'
    return () => { document.title = 'Art Saturated' }
  }, [])

  const session = nextSession()

  return (
    <main className="pt-[60px] min-h-screen">
      <div className="bg-cream/95 max-w-[720px] mx-auto px-6 md:px-12 py-2">
      {/* Header */}
      <section className="mt-12 mb-10">
        <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray mb-2">
          Live Workshop Series
        </p>
        <h1 className="font-serif text-[2.2rem] md:text-[3rem] text-ink leading-tight mb-4">
          Exploring Deep States<br />of Consciousness
        </h1>
        <p className="font-serif text-ink text-[15px] leading-relaxed max-w-[560px] mb-6">
          A three-week live workshop exploring the layers of human experience and
          consciousness. Each level builds on the last — guided sessions with
          space for questions, reflection, and connection.
        </p>
        <a
          href={session.meet}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block font-mono text-[11px] uppercase tracking-widest bg-ink text-cream px-6 py-3 hover:bg-earth transition-colors"
        >
          Join Now — Session {session.n} →
        </a>
        <p className="font-mono text-[10px] text-warm-gray mt-3">
          Opens the live Google Meet ({session.label}, 4:30 PM ET).{' '}
          <a href="#rsvp" className="text-earth underline hover:text-ink">First time? RSVP here</a>
        </p>
      </section>

      {/* Details */}
      <section className="border-t border-warm-gray-light pt-8 mb-10">
        <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray mb-4">
          Workshop Details
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-4 mb-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray">Format</p>
            <p className="font-serif text-ink text-[15px]">Live over Google Meet</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray">Structure</p>
            <p className="font-serif text-ink text-[15px]">3 Levels — one per week, 3 consecutive weeks</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray">Schedule</p>
            <p className="font-serif text-ink text-[15px]">4:30 PM ET — Tuesdays {'&'} Wednesdays</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray">Length</p>
            <p className="font-serif text-ink text-[15px]">1 hour — 15-min Q{'&'}A within or after the session</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray">Pricing</p>
            <p className="font-serif text-ink text-[15px]">Donation-based — pay what feels right</p>
          </div>
        </div>

        <div className="border border-dashed border-earth/40 p-4 mb-6">
          <p className="font-mono text-[10px] uppercase tracking-widest text-earth mb-2">
            Levels
          </p>
          <div className="flex flex-col gap-2">
            <p className="font-serif text-ink text-[15px]">
              <span className="font-mono text-[11px] text-earth mr-2">Level 1</span>
              Tuesday, July 1 — 4:30 PM ET
            </p>
            <p className="font-serif text-ink text-[15px]">
              <span className="font-mono text-[11px] text-earth mr-2">Level 2</span>
              Wednesday, July 8 — 4:30 PM ET
            </p>
            <p className="font-serif text-ink text-[15px]">
              <span className="font-mono text-[11px] text-earth mr-2">Level 3</span>
              Wednesday, July 15 — 4:30 PM ET
            </p>
          </div>
        </div>
      </section>

      {/* RSVP Form */}
      <section id="rsvp" className="mb-12 scroll-mt-20">
        <p className="font-mono text-[10px] uppercase tracking-widest text-warm-gray mb-4">
          Join
        </p>
        <p className="font-serif text-ink text-[15px] leading-relaxed mb-6">
          Drop your name and email to RSVP. You'll get a confirmation with
          your Google Meet link.
        </p>
        <RsvpForm />
      </section>

      {/* Donation */}
      <section className="mb-16">
        <DonationSection />
      </section>

      {/* Divider */}
      <div className="border-t border-warm-gray-light my-12" />

      {/* 1:1 Session */}
      <OneOnOneSection />

      <Footer />
      </div>
    </main>
  )
}
