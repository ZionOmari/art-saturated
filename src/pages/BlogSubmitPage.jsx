import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { collection, addDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore'
import { storage, db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'
import { checkoutBlogSubmission } from '../lib/stripe'

const CATEGORIES = ['Art', 'Music', 'Culture', 'Community', 'Events', 'Feature', 'Interview', 'Opinion']

const inputStyle = {
  width: '100%', fontFamily: 'monospace', fontSize: '13px',
  padding: '12px 14px', border: '1px solid #d4c9bb', background: '#faf8f4',
  color: '#1a1208', outline: 'none', boxSizing: 'border-box', marginBottom: '14px',
}

const TERMS = [
  'All submitted content must be original — no plagiarism or AI-generated writing.',
  'Content must be respectful. No hate speech, slurs, or targeted harassment.',
  'Art Saturated reserves the right to edit submissions for length, clarity, or style before publishing.',
  'Art Saturated reserves the right to decline any submission for any reason.',
  'By submitting, you grant Art Saturated a non-exclusive license to publish your content on this platform.',
  'Submission fees are non-refundable regardless of the publication decision.',
]

export default function BlogSubmitPage() {
  useEffect(() => {
    document.title = 'Submit an Article — Art Saturated'
    return () => { document.title = 'Art Saturated' }
  }, [])

  const { user } = useAuth()
  const navigate  = useNavigate()

  const [form, setForm] = useState({
    title: '', category: '', authorName: '', authorEmail: '', excerpt: '', body: '',
  })
  const [coverFile,     setCoverFile]     = useState(null)
  const [coverPreview,  setCoverPreview]  = useState(null)
  const [agreed,        setAgreed]        = useState(false)
  const [busy,          setBusy]          = useState(false)
  const [error,         setError]         = useState('')
  const [submissionFee, setSubmissionFee] = useState(0)

  useEffect(() => {
    getDoc(doc(db, 'settings', 'storeConfig'))
      .then(snap => {
        if (!snap.exists()) return
        const d = snap.data()
        if (d.blogSubmissionFee != null) setSubmissionFee(Number(d.blogSubmissionFee))
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (user) {
      setForm(f => ({
        ...f,
        authorEmail: f.authorEmail || user.email || '',
        authorName:  f.authorName  || user.displayName || '',
      }))
    }
  }, [user])

  function handleField(key) {
    return { value: form[key], onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) }
  }

  function handleCover(e) {
    const file = e.target.files[0]
    if (!file) return
    setCoverFile(file)
    setCoverPreview(URL.createObjectURL(file))
    e.target.value = ''
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!agreed)                       { setError('You must agree to the terms to submit.'); return }
    if (!form.title.trim())            { setError('Please add a title.'); return }
    if (!form.authorName.trim())       { setError('Please add your name.'); return }
    if (!form.authorEmail.trim())      { setError('Please add your email.'); return }
    if (form.body.trim().length < 100) { setError('Please write your article (minimum 100 characters).'); return }

    setBusy(true); setError('')
    try {
      let coverURL = null
      if (coverFile) {
        const imgRef = ref(storage, `blog-covers/${Date.now()}_${coverFile.name}`)
        const snap   = await uploadBytes(imgRef, coverFile)
        coverURL     = await getDownloadURL(snap.ref)
      }

      const submissionRef = await addDoc(collection(db, 'blogSubmissions'), {
        title:         form.title.trim(),
        category:      form.category,
        authorName:    form.authorName.trim(),
        authorEmail:   form.authorEmail.trim(),
        excerpt:       form.excerpt.trim(),
        body:          form.body.trim(),
        coverURL,
        agreedToTerms: true,
        status:        submissionFee > 0 ? 'pending_payment' : 'pending_review',
        feePaid:       submissionFee <= 0,
        submittedAt:   serverTimestamp(),
        uid:           user?.uid || null,
      })

      if (submissionFee > 0) {
        await checkoutBlogSubmission({
          customerEmail: form.authorEmail.trim(),
          submissionId:  submissionRef.id,
          title:         form.title.trim(),
          fee:           submissionFee,
        })
      } else {
        navigate('/payment-success?type=blog')
      }
    } catch (err) {
      console.error(err)
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="pt-[60px]">
      <div className="max-w-xl mx-auto px-6 py-14">
        <p className="eyebrow mb-2">Art Saturated Magazine</p>
        <h1 className="font-serif text-[2rem] font-normal mb-2">Submit an Article</h1>
        <p className="font-mono text-[12px] text-warm-gray mb-10 leading-relaxed">
          Share your perspective on art, music, culture, and community.
          {submissionFee > 0 && (
            <> · <strong style={{ color: '#1a1208' }}>${Number(submissionFee).toFixed(2)} submission fee</strong></>
          )}
          {' '}· Reviewed within 48 hours.
        </p>

        <form onSubmit={handleSubmit}>

          {/* Cover image */}
          <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a5c3a', marginBottom: '6px' }}>
            Cover Image
          </p>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b0a898', marginBottom: '10px' }}>
            Optional · Landscape format recommended
          </p>
          <label style={{
            display: 'block', width: '100%', aspectRatio: '16/7',
            border: '1px dashed #d4c9bb', background: '#faf8f4',
            cursor: 'pointer', marginBottom: '20px', overflow: 'hidden', position: 'relative',
          }}>
            {coverPreview
              ? <img src={coverPreview} alt="cover" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '8px' }}>
                  <span style={{ fontSize: '1.4rem' }}>＋</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Upload cover</span>
                </div>
            }
            <input type="file" accept="image/*" onChange={handleCover} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
          </label>

          <input style={inputStyle} type="text" placeholder="Title *" required {...handleField('title')} />

          <select style={{ ...inputStyle, appearance: 'none' }} value={form.category}
            onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            <option value="">Category</option>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <div style={{ display: 'flex', gap: '12px' }}>
            <input style={{ ...inputStyle, flex: 1 }} type="text" placeholder="Your Name *" required {...handleField('authorName')} />
            <input style={{ ...inputStyle, flex: 1 }} type="email" placeholder="Your Email *" required {...handleField('authorEmail')} />
          </div>

          <input
            style={inputStyle}
            type="text"
            placeholder="Excerpt / subtitle — shown in previews (optional)"
            maxLength={200}
            {...handleField('excerpt')}
          />

          <textarea
            style={{ ...inputStyle, minHeight: '300px', resize: 'vertical' }}
            placeholder="Article body * — write your full piece here (min 100 characters)"
            {...handleField('body')}
          />

          {/* Terms */}
          <div style={{ border: '1px solid #d4c9bb', background: '#faf8f4', padding: '16px', marginBottom: '16px' }}>
            <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#1a1208', marginBottom: '12px' }}>
              Terms & Conditions
            </p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {TERMS.map((t, i) => (
                <li key={i} style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', marginBottom: '8px', paddingLeft: '14px', position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 0 }}>—</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '24px' }}>
            <input
              type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
              style={{ marginTop: '2px', accentColor: '#1a1208', width: '14px', height: '14px', flexShrink: 0 }}
            />
            <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#1a1208' }}>
              I have read and agree to all terms above. I confirm this is my original writing and not AI-generated.
            </span>
          </label>

          {submissionFee > 0 && (
            <div style={{ background: '#f2ebe0', border: '1px solid #d4c9bb', padding: '12px 16px', marginBottom: '20px' }}>
              <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', margin: 0 }}>
                A <strong style={{ color: '#1a1208' }}>${Number(submissionFee).toFixed(2)} submission fee</strong> is charged via Stripe.
                Non-refundable regardless of publication.
              </p>
            </div>
          )}

          {error && (
            <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#b94040', marginBottom: '12px' }}>{error}</p>
          )}

          <button type="submit" disabled={busy} className="btn-outline w-full text-center" style={{ display: 'block' }}>
            {busy
              ? <span className="flex items-center justify-center gap-2"><Spinner />Submitting…</span>
              : submissionFee > 0
                ? `Submit Article — $${Number(submissionFee).toFixed(2)}`
                : 'Submit Article for Review'
            }
          </button>
        </form>
      </div>
      <Footer />
    </main>
  )
}
