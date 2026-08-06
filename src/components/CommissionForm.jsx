import { useState, useRef, useEffect } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { addTask } from '../data/tasks'
import { calcRealisticCompletion } from '../data/scheduleUtils'
import Spinner from './Spinner'

// ── Pricing constants ─────────────────────────────────────────────────────────
const HOURLY_MIN = 30
const HOURLY_MAX = 45
const CUSTOM_CUT_FEE = 10

// Hours per square inch relative to pen (1.0 = same as pen)
const MEDIUM_SPEED = {
  'Pen':            1.0,
  'Colored Pencil': 0.80,
  'Oil Pastel':     0.60,
  'Crayon':         0.40,
  "Artist's Choice": 0.70, // middle estimate
}

// Power-law pricing: cost = K * sqIn^POWER * speed * hourly_rate
// Calibrated: ACEO crayon ≈ $22–32, 19×24 crayon ≈ $680–1020
const K     = 0.27
const POWER = 0.873

// Framing add-on cost by size label
const FRAME_COST = {
  'ACEO / Trading Card': { min: 15,  max: 25  },
  '5×7':                 { min: 20,  max: 35  },
  '8×10':                { min: 30,  max: 50  },
  '11×14':               { min: 45,  max: 70  },
  '16×20':               { min: 65,  max: 95  },
  '19×24':               { min: 80,  max: 120 },
  'Custom':              { min: 50,  max: 100 },
}

const STANDARD_SIZES = [
  { label: 'ACEO / Trading Card', w: 3.5,  h: 2.5  },
  { label: '5×7',                 w: 5,    h: 7    },
  { label: '8×10',                w: 8,    h: 10   },
  { label: '11×14',               w: 11,   h: 14   },
  { label: '16×20',               w: 16,   h: 20   },
  { label: '19×24',               w: 19,   h: 24   },
  { label: 'Custom',              w: null, h: null  },
]

const MEDIUMS = ['Pen', 'Colored Pencil', 'Oil Pastel', 'Crayon', "Artist's Choice"]

// Abstraction labels along the spectrum
const ABSTRACTION_LABELS = [
  'Realistic',
  'Stylized',
  'Semi-Abstract',
  'Abstract',
  'Pure Expression',
]

function getAbstractionLabel(val) {
  const idx = Math.round((val / 100) * (ABSTRACTION_LABELS.length - 1))
  return ABSTRACTION_LABELS[idx]
}

