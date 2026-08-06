import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'

export default function InterviewPage() {
  const { token } = useParams()

  const [interview, setInterview] = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [answers,   setAnswers]   = useState({})
  const [busy,      setBusy]      = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error,     setError]     = useState('')

  useEffect(() => {
    async function load() {
      try {
        const snap = await getDoc(doc(db, 'interviews', token))
        if (!snap.exists()) { setError('This interview link is invalid or has expired.'); setLoading(false); return }
        const data = snap.data()
        if (data.status === 'responded' || data.status === 'drafting' || data.status === 'drafted' || data.status === 'published') {
          setSubmitted(true)
        }
        setInterview({ id: snap.id, ...data })
        // Pre-fill any existing responses
        if (data.responses) setAnswers(data.responses)
      } catch (err) {
        console.error('InterviewPage load error:', err)
        setError('Unable to load this interview. Please try again.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    // Require at least one non-empty answer
    const filled = Object.values(answers).filter(v => v.trim()).length
    if (filled === 0) { setError('Please answer at least one question before submitting.'); return }
    setBusy(true); setError('')
    try {
      await updateDoc(doc(db, 'interviews', token), {
        responses:   answers,
        status:      'responded',
        respondedAt: serverTimestamp(),
      })
      setSubmitted(true)
    } catch (err) {
      console.error('Interview submit error:', err)
      setError('Something went wrong — please try again.')
    } finally {
      setBusy(false)
    }
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) return (
    <main className="pt-[60px] min-h-screen flex items-center justify-center">
      <Spinner size={20} color="#3d2810" />
    </main>
  )

  // ── Error ────────────────────────────────────────────────────────────────
  if (error && !interview) return (
    <main className="pt-[60px] min-h-screen flex items-center justify-center px-6">
      <div style={{ textAlign: 'center', maxWidth: '400px' }}>
        <p className="font-serif text-[2rem] text-ink mb-4">Hmm.</p>
        <p className="font-mono text-[13px] text-warm-gray">{error}</p>
      </div>
    </main>
  )

  // ── Already submitted ────────────────────────────────────────────────────
  if (submitted) return (
    <main className="pt-[60px] min-h-screen">
      <div className="max-w-2xl mx-auto px-6 pt-24 pb-32 text-center">
        <p className="eyebrow mb-6">Art Saturated · Artist Feature</p>
        <h1 className="font-serif text-[clamp(2rem,6vw,3rem)] font-normal text-ink mb-6 leading-tight">
          Thank you, {interview.artistName?.split(' ')[0] || 'friend'}.
        </h1>
        <p className="font-mono text-[13px] text-warm-gray leading-relaxed max-w-md mx-auto">
          Your responses are in. We'll be in touch once the feature is ready —
          we'll send it to you for a look before anything goes live.
        </p>
        <div style={{ marginTop: '48px', borderTop: '1px solid #e8e0d4', paddingTop: '24px' }}>
          <a
            href="https://artsaturated.com"
            style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#7a5030', textDecoration: 'none' }}
          >
            Visit Art Saturated →
          </a>
        </div>
      </div>
      <Footer />
    </main>
  )

  // ── Form ─────────────────────────────────────────────────────────────────
  return (
    <main className="pt-[60px]">
      {/* Header */}
      <section className="max-w-2xl mx-auto px-6 pt-16 pb-10 border-b border-warm-gray-light">
        <p className="eyebrow mb-4">Art Saturated · Artist Feature</p>
        <h1 className="font-serif text-[clamp(1.8rem,5vw,2.8rem)] font-normal text-ink leading-tight mb-4">
          Hey {interview.artistName?.split(' ')[0] || 'there'} —
        </h1>
        <p className="font-mono text-[13px] text-warm-gray leading-relaxed max-w-lg">
          Thanks for taking the time. Answer as much or as little as you'd like —
          your own words are the whole point. Take your time with it.
        </p>
        {interview.notes && (
          <div style={{ marginTop: '16px', padding: '12px 16px', background: 'rgba(185,122,48,0.06)', border: '1px solid rgba(185,122,48,0.2)' }}>
            <p className="font-mono text-[12px] text-warm-gray leading-relaxed">{interview.notes}</p>
          </div>
        )}
      </section>

      {/* Questions */}
      <section className="max-w-2xl mx-auto px-6 py-12 pb-24">
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '36px' }}>
          {(interview.questions || []).map((q, i) => (
            <div key={i}>
              <p style={{
                fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase',
                letterSpacing: '0.12em', color: '#b97a30', marginBottom: '8px',
              }}>
                {String(i + 1).padStart(2, '0')}
              </p>
              <p className="font-serif text-[1.1rem] font-normal text-ink leading-snug mb-4">
                {q}
              </p>
              <textarea
                rows={5}
                value={answers[i] || ''}
                onChange={e => setAnswers(prev => ({ ...prev, [i]: e.target.value }))}
                placeholder="Your answer…"
                style={{
                  width: '100%', fontFamily: 'monospace', fontSize: '13px',
                  padding: '12px 14px', border: '1px solid #d4c9bb',
                  background: '#faf8f4', color: '#1a1208', outline: 'none',
                  resize: 'vertical', lineHeight: 1.7, boxSizing: 'border-box',
                  transition: 'border-color 0.15s',
                }}
                onFocus={e => { e.target.style.borderColor = '#8a5c3a' }}
                onBlur={e => { e.target.style.borderColor = '#d4c9bb' }}
              />
            </div>
          ))}

          {error && (
            <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#b94040' }}>{error}</p>
          )}

          <div style={{ paddingTop: '8px', borderTop: '1px solid #e8e0d4' }}>
            <p className="font-mono text-[11px] text-warm-gray mb-6 leading-relaxed">
              You can skip any questions you'd rather not answer.
              Once you submit, we'll draft the piece and send it your way before it goes live.
            </p>
            <button
              type="submit"
              disabled={busy}
              style={{
                fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.15em',
                textTransform: 'uppercase', padding: '14px 32px',
                background: busy ? '#a08060' : '#1a1208', color: '#f5f2ec',
                border: 'none', cursor: busy ? 'default' : 'pointer',
                transition: 'background 0.2s',
              }}
            >
              {busy ? 'Submitting…' : 'Submit My Answers'}
            </button>
          </div>
        </form>
      </section>

      <Footer />
    </main>
  )
}
