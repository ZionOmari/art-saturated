import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { collection, addDoc, doc, getDoc, serverTimestamp } from 'firebase/firestore'
import { storage, db } from '../lib/firebase'
import { useAuth, hasRole } from '../context/AuthContext'
import Footer from '../components/Footer'
import StylePicker from '../components/StylePicker'
import CropModal from '../components/CropModal'
import { checkoutListingFee } from '../lib/stripe'
import { getNextSubmissionNumber } from '../data/storage'
import { getApprovedListingCount } from '../data/artists'
import Spinner from '../components/Spinner'

const FREE_LIMIT    = 10
const MARKUP        = 1.10
const CATEGORIES    = ['Pen', 'Crayon', 'Mixed', 'Print', 'Photography', 'Digital', 'Sculpture', 'Other']
// Garment types for one-of-one clothing — mirror the shop's Room 40 Threads filters.
const GARMENT_TYPES = ['Tops', 'Bottoms', 'Accessories', 'Custom / One of One']

const inputStyle = {
  width: '100%', fontFamily: 'monospace', fontSize: '13px',
  padding: '12px 14px', border: '1px solid #d4c9bb',
  background: '#faf8f4', color: '#1a1208',
  outline: 'none', boxSizing: 'border-box', marginBottom: '14px',
}

