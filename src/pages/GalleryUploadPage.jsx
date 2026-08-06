import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { uploadProductImage } from '../data/storage'
import { checkoutArtistSubscription } from '../lib/stripe'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'

const BLANK_PIECE = { title: '', medium: '', size: '', weightOz: '', year: '' }

/**
 * Gallery upload — fast, repeated entry of one piece at a time.
 *
 * A piece is a title plus its detail fields and however many photos it takes to
 * show it. The artist is filled in from the signed-in profile and is not
 * editable: work uploaded here belongs to one artist profile by definition.
 *
 * After each save the form clears and stays put, so uploading a whole gallery
 * is fill → drop photos → save, repeated, with no navigation in between.
 */
export default function GalleryUploadPage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()
  const fileRef  = useRef()

  const [piece,   setPiece]   = useState(BLANK_PIECE)
  const [photos,  setPhotos]  = useState([])      // [{ file, preview, url, uploading }]
  const [saved,   setSaved]   = useState([])      // pieces added this session
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState(null)
  const [subBusy, setSubBusy] = useState(false)

  const artistName = profile?.name || user?.displayName || user?.email || ''
  const isMember   = profile?.artistSubActive === true

  useEffect(() => {
    document.title = 'Gallery Upload — Art Saturated'
    return () => { document.title = 'Art Saturated' }
  }, [])

  // Revoke object URLs so a long upload session doesn't leak memory.
  useEffect(() => () => { photos.forEach(p => p.preview && URL.revokeObjectURL(p.preview)) }, [photos])

  async function addPhotos(e) {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    e.target.value = ''
    setError(null)

    const staged = files.map(file => ({
      file, preview: URL.createObjectURL(file), url: null, uploading: true,
    }))
    setPhotos(prev => [...prev, ...staged])

    // Upload immediately so saving the piece is instant.
    await Promise.all(staged.map(async (s) => {
      try {
        const url = await uploadProductImage(s.file)
        setPhotos(prev => prev.map(p => p.file === s.file ? { ...p, url, uploading: false } : p))
      } catch {
        setPhotos(prev => prev.filter(p => p.file !== s.file))
        setError(`"${s.file.name}" failed to upload.`)
      }
    }))
  }

  function removePhoto(i) {
    setPhotos(prev => {
      const p = prev[i]
      if (p?.preview) URL.revokeObjectURL(p.preview)
      return prev.filter((_, j) => j !== i)
    })
  }

  async function savePiece(e) {
    e.preventDefault()
    setError(null)

    if (!piece.title.trim()) { setError('Give the piece a title.'); return }
    if (!photos.length)      { setError('Add at least one photo.'); return }
    if (photos.some(p => p.uploading)) { setError('Photos are still uploading.'); return }

    setBusy(true)
    try {
      const imageURLs = photos.map(p => p.url).filter(Boolean)
      await addDoc(collection(db, 'submissions'), {
        uid:         user.uid,
        artistName,
        artistEmail: user.email,
        title:       piece.title.trim(),
        medium:      piece.medium.trim(),
        dimensions:  piece.size.trim(),
        weightOz:    piece.weightOz ? parseFloat(piece.weightOz) : null,
        year:        piece.year ? parseInt(piece.year, 10) : null,
        category:    'Art',
        shopCategory: 'Art',
        listingType: 'art',
        imageURL:    imageURLs[0],
        imageURLs,
        source:      'gallery-upload',
        // Membership replaces the old per-listing fee, so nothing to collect here.
        listingFeePaid: true,
        status:      'pending_review',
        agreedToTerms: true,
        createdAt:   serverTimestamp(),
      })

      setSaved(prev => [{ title: piece.title.trim(), count: imageURLs.length }, ...prev])
      photos.forEach(p => p.preview && URL.revokeObjectURL(p.preview))
      setPhotos([])
      setPiece(BLANK_PIECE)
      fileRef.current?.focus()
    } catch (err) {
      setError(err?.message || 'Could not save that piece.')
    } finally {
      setBusy(false)
    }
  }

  async function startSubscription() {
    setSubBusy(true)
    setError(null)
    try {
      await checkoutArtistSubscription({ customerEmail: user.email })
    } catch (err) {
      setError(err?.message || 'Could not start checkout.')
      setSubBusy(false)
    }
  }

  const input = {
    width: '100%', padding: '10px 12px', fontFamily: 'monospace', fontSize: '13px',
    border: '1px solid rgb(var(--color-warm-gray-light))', background: 'transparent',
    color: 'rgb(var(--color-ink))',
  }

  // ── Gates ──────────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <main className="pt-[60px]" style={{ minHeight: '100vh' }}>
        <div className="max-w-xl mx-auto px-6 py-24 text-center">
          <h1 className="font-serif text-[2rem] font-normal mb-4">Sign in to upload.</h1>
          <button className="btn-outline" onClick={() => navigate('/login')}>Sign In</button>
        </div>
        <Footer />
      </main>
    )
  }

  if (!isMember) {
    return (
      <main className="pt-[60px]" style={{ minHeight: '100vh' }}>
        <div className="max-w-xl mx-auto px-6 py-20">
          <p className="eyebrow mb-6">Artist membership</p>
          <h1 className="font-serif text-[clamp(2rem,5vw,2.6rem)] font-normal leading-tight mb-5">
            Upload your work.
          </h1>
          <p className="font-mono text-[13px] text-warm-gray leading-relaxed mb-8">
            $7.99 a month. Upload as much work as you like to your artist profile
            and the shop — no per-listing fees, no limits.
          </p>
          <ul className="font-mono text-[13px] text-warm-gray leading-relaxed mb-10" style={{ listStyle: 'none', padding: 0 }}>
            {[
              'Unlimited uploads to your artist profile',
              'Your work listed in the shop',
              'A public profile page you can share',
              'Cancel any time — listed work stays up',
            ].map(t => <li key={t} className="mb-2">— {t}</li>)}
          </ul>
          <button className="btn-outline" onClick={startSubscription} disabled={subBusy}>
            {subBusy ? 'Opening checkout…' : 'Join for $7.99/month'}
          </button>
          {error && <p role="alert" className="font-mono text-[12px] mt-4" style={{ color: '#b94040' }}>{error}</p>}
        </div>
        <Footer />
      </main>
    )
  }

  // ── Upload ─────────────────────────────────────────────────────────────────
  return (
    <main className="pt-[60px]" style={{ minHeight: '100vh' }}>
      <div className="max-w-2xl mx-auto px-6 py-16">

        <p className="eyebrow mb-4">Gallery upload</p>
        <h1 className="font-serif text-[clamp(1.8rem,4vw,2.4rem)] font-normal leading-tight mb-3">
          Add a piece.
        </h1>
        <p className="font-mono text-[13px] text-warm-gray leading-relaxed mb-10">
          One piece at a time, as many photos each as you need. The form clears
          after every save so you can keep going.
        </p>

        <form onSubmit={savePiece} className="flex flex-col gap-4">

          <label className="flex flex-col gap-1">
            <span className="font-mono text-[11px] text-warm-gray">Title</span>
            <input
              style={input} value={piece.title} autoFocus
              onChange={e => setPiece(p => ({ ...p, title: e.target.value }))}
            />
          </label>

          {/* Auto-filled and fixed — everything here belongs to one artist profile */}
          <label className="flex flex-col gap-1">
            <span className="font-mono text-[11px] text-warm-gray">Artist</span>
            <input
              style={{ ...input, opacity: 0.6, cursor: 'not-allowed' }}
              value={artistName} readOnly tabIndex={-1}
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] text-warm-gray">Medium</span>
              <input
                style={input} value={piece.medium} placeholder="Acrylic on canvas"
                onChange={e => setPiece(p => ({ ...p, medium: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] text-warm-gray">Size</span>
              <input
                style={input} value={piece.size} placeholder={'24" × 36"'}
                onChange={e => setPiece(p => ({ ...p, size: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] text-warm-gray">Weight (oz)</span>
              <input
                type="number" min="0" step="0.1" style={input} value={piece.weightOz}
                placeholder="For shipping"
                onChange={e => setPiece(p => ({ ...p, weightOz: e.target.value }))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono text-[11px] text-warm-gray">Year</span>
              <input
                type="number" min="1900" max="2100" style={input} value={piece.year}
                onChange={e => setPiece(p => ({ ...p, year: e.target.value }))}
              />
            </label>
          </div>

          {/* Photos — all of them belong to the single piece above */}
          <div className="flex flex-col gap-2 mt-2">
            <span className="font-mono text-[11px] text-warm-gray">
              Photos of this piece {photos.length > 0 && `(${photos.length})`}
            </span>

            {photos.length > 0 && (
              <div className="flex gap-2 flex-wrap mb-1">
                {photos.map((p, i) => (
                  <div key={i} style={{ position: 'relative', width: 84, height: 84 }}>
                    <img
                      src={p.preview} alt=""
                      style={{
                        width: '100%', height: '100%', objectFit: 'cover',
                        border: '1px solid rgb(var(--color-warm-gray-light))',
                        opacity: p.uploading ? 0.4 : 1,
                      }}
                    />
                    {p.uploading && (
                      <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                        <Spinner size={14} />
                      </div>
                    )}
                    {!p.uploading && (
                      <button
                        type="button" onClick={() => removePhoto(i)} aria-label="Remove photo"
                        style={{
                          position: 'absolute', top: -7, right: -7, width: 20, height: 20,
                          borderRadius: '50%', border: '1px solid rgb(var(--color-warm-gray-light))',
                          background: 'rgb(var(--color-cream))', cursor: 'pointer',
                          fontSize: 11, lineHeight: 1, color: 'rgb(var(--color-ink))',
                        }}
                      >×</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            <input
              ref={fileRef} type="file" accept="image/*" multiple
              onChange={addPhotos}
              className="font-mono text-[12px] text-warm-gray"
            />
          </div>

          <div className="border-t border-warm-gray-light pt-5 mt-3 flex items-center gap-4 flex-wrap">
            <button type="submit" className="btn-outline" disabled={busy}>
              {busy ? 'Saving…' : 'Save & Add Another'}
            </button>
            <button
              type="button" className="btn-ghost"
              onClick={() => navigate('/account?acctab=artist')}
            >
              Done
            </button>
          </div>

          {error && (
            <p role="alert" className="font-mono text-[12px]" style={{ color: '#b94040' }}>{error}</p>
          )}
        </form>

        {saved.length > 0 && (
          <div className="mt-12 border-t border-warm-gray-light pt-6">
            <p className="eyebrow mb-4">Added this session ({saved.length})</p>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {saved.map((s, i) => (
                <li key={i} className="font-mono text-[12px] text-warm-gray mb-2">
                  ✓ {s.title} — {s.count} photo{s.count !== 1 ? 's' : ''}
                </li>
              ))}
            </ul>
            <p className="font-mono text-[11px] text-warm-gray mt-4 leading-relaxed">
              Each piece goes to review before it appears in the shop.
            </p>
          </div>
        )}
      </div>
      <Footer />
    </main>
  )
}