function calcEstimate(sqIn, medium) {
  const speed   = MEDIUM_SPEED[medium] || 1
  const base    = K * Math.pow(sqIn, POWER) * speed
  const costMin = Math.max(10, Math.round(base * HOURLY_MIN))
  const costMax = Math.max(15, Math.round(base * HOURLY_MAX))
  const hMin    = Math.max(1, Math.round(costMin / HOURLY_MAX))
  const hMax    = Math.max(1, Math.ceil(costMax / HOURLY_MIN))
  return { hMin, hMax, costMin, costMax }
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Step({ number, label, active, done }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: active || done ? 1 : 0.35 }}>
      <div style={{
        width: '24px', height: '24px', borderRadius: '50%', border: '1px solid',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: 'monospace', fontSize: '10px',
        background: done ? '#1a1208' : active ? 'transparent' : 'transparent',
        borderColor: done || active ? '#1a1208' : '#c8bfb0',
        color: done ? '#f2ebe0' : '#1a1208',
        flexShrink: 0,
      }}>
        {done ? '✓' : number}
      </div>
      <span style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', color: '#1a1208' }}>
        {label}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function CommissionForm({ onClose }) {
  const { user, profile } = useAuth()
  const fileRef = useRef()

  const [step, setStep] = useState(1) // 1-4
  const [imageFile,    setImageFile]    = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [abstraction,  setAbstraction]  = useState(50)
  const [medium,       setMedium]       = useState('')
  const [selectedSize, setSelectedSize] = useState(null)
  const [customW,      setCustomW]      = useState('')
  const [customH,      setCustomH]      = useState('')
  const [notes,        setNotes]        = useState('')
  const [contactEmail, setContactEmail] = useState(user?.email || '')
  const [contactName,  setContactName]  = useState(profile?.name || user?.displayName || '')
  const [framed,       setFramed]       = useState(null) // null = not chosen, true/false
  const [busy,         setBusy]         = useState(false)
  const [submitted,    setSubmitted]    = useState(false)
  const [error,        setError]        = useState('')
  const [completion,   setCompletion]   = useState(null)
  const [compLoading,  setCompLoading]  = useState(false)

  const isCustom = selectedSize?.label === 'Custom'
  const sqIn = isCustom
    ? (parseFloat(customW) || 0) * (parseFloat(customH) || 0)
    : selectedSize ? selectedSize.w * selectedSize.h : 0

  const estimate   = sqIn && medium ? calcEstimate(sqIn, medium) : null

  // Recalculate realistic completion whenever hours change
  useEffect(() => {
    if (!estimate) { setCompletion(null); return }
    setCompLoading(true)
    calcRealisticCompletion(estimate.hMin, estimate.hMax)
      .then(r => { setCompletion(r); setCompLoading(false) })
      .catch(() => setCompLoading(false))
  }, [estimate?.hMin, estimate?.hMax])
  const cutFee     = isCustom ? CUSTOM_CUT_FEE : 0
  const frameFees  = framed && selectedSize ? (FRAME_COST[selectedSize.label] || FRAME_COST['Custom']) : { min: 0, max: 0 }
  const totalMin   = estimate ? estimate.costMin + cutFee + frameFees.min : 0
  const totalMax   = estimate ? estimate.costMax + cutFee + frameFees.max : 0
  const depositMin = estimate ? Math.round(totalMin * 0.5) : 0
  const depositMax = estimate ? Math.round(totalMax * 0.5) : 0

  function handleImage(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageFile(file)
    setImagePreview(URL.createObjectURL(file))
  }

  function canAdvance() {
    if (step === 1) return imageFile !== null
    if (step === 2) return medium !== ''
    if (step === 3) return selectedSize !== null && (!isCustom || (customW && customH)) && framed !== null
    if (step === 4) return contactEmail !== '' && contactName !== ''
    return false
  }

  async function handleSubmit() {
    if (!canAdvance()) return
    setBusy(true); setError('')
    try {
      let imageURL = null
      if (imageFile) {
        const imgRef = ref(storage, `commissions/${Date.now()}_${imageFile.name}`)
        const snap   = await uploadBytes(imgRef, imageFile)
        imageURL     = await getDownloadURL(snap.ref)
      }

      const commRef = await addDoc(collection(db, 'commissions'), {
        uid:          user?.uid || null,
        contactName,
        contactEmail,
        imageURL,
        abstraction,
        abstractionLabel: getAbstractionLabel(abstraction),
        medium,
        size:         isCustom ? `${customW}×${customH} in (custom)` : selectedSize.label,
        sqIn,
        estimatedHrsMin: estimate?.hMin,
        estimatedHrsMax: estimate?.hMax,
        estimatedCostMin: estimate?.costMin,
        estimatedCostMax: estimate?.costMax,
        cutFee,
        framed,
        frameFeeMin: frameFees.min,
        frameFeeMax: frameFees.max,
        totalCostMin: totalMin,
        totalCostMax: totalMax,
        depositMin,
        depositMax,
        notes,
        status:       'pending',
        submittedAt:  serverTimestamp(),
      })

      // Auto-create commission deadline on the calendar using schedule-aware date
      const deadlineDate = completion?.realisticDate || null
      if (deadlineDate) {
        await addTask({
          date:    deadlineDate,
          title:   `Commission due — ${contactName} (${medium}, ${isCustom ? `${customW}×${customH}in` : selectedSize?.label})`,
          type:    'commission',
          notes:   `Est. $${totalMin}–$${totalMax}. ${estimate?.hMin}–${estimate?.hMax} hrs. Request ID: ${commRef.id.slice(-6)}`,
          orderId: commRef.id,
        })
      }

      setSubmitted(true)
    } catch (err) {
      console.error(err)
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const inp = {
    fontFamily: 'monospace', fontSize: '13px', padding: '10px 14px',
    border: '1px solid #d4c9bb', background: 'rgba(250,248,244,0.8)',
    color: '#1a1208', outline: 'none', width: '100%', boxSizing: 'border-box',
  }

  const pillBtn = (active) => ({
    fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.05em',
    padding: '8px 16px', border: '1px solid', cursor: 'pointer', transition: 'all 0.15s',
    background: active ? '#1a1208' : 'transparent',
    color:      active ? '#f5f0e8' : '#8a5c3a',
    borderColor: active ? '#1a1208' : '#c8bfb0',
  })

  if (submitted) {
    return (
      <div style={{ textAlign: 'center', padding: '40px 20px' }}>
        <p style={{ fontFamily: 'serif', fontSize: '2rem', marginBottom: '12px', color: '#1a1208' }}>
          Commission request received.
        </p>
        <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#8a5c3a', marginBottom: '8px', lineHeight: 1.7 }}>
          Estimated cost: <strong style={{ color: '#1a1208' }}>${totalMin}–${totalMax}</strong>
          {' '}
          {[isCustom && `custom cut fee`, framed && `frame`].filter(Boolean).length > 0 &&
            `(includes ${[isCustom && `$${CUSTOM_CUT_FEE} cut fee`, framed && `framing`].filter(Boolean).join(' + ')})`}
        </p>
        <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#8a5c3a', marginBottom: '8px', lineHeight: 1.7 }}>
          Drawing time: <strong style={{ color: '#1a1208' }}>{estimate?.hMin}–{estimate?.hMax} hours</strong>
        </p>
        {completion && (
          <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#8a5c3a', marginBottom: '8px', lineHeight: 1.7 }}>
            Estimated ready by: <strong style={{ color: '#1a1208' }}>{completion.realisticLabel}</strong>
            {' '}(~{completion.hoursPerWeek} studio hrs/week)
          </p>
        )}
        <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#8a5c3a', marginBottom: '32px', lineHeight: 1.7 }}>
          50% deposit due at booking: <strong style={{ color: '#1a1208' }}>${depositMin}–${depositMax}</strong>
        </p>
        <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#b97a30', marginBottom: '32px' }}>
          You'll receive a confirmation and invoice at {contactEmail} once your slot is scheduled.
        </p>
        <button onClick={onClose} style={{ ...pillBtn(true), padding: '12px 32px', fontSize: '12px' }}>
          Back to Art
        </button>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '540px', margin: '0 auto', padding: '24px 20px' }}>

      {/* Header */}
      <div style={{ marginBottom: '28px' }}>
        <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8a5c3a', marginBottom: '6px' }}>
          Original Commission
        </p>
        <h2 style={{ fontFamily: 'serif', fontSize: '1.8rem', fontWeight: 'normal', color: '#1a1208', margin: '0 0 20px' }}>
          Request a Piece
        </h2>

        {/* Step indicators */}
        <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
          <Step number="1" label="Reference" active={step === 1} done={step > 1} />
          <Step number="2" label="Style"     active={step === 2} done={step > 2} />
          <Step number="3" label="Size"      active={step === 3} done={step > 3} />
          <Step number="4" label="Submit"    active={step === 4} done={submitted} />
        </div>
      </div>

      {/* ── Step 1: Image + Abstraction ── */}
      {step === 1 && (
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', marginBottom: '16px', lineHeight: 1.7 }}>
            Upload a reference image — a photo, sketch, mood board, anything that captures what you're going for.
          </p>

          {/* Image upload */}
          <label style={{
            display: 'block', width: '100%', aspectRatio: '4/3',
            border: '1px dashed #c8bfb0', background: 'rgba(250,248,244,0.5)',
            cursor: 'pointer', marginBottom: '24px', overflow: 'hidden',
          }}>
            {imagePreview
              ? <img src={imagePreview} alt="reference" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '8px' }}>
                  <span style={{ fontSize: '2rem' }}>＋</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Upload reference image</span>
                </div>
            }
            <input ref={fileRef} type="file" accept="image/*" onChange={handleImage} style={{ display: 'none' }} />
          </label>

          {/* Abstraction spectrum */}
          <div style={{ marginBottom: '28px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a5c3a' }}>Literal</span>
              <span style={{ fontFamily: 'serif', fontSize: '1rem', color: '#1a1208' }}>{getAbstractionLabel(abstraction)}</span>
              <span style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a5c3a' }}>Abstract</span>
            </div>
            <input
              type="range" min="0" max="100" value={abstraction}
              onChange={e => setAbstraction(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#1a1208', cursor: 'pointer' }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
              {ABSTRACTION_LABELS.map((l, i) => (
                <div key={l} style={{
                  width: '2px', height: '6px',
                  background: Math.round((abstraction / 100) * (ABSTRACTION_LABELS.length - 1)) === i ? '#1a1208' : '#c8bfb0',
                }} />
              ))}
            </div>
            <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', marginTop: '10px', lineHeight: 1.6 }}>
              {abstraction < 20 && "True to life — I'll stay close to your reference with my own artistic touch."}
              {abstraction >= 20 && abstraction < 40 && "Grounded in reality with clear artistic interpretation."}
              {abstraction >= 40 && abstraction < 60 && "Balanced — recognizable but with my personal touch."}
              {abstraction >= 60 && abstraction < 80 && "Heavily stylized — the feeling matters more than the form."}
              {abstraction >= 80 && "Pure expression — your reference is a starting point only."}
            </p>
          </div>
        </div>
      )}

      {/* ── Step 2: Medium ── */}
      {step === 2 && (
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', marginBottom: '20px', lineHeight: 1.7 }}>
            Choose your medium. Each one has a different feel — pen is sharp and deliberate, crayon is bold and fast.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '24px' }}>
            {MEDIUMS.map(m => (
              <button key={m} onClick={() => setMedium(m)} style={{
                ...pillBtn(medium === m),
                padding: '14px 20px', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
                <span style={{ fontSize: '13px', letterSpacing: '0.05em' }}>{m}</span>
                <span style={{ fontSize: '10px', opacity: 0.6 }}>
                  {m === 'Pen' && 'Most detailed · slowest'}
                  {m === 'Colored Pencil' && 'Rich color · detailed'}
                  {m === 'Oil Pastel' && 'Vibrant · painterly'}
                  {m === 'Crayon' && 'Bold · fastest'}
                  {m === "Artist's Choice" && "I'll pick what fits best"}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Step 3: Size + Estimate ── */}
      {step === 3 && (
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', marginBottom: '20px', lineHeight: 1.7 }}>
            Pick a size. Custom sizes have a $10 cutting fee.
          </p>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px' }}>
            {STANDARD_SIZES.map(s => (
              <button key={s.label} onClick={() => setSelectedSize(s)} style={{
                ...pillBtn(selectedSize?.label === s.label),
                padding: '8px 14px',
              }}>
                {s.label}
              </button>
            ))}
          </div>

          {isCustom && (
            <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', color: '#8a5c3a', display: 'block', marginBottom: '4px' }}>Width (in)</label>
                <input style={inp} type="number" min="1" max="30" value={customW} onChange={e => setCustomW(e.target.value)} placeholder="e.g. 12" />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', color: '#8a5c3a', display: 'block', marginBottom: '4px' }}>Height (in)</label>
                <input style={inp} type="number" min="1" max="30" value={customH} onChange={e => setCustomH(e.target.value)} placeholder="e.g. 16" />
              </div>
            </div>
          )}

          {/* Framed / Unframed toggle */}
          {selectedSize && (
            <div style={{ marginBottom: '20px' }}>
              <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a5c3a', marginBottom: '10px' }}>
                Framing
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setFramed(false)} style={{ ...pillBtn(framed === false), padding: '8px 18px' }}>
                  Unframed
                </button>
                <button onClick={() => setFramed(true)} style={{ ...pillBtn(framed === true), padding: '8px 18px' }}>
                  Framed
                  {selectedSize && (
                    <span style={{ marginLeft: '6px', fontSize: '9px', opacity: 0.7 }}>
                      +${(FRAME_COST[selectedSize.label] || FRAME_COST['Custom']).min}–${(FRAME_COST[selectedSize.label] || FRAME_COST['Custom']).max}
                    </span>
                  )}
                </button>
              </div>
            </div>
          )}

          {/* Live estimate */}
          {estimate && framed !== null && (
            <div style={{ background: 'rgba(26,18,8,0.04)', border: '1px solid #d4c9bb', padding: '16px', marginBottom: '20px' }}>
              <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a5c3a', marginBottom: '12px' }}>
                Estimate
              </p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                <div>
                  <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a5c3a', margin: '0 0 2px' }}>Drawing time</p>
                  <p style={{ fontFamily: 'serif', fontSize: '1.1rem', color: '#1a1208', margin: 0 }}>{estimate.hMin}–{estimate.hMax} hrs</p>
                </div>
                <div>
                  <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a5c3a', margin: '0 0 2px' }}>Total cost</p>
                  <p style={{ fontFamily: 'serif', fontSize: '1.1rem', color: '#1a1208', margin: 0 }}>
                    ${totalMin}–${totalMax}
                    <span style={{ fontFamily: 'monospace', fontSize: '9px', color: '#8a5c3a' }}>
                      {cutFee > 0 && framed && ' incl. cut + frame'}
                      {cutFee > 0 && !framed && ' incl. cut fee'}
                      {cutFee === 0 && framed && ' incl. frame'}
                    </span>
                  </p>
                </div>
                <div>
                  <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a5c3a', margin: '0 0 2px' }}>50% deposit</p>
                  <p style={{ fontFamily: 'serif', fontSize: '1.1rem', color: '#b97a30', margin: 0 }}>${depositMin}–${depositMax}</p>
                </div>
              </div>

              {/* Schedule-aware completion window */}
              <div style={{ borderTop: '1px solid #d4c9bb', paddingTop: '12px' }}>
                <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a5c3a', margin: '0 0 6px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                  Estimated ready by
                </p>
                {compLoading || !completion ? (
                  <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#b0a898', margin: 0 }}>
                    Checking schedule…
                  </p>
                ) : (
                  <>
                    <p style={{ fontFamily: 'serif', fontSize: '1.15rem', color: '#1a1208', margin: '0 0 4px' }}>
                      {completion.realisticLabel}
                    </p>
                    <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#b0a898', margin: 0, lineHeight: 1.6 }}>
                      Based on ~{completion.hoursPerWeek} available studio hrs/week.
                      {' '}This is a realistic window built around the current schedule —
                      {' '}not a generic estimate.
                    </p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Step 4: Contact + Notes ── */}
      {step === 4 && (
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', marginBottom: '20px', lineHeight: 1.7 }}>
            Almost done. Leave any extra notes for the artist, then submit.
          </p>
          <label style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', color: '#8a5c3a', display: 'block', marginBottom: '4px' }}>Your Name</label>
          <input style={{ ...inp, marginBottom: '14px' }} type="text" value={contactName} onChange={e => setContactName(e.target.value)} placeholder="Name" required />

          <label style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', color: '#8a5c3a', display: 'block', marginBottom: '4px' }}>Email</label>
          <input style={{ ...inp, marginBottom: '14px' }} type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)} placeholder="your@email.com" required />

          <label style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', color: '#8a5c3a', display: 'block', marginBottom: '4px' }}>Notes for the artist (optional)</label>
          <textarea style={{ ...inp, minHeight: '80px', resize: 'vertical', marginBottom: '20px' }}
            value={notes} onChange={e => setNotes(e.target.value)}
            placeholder="Colors you love, things to avoid, specific details to include..."
          />

          {/* Summary */}
          {estimate && (
            <div style={{ background: 'rgba(26,18,8,0.04)', border: '1px solid #d4c9bb', padding: '14px', marginBottom: '20px' }}>
              <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a5c3a', marginBottom: '8px' }}>Summary</p>
              <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#1a1208', margin: '0 0 4px' }}>
                {selectedSize?.label} · {medium} · {getAbstractionLabel(abstraction)} · {framed ? 'Framed' : 'Unframed'}
              </p>
              <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#1a1208', margin: '0 0 4px' }}>
                Est. ${totalMin}–${totalMax} total
              </p>
              <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#b97a30', margin: 0 }}>
                ${depositMin}–${depositMax} deposit due at booking
              </p>
            </div>
          )}

          {error && <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#b94040', marginBottom: '12px' }}>{error}</p>}
        </div>
      )}

      {/* ── Navigation ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
        <button
          onClick={step === 1 ? onClose : () => setStep(s => s - 1)}
          style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: 'none', cursor: 'pointer', color: '#8a5c3a', padding: '10px 0' }}
        >
          {step === 1 ? 'Cancel' : '← Back'}
        </button>

        {step < 4 ? (
          <button
            onClick={() => setStep(s => s + 1)}
            disabled={!canAdvance()}
            style={{
              fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase',
              padding: '12px 28px', border: '1px solid', cursor: canAdvance() ? 'pointer' : 'not-allowed',
              background: canAdvance() ? '#1a1208' : '#e8e0d4',
              color:      canAdvance() ? '#f2ebe0'  : '#8a5c3a',
              borderColor: canAdvance() ? '#1a1208' : '#d4c9bb',
              transition: 'all 0.15s',
            }}
          >
            Next →
          </button>
        ) : (
          <button
            onClick={handleSubmit}
            disabled={busy || !canAdvance()}
            style={{
              fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase',
              padding: '12px 28px', border: '1px solid', cursor: 'pointer',
              background: '#1a1208', color: '#f2ebe0', borderColor: '#1a1208',
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? <span className="flex items-center justify-center gap-2"><Spinner />Submitting…</span> : 'Submit Request'}
          </button>
        )}
      </div>
    </div>
  )
}