export default function SubmitArtPage() {
  useEffect(() => { document.title = 'Submit Your Art — Art Saturated'; return () => { document.title = 'Art Saturated' } }, [])
  const { user, profile, applyForPartnership } = useAuth()
  const navigate = useNavigate()

  const isPartner        = profile?.isPartner === true
  const applicationStatus = profile?.partnerApplication || null

  const [approvedCount,  setApprovedCount]  = useState(null)  // null = still loading
  const [countLoading,   setCountLoading]   = useState(true)

  const [listingType, setListingType] = useState('art')   // 'art' | 'clothing'
  const isClothing = listingType === 'clothing'

  const [form, setForm] = useState({
    title: '', category: '', medium: '', dimensions: '',
    price: '', description: '', year: '', weightOz: '', styles: [],
  })
  const [customFields,     setCustomFields]     = useState([])
  const [imageFile,        setImageFile]        = useState(null)
  const [imagePreview,     setImagePreview]     = useState(null)
  const [cropPending,      setCropPending]      = useState(null)
  const [imageQualityWarn, setImageQualityWarn] = useState('')
  const [agreed,           setAgreed]           = useState(false)
  const [busy,             setBusy]             = useState(false)
  const [error,            setError]            = useState('')
  const [submitted,        setSubmitted]        = useState(false)
  const [applyBusy,        setApplyBusy]        = useState(false)
  const [applyDone,        setApplyDone]        = useState(false)

  useEffect(() => {
    if (!user) return
    getApprovedListingCount(user.uid)
      .then(n => { setApprovedCount(n); setCountLoading(false) })
      .catch(() => { setApprovedCount(0); setCountLoading(false) })
  }, [user])

  const artistPayout  = parseFloat(form.price) || 0
  const listedPrice   = artistPayout > 0 ? Math.round(artistPayout * MARKUP * 100) / 100 : 0
  const freeLeft      = Math.max(0, FREE_LIMIT - (approvedCount ?? 0))
  const needsPayment  = !isPartner && approvedCount !== null && approvedCount >= FREE_LIMIT
  const canApply      = !isPartner && approvedCount !== null && approvedCount >= FREE_LIMIT && !applicationStatus
  const isCreator     = hasRole(profile?.accountType, 'creator')

  if (!user) return (
    <main className="pt-[60px]">
      <div className="max-w-md mx-auto px-6 py-20 text-center">
        <p className="font-serif text-[1.5rem] mb-4">Sign in to submit art</p>
        <button className="btn-outline" onClick={() => navigate('/account')}>Sign In</button>
      </div>
      <Footer />
    </main>
  )

  if (isCreator && !profile?.artistPublic) return (
    <main className="pt-[60px]">
      <div className="max-w-md mx-auto px-6 py-20 text-center">
        <p className="eyebrow mb-3">Profile Required</p>
        <p className="font-serif text-[1.5rem] mb-4">Make your profile public first</p>
        <p className="font-mono text-[12px] text-warm-gray mb-8" style={{ lineHeight: 1.7 }}>
          Turn on "Show in Discover Artists" in your Artist Profile tab before submitting work.
        </p>
        <button className="btn-outline" onClick={() => navigate('/account?acctab=artist')}>Go to Artist Profile</button>
      </div>
      <Footer />
    </main>
  )

  function handleField(key) {
    return { value: form[key], onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) }
  }

  function handleImage(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.size < 500 * 1024) setImageQualityWarn(`This image is only ${Math.round(file.size / 1024)} KB — low quality. Upload 1 MB+ for best results.`)
    else setImageQualityWarn('')
    setCropPending({ file, preview: URL.createObjectURL(file) })
    e.target.value = ''
  }

  function handleCropConfirm(croppedFile, croppedPreview) {
    setCropPending(null)
    setImageFile(croppedFile)
    setImagePreview(croppedPreview)
    if (croppedFile.size < 200 * 1024) setImageQualityWarn(`Cropped image is ${Math.round(croppedFile.size / 1024)} KB — too low quality.`)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!agreed)          { setError('You must agree to the terms.'); return }
    if (!imageFile)       { setError('Please upload an image of your work.'); return }
    if (imageFile.size < 200 * 1024) { setError('Image is too low resolution. Please upload a higher-quality photo.'); return }
    if (!form.title)      { setError('Please add a title.'); return }
    if (isClothing && !form.category) { setError('Please choose a garment type.'); return }
    if (!form.dimensions) { setError(isClothing ? 'Size / fit is required (e.g. Medium · 20" chest).' : 'Dimensions are required (e.g. 8" × 10").'); return }
    if (!form.weightOz)   { setError('Estimated weight is required for shipping.'); return }
    if (parseFloat(form.weightOz) > 1120) { setError('Weight exceeds the USPS maximum of 70 lbs (1,120 oz). Contact us directly for oversized works.'); return }
    if (!form.price)      { setError('Please set your payout price.'); return }

    setBusy(true); setError('')
    try {
      const imgRef   = ref(storage, `submissions/${user.uid}/${Date.now()}_${imageFile.name}`)
      const snap     = await uploadBytes(imgRef, imageFile)
      const imageURL = await getDownloadURL(snap.ref)

      const submissionNumber = await getNextSubmissionNumber()

      const submissionRef = await addDoc(collection(db, 'submissions'), {
        submissionNumber,
        uid:          user.uid,
        artistName:   profile?.name || user.displayName || user.email,
        artistEmail:  user.email,
        title:        form.title,
        listingType:  listingType,                                  // 'art' | 'clothing'
        shopCategory: isClothing ? 'Room 40 Threads' : 'Art',       // target shop category on approval
        garmentType:  isClothing ? form.category : '',              // Tops / Bottoms / Accessories / Custom
        category:     form.category,
        medium:       form.medium,
        dimensions:   form.dimensions,
        year:         form.year ? parseInt(form.year) : null,
        styles:       form.styles,
        weightOz:     form.weightOz ? parseFloat(form.weightOz) : null,
        artistPayout: artistPayout,       // what the artist receives
        price:        listedPrice,        // what the customer pays (10% markup)
        description:  form.description,
        customFields: customFields.filter(f => f.label.trim() && f.value.trim()),
        imageURL,
        agreedToTerms: true,
        status:        needsPayment ? 'pending_payment' : 'pending_review',
        listingFeePaid: !needsPayment,
        submittedAt:   serverTimestamp(),
        reviewBy:      new Date(Date.now() + 48 * 60 * 60 * 1000),
      })

      if (needsPayment) {
        await checkoutListingFee({ customerEmail: user.email, submissionId: submissionRef.id })
      } else {
        setSubmitted(true)
      }
    } catch (err) {
      console.error(err)
      setError('Something went wrong. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function handleApply() {
    setApplyBusy(true)
    try {
      await applyForPartnership()
      setApplyDone(true)
    } catch (err) {
      console.error(err)
    } finally {
      setApplyBusy(false)
    }
  }

  if (submitted) return (
    <main className="pt-[60px]">
      <div className="max-w-md mx-auto px-6 py-20 text-center">
        <p className="font-serif text-[2rem] mb-4">Submission received.</p>
        <p className="font-mono text-[13px] text-warm-gray mb-8" style={{ lineHeight: 1.7 }}>
          Your work is under review. We'll notify you within 48 hours.
        </p>
        <button className="btn-outline" onClick={() => navigate('/account')}>Back to Account</button>
      </div>
      <Footer />
    </main>
  )

  return (
    <main className="pt-[60px]">
      {cropPending && (
        <CropModal
          file={cropPending.file}
          preview={cropPending.preview}
          onConfirm={handleCropConfirm}
          onCancel={() => setCropPending(null)}
        />
      )}

      <div className="max-w-xl mx-auto px-6 py-14">
        <p className="eyebrow mb-2">Artist Marketplace</p>
        <h1 className="font-serif text-[2rem] font-normal mb-2">{isClothing ? 'List Your Clothing' : 'Submit Your Art'}</h1>

        {/* Quota status bar */}
        {!countLoading && (
          <div style={{ marginBottom: '28px' }}>
            {isPartner ? (
              <p className="font-mono text-[11px]" style={{ color: '#3a7a40' }}>✓ Art Saturated Partner — unlimited free listings</p>
            ) : approvedCount !== null && approvedCount < FREE_LIMIT ? (
              <p className="font-mono text-[11px] text-warm-gray">
                {freeLeft} free listing{freeLeft !== 1 ? 's' : ''} remaining · {approvedCount}/{FREE_LIMIT} used
              </p>
            ) : (
              <div style={{ padding: '14px 16px', border: '1px solid #d4c9bb', background: '#faf8f4', marginBottom: '8px' }}>
                <p className="font-mono text-[12px]" style={{ color: '#1a1814', marginBottom: '10px', lineHeight: 1.6 }}>
                  You've used all {FREE_LIMIT} free listings. Each additional listing is <strong>$1</strong>.
                </p>
                {canApply && (
                  <div style={{ borderTop: '1px solid #e8e0d4', paddingTop: '10px', marginTop: '4px' }}>
                    <p className="font-mono text-[11px] text-warm-gray" style={{ marginBottom: '8px', lineHeight: 1.6 }}>
                      Or apply for an Art Saturated Partnership — unlimited free listings, no fees.
                    </p>
                    {applyDone || applicationStatus === 'pending' ? (
                      <p className="font-mono text-[11px]" style={{ color: '#3a7a40' }}>✓ Partnership application submitted — we'll be in touch.</p>
                    ) : (
                      <button onClick={handleApply} disabled={applyBusy}
                        style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '8px 18px', border: '1px solid #1a1814', background: 'transparent', cursor: 'pointer', color: '#1a1814' }}>
                        {applyBusy ? 'Submitting…' : 'Apply for Partnership'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        <p className="font-mono text-[12px] text-warm-gray mb-10">
          48hr review · you set your price · buyers cover the platform fee
        </p>

        <form onSubmit={handleSubmit}>

          {/* Listing type — art vs one-of-one clothing */}
          <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a5c3a', marginBottom: '8px' }}>What are you listing?</p>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '22px' }}>
            {[
              { id: 'art',      label: 'Art',                sub: 'Original artwork' },
              { id: 'clothing', label: 'Clothing · 1 of 1',  sub: 'One-of-one garment' },
            ].map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setListingType(opt.id)}
                style={{
                  flex: 1, textAlign: 'left', cursor: 'pointer',
                  padding: '12px 14px', background: listingType === opt.id ? '#1a1208' : '#faf8f4',
                  border: `1px solid ${listingType === opt.id ? '#1a1208' : '#d4c9bb'}`,
                  transition: 'all 0.15s',
                }}
              >
                <span style={{ display: 'block', fontFamily: 'monospace', fontSize: '12px', letterSpacing: '0.04em', color: listingType === opt.id ? '#f2ebe0' : '#1a1208' }}>{opt.label}</span>
                <span style={{ display: 'block', fontFamily: 'monospace', fontSize: '10px', marginTop: '3px', color: listingType === opt.id ? 'rgba(242,235,224,0.6)' : '#b0a898' }}>{opt.sub}</span>
              </button>
            ))}
          </div>

          {/* Image upload */}
          <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a5c3a', marginBottom: '6px' }}>Image *</p>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b0a898', marginBottom: '10px', lineHeight: 1.6 }}>
            Clear, well-lit, unfiltered photo · Minimum 1 MB
          </p>
          <label style={{
            display: 'block', width: '100%', aspectRatio: '1',
            border: `1px dashed ${imageQualityWarn ? '#b94040' : '#d4c9bb'}`,
            background: '#faf8f4', cursor: 'pointer', marginBottom: '8px',
            overflow: 'hidden', position: 'relative',
          }}>
            {imagePreview
              ? <img src={imagePreview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '8px' }}>
                  <span style={{ fontSize: '2rem' }}>＋</span>
                  <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', letterSpacing: '0.1em', textTransform: 'uppercase' }}>Upload image</span>
                </div>
            }
            <input type="file" accept="image/*" onChange={handleImage} style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }} />
          </label>
          {imageQualityWarn && <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b94040', marginBottom: '14px', lineHeight: 1.6 }}>⚠ {imageQualityWarn}</p>}

          {/* Fields */}
          <div style={{ position: 'relative', marginBottom: '14px' }}>
            <input style={{ ...inputStyle, marginBottom: 0 }} type="text" maxLength={80} placeholder="Title *" {...handleField('title')} required />
            <span style={{ position: 'absolute', right: '10px', bottom: '8px', fontFamily: 'monospace', fontSize: '10px', color: form.title.length > 70 ? '#b94040' : '#b0a898' }}>
              {form.title.length}/80
            </span>
          </div>

          <select style={{ ...inputStyle, appearance: 'none' }} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
            <option value="">{isClothing ? 'Garment type *' : 'Category'}</option>
            {(isClothing ? GARMENT_TYPES : CATEGORIES).map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          <input style={inputStyle} type="text" maxLength={100} placeholder={isClothing ? 'Material (e.g. Cotton, Denim, Hand-dyed)' : 'Medium (e.g. Oil on canvas)'} {...handleField('medium')} />

          <div style={{ display: 'flex', gap: '12px' }}>
            <input style={{ ...inputStyle, flex: 1 }} type="text" placeholder={isClothing ? 'Size / fit * (e.g. Medium · 20" chest)' : 'Dimensions * (e.g. 8" × 10")'} required {...handleField('dimensions')} />
            <input style={{ ...inputStyle, width: '110px' }} type="number" placeholder="Year" min="1900" max={new Date().getFullYear()} {...handleField('year')} />
          </div>

          {!isClothing && (
            <div style={{ marginBottom: '14px' }}>
              <StylePicker selected={form.styles} onChange={styles => setForm(f => ({ ...f, styles }))} />
            </div>
          )}

          <div style={{ marginBottom: '14px' }}>
            <input style={{ ...inputStyle, marginBottom: '4px' }} type="number" placeholder="Estimated weight * (oz) — required for shipping" min="0" step="0.1" required {...handleField('weightOz')} />
            {form.weightOz && (
              <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', marginBottom: '10px' }}>
                ≈ {(parseFloat(form.weightOz) / 16).toFixed(2)} lbs
              </p>
            )}
          </div>

          {/* Price with markup preview */}
          <div style={{ marginBottom: '14px' }}>
            <p style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', color: '#8a5c3a', marginBottom: '4px' }}>Your Payout *</p>
            <input style={{ ...inputStyle, marginBottom: '6px' }} type="number" placeholder="Amount you receive (e.g. 100)" min="1" step="0.01" required {...handleField('price')} />
            {artistPayout > 0 && (
              <div style={{ display: 'flex', gap: '20px', padding: '10px 14px', background: '#f2ebe0', border: '1px solid #d4c9bb' }}>
                <div>
                  <p style={{ fontFamily: 'monospace', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#8a857d', marginBottom: '2px' }}>You receive</p>
                  <p style={{ fontFamily: 'monospace', fontSize: '14px', color: '#1a1814', fontWeight: 600 }}>${artistPayout.toFixed(2)}</p>
                </div>
                <div style={{ borderLeft: '1px solid #d4c9bb', paddingLeft: '20px' }}>
                  <p style={{ fontFamily: 'monospace', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#8a857d', marginBottom: '2px' }}>Listed at</p>
                  <p style={{ fontFamily: 'monospace', fontSize: '14px', color: '#a08060', fontWeight: 600 }}>${listedPrice.toFixed(2)}</p>
                </div>
              </div>
            )}
          </div>

          <div style={{ position: 'relative', marginBottom: '14px' }}>
            <textarea style={{ ...inputStyle, marginBottom: 0, minHeight: '100px', resize: 'vertical', paddingBottom: '24px' }} maxLength={600} placeholder="Description" {...handleField('description')} />
            <span style={{ position: 'absolute', right: '10px', bottom: '8px', fontFamily: 'monospace', fontSize: '10px', color: form.description.length > 540 ? '#b94040' : '#b0a898', pointerEvents: 'none' }}>
              {form.description.length}/600
            </span>
          </div>

          {/* Custom fields */}
          <div style={{ marginBottom: '20px' }}>
            <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8a5c3a', marginBottom: '10px' }}>Additional Details</p>
            {customFields.map((field, i) => (
              <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'flex-start' }}>
                <input style={{ ...inputStyle, width: '38%', marginBottom: 0, flexShrink: 0 }} placeholder="Label" value={field.label}
                  onChange={e => setCustomFields(prev => prev.map((f, idx) => idx === i ? { ...f, label: e.target.value } : f))} />
                <input style={{ ...inputStyle, flex: 1, marginBottom: 0 }} placeholder="Value" value={field.value}
                  onChange={e => setCustomFields(prev => prev.map((f, idx) => idx === i ? { ...f, value: e.target.value } : f))} />
                <button type="button" onClick={() => setCustomFields(prev => prev.filter((_, idx) => idx !== i))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#b94040', fontFamily: 'monospace', fontSize: '14px', padding: '10px 4px', flexShrink: 0 }}>✕</button>
              </div>
            ))}
            <button type="button" onClick={() => setCustomFields(prev => [...prev, { label: '', value: '' }])}
              style={{ fontFamily: 'monospace', fontSize: '11px', padding: '8px 16px', border: '1px dashed #d4c9bb', background: 'transparent', cursor: 'pointer', color: '#8a5c3a' }}>
              + Add a field
            </button>
          </div>

          {/* Terms */}
          <div style={{ border: '1px solid #d4c9bb', background: '#faf8f4', padding: '16px', marginBottom: '16px' }}>
            <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#1a1208', marginBottom: '12px' }}>Terms</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {[
                'No AI-generated art of any kind.',
                'No NSFW, hate speech, or plagiarized work.',
                'High-resolution, clear photos required. Blurry or poorly lit images will be rejected.',
                'All listing details must be accurate — dimensions, weight, condition, and photos.',
                'Titles must be 80 characters or fewer. Descriptions must be 600 characters or fewer.',
                'You set your payout price. A 10% platform fee is added to the listed price and paid by the buyer.',
                `First ${FREE_LIMIT} approved listings are free. After that, a $1 listing fee applies per submission unless you are an Art Saturated Partner.`,
                'Art Saturated is a marketplace facilitator. You are responsible for accurate listings, packaging, and timely shipment.',
                'By submitting, you confirm you own all rights to this work.',
              ].map((t, i) => (
                <li key={i} style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', marginBottom: '8px', paddingLeft: '14px', position: 'relative', lineHeight: 1.6 }}>
                  <span style={{ position: 'absolute', left: 0 }}>—</span>{t}
                </li>
              ))}
            </ul>
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', marginBottom: '24px' }}>
            <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}
              style={{ marginTop: '2px', accentColor: '#1a1208', width: '14px', height: '14px', flexShrink: 0 }} />
            <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#1a1208' }}>
              I agree to all terms above. This is my original work, not AI-generated. All listing details are accurate.
            </span>
          </label>

          {needsPayment && (
            <div style={{ background: '#f2ebe0', border: '1px solid #d4c9bb', padding: '12px 16px', marginBottom: '20px' }}>
              <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', margin: 0 }}>
                A <strong style={{ color: '#1a1208' }}>$1.00 listing fee</strong> will be charged — you've used all {FREE_LIMIT} free listings.
              </p>
            </div>
          )}

          {error && <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#b94040', marginBottom: '12px' }}>{error}</p>}

          <button type="submit" disabled={busy || countLoading} className="btn-outline w-full text-center" style={{ display: 'block' }}>
            {busy
              ? <span className="flex items-center justify-center gap-2"><Spinner />Submitting…</span>
              : needsPayment ? 'Submit for Review — $1.00'
              : 'Submit for Review — Free'}
          </button>
        </form>
      </div>
      <Footer />
    </main>
  )
}
