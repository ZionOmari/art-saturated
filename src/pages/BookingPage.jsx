import { useState, useEffect } from 'react'
import Footer from '../components/Footer'
import { SERVICES, DURATION, getAvailableDates, getSlotsForDate, saveBooking, SHOP_HOUR_SERVICE_IDS, MIN_ADVANCE_HOURS, loadTeachingRates, DEFAULT_TEACHING_RATES, saveMonthlyStudent } from '../data/booking'
import Spinner from '../components/Spinner'

function fmt(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  })
}

function fmtTime(t) {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hr   = h % 12 || 12
  return `${hr}:${m.toString().padStart(2, '0')} ${ampm}`
}

function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate() }
function startDayOfMonth(year, month) { return new Date(year, month, 1).getDay() }

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']

export default function BookingPage() {
  useEffect(() => { document.title = 'Book a Session — Art Saturated'; return () => { document.title = 'Art Saturated' } }, [])
  const today = new Date()
  const [rates, setRates] = useState(DEFAULT_TEACHING_RATES)
  const [mode, setMode]   = useState('single') // 'single' | 'monthly'
  const [year, setYear]   = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())
  const [availableDates, setAvailableDates] = useState([])
  const [slots, setSlots]                   = useState([])
  const [loading, setLoading]               = useState(true)
  const [selectedDate, setSelectedDate]     = useState(null)
  const [selectedSlot, setSelectedSlot]     = useState(null)
  const [selectedService, setSelectedService] = useState(null)
  const [selectedPlan, setSelectedPlan]     = useState(null)
  const [form, setForm]   = useState({ name: '', email: '', phone: '', message: '' })
  const [step, setStep]   = useState('calendar')
  const [busy, setBusy]   = useState(false)

  const totalDays = daysInMonth(year, month)
  const startDay  = startDayOfMonth(year, month)

  useEffect(() => {
    loadTeachingRates().then(setRates).catch(() => {})
    getAvailableDates()
      .then(d => { setAvailableDates(d) })
      .catch(err => { console.error('getAvailableDates:', err) })
      .finally(() => setLoading(false))
  }, [])

  const PRICE = rates.singleLesson

  const MONTHLY_PLANS = [
    { id: 'monthly_1x', label: '1 Lesson / Week', price: rates.monthly1x, desc: '4 sessions per month' },
    { id: 'monthly_2x', label: '2 Lessons / Week', price: rates.monthly2x, desc: '8 sessions per month' },
  ]

  // Grandfather period — show notice if a rate change is still within the locked window
  const grandfatherUntil = rates.grandfatherUntil?.toDate?.() ?? null
  const inGrandfatherPeriod = grandfatherUntil && grandfatherUntil > new Date()
  const grandfatherStr = grandfatherUntil
    ? grandfatherUntil.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : null

  useEffect(() => {
    if (!selectedDate) return
    getSlotsForDate(selectedDate).then(setSlots).catch(() => {})
  }, [selectedDate])

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  function dateStr(day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  function handleDayClick(day) {
    const ds = dateStr(day)
    if (!availableDates.includes(ds)) return
    setSelectedDate(ds)
    setSelectedSlot(null)
    setSelectedService(null)
    setStep('slots')
  }

  function handleSlotPick(slot) {
    setSelectedSlot(slot)
    setStep('service')
  }

  function handleServicePick(svc) {
    setSelectedService(svc)
    setStep('form')
  }

  async function handlePlanSubmit(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await saveMonthlyStudent({
        name: form.name, email: form.email, phone: form.phone,
        plan: selectedPlan.id, planLabel: selectedPlan.label,
        price: selectedPlan.price, notes: form.message,
      }).catch(() => {})

      setStep('done')
    } catch (err) {
      console.error(err)
      alert('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await saveBooking({
        slotId:  selectedSlot.id,
        date:    selectedSlot.date,
        time:    selectedSlot.time,
        service: selectedService.id,
        name:    form.name,
        email:   form.email,
        phone:   form.phone,
        message: form.message,
      })

      setStep('done')
    } catch (err) {
      console.error(err)
      alert('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setSelectedDate(null); setSelectedSlot(null)
    setSelectedService(null)
    setForm({ name: '', email: '', phone: '', message: '' })
    setStep('calendar')
    getAvailableDates().then(setAvailableDates).catch(() => {})
  }

  return (
    <main className="pt-[60px]">
      <section className="max-w-2xl mx-auto px-6 pt-12 pb-24">

        <div className="mb-10">
          <h1 className="font-serif text-[2rem] font-normal mb-3">Book a Session</h1>

          {/* ── Mode toggle ───────────────────────────────────────────────── */}
          <div className="flex gap-2 mb-5">
            {[
              { id: 'single',  label: 'Single Session' },
              { id: 'monthly', label: 'Monthly Plan' },
            ].map(opt => (
              <button
                key={opt.id}
                onClick={() => { setMode(opt.id); setStep('calendar'); setSelectedPlan(null); setForm({ name: '', email: '', phone: '', message: '' }) }}
                className={`font-mono text-[11px] tracking-[0.1em] uppercase py-2 px-4 border transition-all duration-150
                  ${mode === opt.id
                    ? 'bg-ink text-offwhite border-ink'
                    : 'border-warm-gray-light text-warm-gray bg-transparent hover:border-ink hover:text-ink'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {inGrandfatherPeriod && (
            <p className="font-mono text-[11px] mb-3" style={{ background: 'rgba(180,120,0,0.12)', color: '#8a6000', border: '1px solid rgba(180,120,0,0.3)', padding: '8px 14px', borderRadius: '4px' }}>
              Current students: your existing rate is locked in until {grandfatherStr}.
            </p>
          )}

          {mode === 'single' && (
            <>
              <p className="font-mono text-[13px] leading-relaxed" style={{ background: 'rgba(36,20,8,0.78)', color: '#ece6d9', padding: '10px 14px', display: 'inline-block', borderRadius: '6px' }}>
                Creative Consult (3 hr · $120) · One-Off Consultation ($50) · Private Dance Lesson ($50/hr).
                Select an available date to get started.
              </p>
              <p className="font-mono text-[11px] mt-2" style={{ background: 'rgba(36,20,8,0.78)', color: '#d4b870', padding: '6px 14px', display: 'inline-block', borderRadius: '6px' }}>
                All sessions require {MIN_ADVANCE_HOURS}-hour advance booking. Slots are confirmed by Zion after request.
              </p>
            </>
          )}

          {mode === 'monthly' && (
            <p className="font-mono text-[13px] leading-relaxed" style={{ background: 'rgba(36,20,8,0.78)', color: '#ece6d9', padding: '10px 14px', display: 'inline-block', borderRadius: '6px' }}>
              Piano · Beat Making · Dance · Creative Consultation.
              Pick a plan and Zion will reach out within 24 hours to schedule.
            </p>
          )}
        </div>

        {/* ── MONTHLY PLAN FLOW ─────────────────────────────────────────────── */}
        {mode === 'monthly' && step !== 'done' && (
          <div className="flex flex-col gap-6">
            {/* Plan cards */}
            <div className="flex flex-col gap-3">
              {MONTHLY_PLANS.map(plan => (
                <button
                  key={plan.id}
                  onClick={() => { setSelectedPlan(plan); setStep('form') }}
                  className={`border px-5 py-4 text-left transition-colors
                    ${selectedPlan?.id === plan.id ? 'border-ink' : 'border-warm-gray-light hover:border-ink'}`}
                >
                  <div className="flex items-baseline justify-between">
                    <span className="font-serif text-[1.1rem]">{plan.label}</span>
                    <span className="font-mono text-[1rem] text-ink">${plan.price}<span className="text-[11px] text-warm-gray">/mo</span></span>
                  </div>
                  <span className="font-mono text-[11px] text-warm-gray mt-1 block">{plan.desc}</span>
                </button>
              ))}
            </div>

            {/* Plan form */}
            {selectedPlan && step === 'form' && (
              <form onSubmit={handlePlanSubmit} className="flex flex-col gap-4 border-t border-warm-gray-light pt-6">
                <div>
                  <p className="font-mono text-[12px] text-warm-gray">
                    Selected: <span className="text-ink">{selectedPlan.label} — ${selectedPlan.price}/mo</span>
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="eyebrow">Name</label>
                  <input type="text" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                    className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                    placeholder="Your name" autoComplete="name" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="eyebrow">Email</label>
                  <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                    className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                    placeholder="your@email.com" autoComplete="email" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="eyebrow">Phone (optional)</label>
                  <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                    className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                    placeholder="(555) 000-0000" autoComplete="tel" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="eyebrow">Anything you want me to know</label>
                  <textarea rows={3} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })}
                    className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink resize-none"
                    placeholder="Goals, experience level, questions..." />
                </div>
                <button type="submit" disabled={busy} className="btn-outline w-full text-center mt-2">
                  {busy ? <span className="flex items-center justify-center gap-2"><Spinner />Sending…</span> : 'Request Monthly Plan'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Monthly done state */}
        {mode === 'monthly' && step === 'done' && (
          <div className="border border-warm-gray-light p-8 text-center flex flex-col gap-4">
            <p className="font-serif text-[1.4rem]">Request received.</p>
            <p className="font-mono text-[12px] text-warm-gray leading-relaxed">
              {selectedPlan.label} — ${selectedPlan.price}/month<br />
              {selectedPlan.desc}
            </p>
            <p className="font-mono text-[11px] text-warm-gray">
              Zion will reach out to {form.email} within 24 hours to set up your schedule.
            </p>
            <button onClick={() => { setMode('monthly'); setStep('calendar'); setSelectedPlan(null); setForm({ name: '', email: '', phone: '', message: '' }) }} className="btn-outline mt-2">
              Back to Booking
            </button>
          </div>
        )}

        {/* ── CALENDAR ──────────────────────────────────────────────────────── */}
        {mode === 'single' && step === 'calendar' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <button onClick={prevMonth} className="font-mono text-[12px] text-warm-gray uppercase tracking-widest px-2 py-1">← Prev</button>
              <span className="font-serif text-[1.1rem]">{MONTH_NAMES[month]} {year}</span>
              <button onClick={nextMonth} className="font-mono text-[12px] text-warm-gray uppercase tracking-widest px-2 py-1">Next →</button>
            </div>

            <div className="grid grid-cols-7 mb-1">
              {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                <div key={d} className="text-center font-mono text-[10px] text-warm-gray uppercase tracking-widest py-1">{d}</div>
              ))}
            </div>

            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: startDay }).map((_, i) => <div key={`blank-${i}`} />)}
              {Array.from({ length: totalDays }, (_, i) => i + 1).map(day => {
                const ds      = dateStr(day)
                const isAvail = availableDates.includes(ds)
                const isPast  = new Date(ds) < new Date(today.toDateString())
                return (
                  <button
                    key={day}
                    onClick={() => handleDayClick(day)}
                    disabled={!isAvail || isPast}
                    className={`aspect-square flex items-center justify-center font-mono text-[13px] transition-colors
                      ${isAvail && !isPast
                        ? 'bg-ink text-cream hover:opacity-80 cursor-pointer'
                        : 'text-warm-gray/40 cursor-default'}`}
                  >
                    {day}
                  </button>
                )
              })}
            </div>

            {loading && <p className="font-mono text-[12px] text-warm-gray text-center mt-8">Loading availability...</p>}
            {!loading && availableDates.length === 0 && (
              <p className="font-mono text-[12px] text-warm-gray text-center mt-8">
                No availability posted yet — check back soon.
              </p>
            )}
          </div>
        )}

        {/* ── SLOTS ─────────────────────────────────────────────────────────── */}
        {mode === 'single' && step === 'slots' && (
          <div className="flex flex-col gap-4">
            <button onClick={reset} className="font-mono text-[11px] text-warm-gray uppercase tracking-widest self-start">← Back</button>
            <h2 className="font-serif text-[1.2rem]">{fmt(selectedDate)}</h2>
            <p className="font-mono text-[12px] text-warm-gray">Pick a time slot</p>
            <div className="flex flex-col gap-2">
              {slots.filter(s => !s.booked).map(slot => (
                <button
                  key={slot.id}
                  onClick={() => handleSlotPick(slot)}
                  className="border border-warm-gray-light px-4 py-3 font-mono text-left transition-colors hover:border-ink flex items-center justify-between"
                >
                  <span className="text-[14px] text-ink">{fmtTime(slot.time)} — {DURATION}</span>
                  {slot.shopHour && (
                    <span className="font-mono text-[9px] uppercase tracking-widest text-earth border border-earth px-2 py-0.5">
                      Consult · Beat Making only
                    </span>
                  )}
                </button>
              ))}
              {slots.filter(s => !s.booked).length === 0 && (
                <p className="font-mono text-[12px] text-warm-gray">No slots available for this day.</p>
              )}
            </div>
          </div>
        )}

        {/* ── SERVICE ───────────────────────────────────────────────────────── */}
        {mode === 'single' && step === 'service' && (
          <div className="flex flex-col gap-4">
            <button onClick={() => setStep('slots')} className="font-mono text-[11px] text-warm-gray uppercase tracking-widest self-start">← Back</button>
            <h2 className="font-serif text-[1.2rem]">{fmt(selectedDate)} · {fmtTime(selectedSlot.time)}</h2>
            <p className="font-mono text-[12px] text-warm-gray">What type of session?</p>
            {selectedSlot.shopHour && (
              <p className="font-mono text-[11px] text-earth">
                This time falls during store hours — consultations only.
              </p>
            )}
            <div className="flex flex-col gap-2">
              {SERVICES
                .filter(svc => !selectedSlot.shopHour || SHOP_HOUR_SERVICE_IDS.includes(svc.id))
                .map(svc => (
                  <button
                    key={svc.id}
                    onClick={() => handleServicePick(svc)}
                    className="border border-warm-gray-light px-4 py-3 font-mono text-[14px] text-ink hover:border-ink text-left transition-colors"
                  >
                    {svc.label}
                    <span className="text-warm-gray ml-2 text-[12px]">· {svc.duration} · ${svc.price}</span>
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* ── FORM ──────────────────────────────────────────────────────────── */}
        {mode === 'single' && step === 'form' && (
          <div className="flex flex-col gap-5">
            <button onClick={() => setStep('service')} className="font-mono text-[11px] text-warm-gray uppercase tracking-widest self-start">← Back</button>
            <div>
              <h2 className="font-serif text-[1.2rem]">{selectedService.label}</h2>
              <p className="font-mono text-[12px] text-warm-gray mt-1">
                {fmt(selectedDate)} · {fmtTime(selectedSlot.time)} · {selectedService.duration} · ${selectedService.price}
              </p>
            </div>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <label className="eyebrow">Name</label>
                <input type="text" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                  placeholder="Your name" autoComplete="name" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="eyebrow">Email</label>
                <input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                  className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                  placeholder="your@email.com" autoComplete="email" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="eyebrow">Phone (optional)</label>
                <input type="tel" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })}
                  className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink"
                  placeholder="(555) 000-0000" autoComplete="tel" />
              </div>
              <div className="flex flex-col gap-1">
                <label className="eyebrow">Anything you want me to know</label>
                <textarea rows={3} value={form.message} onChange={e => setForm({ ...form, message: e.target.value })}
                  className="border border-warm-gray-light bg-transparent px-4 py-3 font-mono text-[14px] text-ink focus:outline-none focus:border-ink resize-none"
                  placeholder="Goals, experience level, questions..." />
              </div>
              <button type="submit" disabled={busy} className="btn-outline w-full text-center mt-2">
                {busy ? <span className="flex items-center justify-center gap-2"><Spinner />Confirming…</span> : 'Confirm Booking'}
              </button>
            </form>
          </div>
        )}

        {/* ── DONE ──────────────────────────────────────────────────────────── */}
        {mode === 'single' && step === 'done' && (
          <div className="border border-warm-gray-light p-8 text-center flex flex-col gap-4">
            <p className="font-serif text-[1.4rem]">You're booked.</p>
            <p className="font-mono text-[12px] text-warm-gray leading-relaxed">
              {selectedService.label}<br />
              {fmt(selectedDate)} · {fmtTime(selectedSlot.time)}<br />
              ${selectedService.price} due at session
            </p>
            <p className="font-mono text-[11px] text-warm-gray">A confirmation has been sent to {form.email}</p>
            <button onClick={reset} className="btn-outline mt-2">Book Another</button>
          </div>
        )}

      </section>
      <Footer />
    </main>
  )
}
