import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useAuth } from '../context/AuthContext'
import { uploadProductImage } from '../data/storage'
import { checkoutArtistSubscription } from '../lib/stripe'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'

let nextId = 1
const newPiece = (photos = []) => ({
  id: nextId++, photos, title: '', medium: '', size: '', weightOz: '', year: '',
})

/**
 * Gallery upload.
 *
 * Drop a stack of photos and each one becomes its own piece — the fast path for
 * listing a body of work. When several photos are of the SAME piece, drag them
 * onto that piece's card and they join it instead of becoming separate entries.
 *
 * The file input carries no `capture` attribute on purpose: iOS then offers
 * Take Photo / Photo Library / Browse rather than jumping straight to the camera.
 */
export default function GalleryUploadPage() {
  const { user, profile } = useAuth()
  const navigate = useNavigate()

  const [pieces,  setPieces]  = useState([])
  const [dragging, setDragging] = useState(false)   // page-level drop zone lit
  const [overCard, setOverCard] = useState(null)    // id of card being dragged over
  const [busy,    setBusy]    = useState(false)
  const [error,   setError]   = useState(null)
  const [result,  setResult]  = useState(null)
  const [subBusy, setSubBusy] = useState(false)

  const artistName = profile?.name || user?.displayName || user?.email || ''
  const isMember   = profile?.artistSubActive === true
  const dragDepth  = useRef(0)

  useEffect(() => {
    document.title = 'Gallery Upload — Art Saturated'
    return () => { document.title = 'Art Saturated' }
  }, [])

  // One upload per photo, started as soon as it lands, so Save is instant.
  const uploadPhoto = useCallback(async (pieceId, file, preview) => {
    try {
      const url = await uploadProductImage(file)
      setPieces(prev => prev.map(p => p.id !== pieceId ? p : {
        ...p,
        photos: p.photos.map(ph => ph.preview === preview ? { ...ph, url, uploading: false } : ph),
      }))
    } catch {
      setPieces(prev => prev.map(p => p.id !== pieceId ? p : {
        ...p, photos: p.photos.filter(ph => ph.preview !== preview),
      }))
      setError(`"${file.name}" failed to upload.`)
    }
  }, [])

  // targetId null → each file becomes its own piece. targetId set → all files
  // join that existing piece.
  const addFiles = useCallback((fileList, targetId = null) => {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'))
    if (!files.length) return
    setError(null)

    const staged = files.map(file => ({
      file, preview: URL.createObjectURL(file), url: null, uploading: true,
    }))

    if (targetId != null) {
      setPieces(prev => prev.map(p => p.id === targetId ? { ...p, photos: [...p.photos, ...staged] } : p))
      staged.forEach(s => uploadPhoto(targetId, s.file, s.preview))
    } else {
      const created = staged.map(s => newPiece([s]))
      setPieces(prev => [...prev, ...created])
      created.forEach(p => uploadPhoto(p.id, p.photos[0].file, p.photos[0].preview))
    }
  }, [uploadPhoto])

  // ── Page-level drag & drop ────────────────────────────────────────────────
  useEffect(() => {
    if (!isMember) return
    const onOver  = e => { e.preventDefault() }
    const onEnter = e => {
      if (!e.dataTransfer?.types?.includes('Files')) return
      dragDepth.current++
      setDragging(true)
    }
    const onLeave = () => { if (--dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false) } }
    const onDrop  = e => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      setOverCard(null)
      // A drop handled by a card stops propagation, so reaching here means the
      // page background: every file becomes its own piece.
      addFiles(e.dataTransfer.files)
    }
    window.addEventListener('dragover',  onOver)
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop',      onDrop)
    return () => {
      window.removeEventListener('dragover',  onOver)
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop',      onDrop)
    }
  }, [isMember, addFiles])

  function update(id, patch) {
    setPieces(prev => prev.map(p => p.id === id ? { ...p, ...patch } : p))
  }

  function removePhoto(pieceId, idx) {
    setPieces(prev => prev.flatMap(p => {
      if (p.id !== pieceId) return [p]
      const photos = p.photos.filter((_, i) => i !== idx)
      return photos.length ? [{ ...p, photos }] : []   // last photo gone → drop the piece
    }))
  }

  async function saveAll() {
    setError(null)
    const ready = pieces.filter(p => p.photos.length && p.photos.every(ph => !ph.uploading))
    if (!ready.length)                  { setError('Nothing ready to save yet.'); return }
    if (ready.some(p => !p.title.trim())) { setError('Every piece needs a title.'); return }
    if (pieces.some(p => p.photos.some(ph => ph.uploading))) { setError('Photos are still uploading.'); return }

    setBusy(true)
    try {
      let saved = 0
      for (const p of ready) {
        const imageURLs = p.photos.map(ph => ph.url).filter(Boolean)
        if (!imageURLs.length) continue
        await addDoc(collection(db, 'submissions'), {
          uid:          user.uid,
          artistName,
          artistEmail:  user.email,
          title:        p.title.trim(),
          medium:       p.medium.trim(),
          dimensions:   p.size.trim(),
          weightOz:     p.weightOz ? parseFloat(p.weightOz) : null,
          year:         p.year ? parseInt(p.year, 10) : null,
          category:     'Art',
          shopCategory: 'Art',
          listingType:  'art',
          imageURL:     imageURLs[0],
          imageURLs,
          source:       'gallery-upload',
          status:       'pending_review',
          agreedToTerms: true,
          createdAt:    serverTimestamp(),
        })
        saved++
      }
      pieces.forEach(p => p.photos.forEach(ph => ph.preview && URL.revokeObjectURL(ph.preview)))
      setPieces([])
      setResult(saved)
    } catch (err) {
      setError(err?.message || 'Could not save. Nothing was lost — try again.')
    } finally {
      setBusy(false)
    }
  }

  const input = {
    width: '100%', padding: '8px 10px', fontFamily: 'monospace', fontSize: '12px',
    border: '1px solid rgb(var(--color-warm-gray-light))', background: 'transparent',
    color: 'rgb(var(--color-ink))',
  }

  // ── Gates ─────────────────────────────────────────────────────────────────
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
          <button className="btn-outline" disabled={subBusy} onClick={async () => {
            setSubBusy(true); setError(null)
            try { await checkoutArtistSubscription({ customerEmail: user.email }) }
            catch (err) { setError(err?.message || 'Could not start checkout.'); setSubBusy(false) }
          }}>
            {subBusy ? 'Opening checkout…' : 'Join for $7.99/month'}
          </button>
          {error && <p role="alert" className="font-mono text-[12px] mt-4" style={{ color: '#b94040' }}>{error}</p>}
        </div>
        <Footer />
      </main>
    )
  }

  if (result != null) {
    return (
      <main className="pt-[60px]" style={{ minHeight: '100vh' }}>
        <div className="max-w-xl mx-auto px-6 py-24 text-center">
          <p className="text-[2.5rem] mb-4" aria-hidden>✓</p>
          <h1 className="font-serif text-[2rem] font-normal mb-3">
            {result} piece{result !== 1 ? 's' : ''} submitted.
          </h1>
          <p className="font-mono text-[13px] text-warm-gray leading-relaxed mb-10">
            Each goes to review before it appears in the shop and on your profile.
          </p>
          <div className="flex gap-3 justify-center flex-wrap">
            <button className="btn-outline" onClick={() => setResult(null)}>Upload More</button>
            <button className="btn-ghost" onClick={() => navigate(`/artists/${user.uid}`)}>View Profile</button>
          </div>
        </div>
        <Footer />
      </main>
    )
  }

  const readyCount = pieces.filter(p => p.title.trim() && p.photos.every(ph => !ph.uploading)).length

  // ── Upload ────────────────────────────────────────────────────────────────
  return (
    <main className="pt-[60px]" style={{ minHeight: '100vh' }}>
      <div className="max-w-3xl mx-auto px-6 py-16">

        <p className="eyebrow mb-4">Gallery upload</p>
        <h1 className="font-serif text-[clamp(1.8rem,4vw,2.4rem)] font-normal leading-tight mb-3">
          Add your work.
        </h1>
        <p className="font-mono text-[13px] text-warm-gray leading-relaxed mb-8 max-w-xl">
          Add photos and each one becomes its own piece. More than one photo of the
          same piece? Drag the extras onto that piece's card and they'll join it.
        </p>

        {/* Add photos — no `capture` attr, so iOS offers camera *or* library */}
        <label
          style={{
            display: 'block', padding: '28px 20px', textAlign: 'center', cursor: 'pointer',
            border: `1px dashed ${dragging && overCard == null ? 'rgb(var(--color-ink))' : 'rgb(var(--color-warm-gray-light))'}`,
            background: dragging && overCard == null ? 'rgb(var(--color-offwhite))' : 'transparent',
            transition: 'all 0.15s', marginBottom: 28,
          }}
        >
          <input
            type="file" accept="image/*" multiple
            onChange={e => { addFiles(e.target.files); e.target.value = '' }}
            style={{ display: 'none' }}
          />
          <span className="font-mono text-[13px] text-ink block mb-1">
            {dragging && overCard == null ? 'Drop to add' : 'Add photos'}
          </span>
          <span className="font-mono text-[11px] text-warm-gray block">
            Take a photo, choose from your camera roll, or drag files here
          </span>
        </label>

        {pieces.length === 0 ? (
          <p className="font-mono text-[12px] text-warm-gray text-center py-6">
            Nothing added yet.
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between mb-4 flex-wrap gap-2">
              <p className="eyebrow">{pieces.length} piece{pieces.length !== 1 ? 's' : ''}</p>
              <button
                type="button"
                onClick={() => {
                  pieces.forEach(p => p.photos.forEach(ph => ph.preview && URL.revokeObjectURL(ph.preview)))
                  setPieces([])
                }}
                className="font-mono text-[11px] text-warm-gray hover:text-ink bg-transparent border-0 cursor-pointer"
              >
                Clear all
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
              {pieces.map(piece => (
                <div
                  key={piece.id}
                  onDragEnter={e => { e.preventDefault(); e.stopPropagation(); setOverCard(piece.id) }}
                  onDragOver={e  => { e.preventDefault(); e.stopPropagation(); setOverCard(piece.id) }}
                  onDragLeave={e => { e.stopPropagation(); setOverCard(c => c === piece.id ? null : c) }}
                  onDrop={e => {
                    // Stop the window handler: these files belong to THIS piece,
                    // rather than becoming new ones.
                    e.preventDefault()
                    e.stopPropagation()
                    dragDepth.current = 0
                    setDragging(false)
                    setOverCard(null)
                    addFiles(e.dataTransfer.files, piece.id)
                  }}
                  style={{
                    border: `1px solid ${overCard === piece.id ? 'rgb(var(--color-ink))' : 'rgb(var(--color-warm-gray-light))'}`,
                    background: overCard === piece.id ? 'rgb(var(--color-offwhite))' : 'transparent',
                    padding: 12, display: 'flex', flexDirection: 'column', gap: 8,
                    transition: 'all 0.15s',
                  }}
                >
                  {/* Photos of this piece */}
                  <div className="flex gap-1.5 flex-wrap">
                    {piece.photos.map((ph, i) => (
                      <div key={i} style={{ position: 'relative', width: 62, height: 62 }}>
                        <img
                          src={ph.preview} alt=""
                          style={{
                            width: '100%', height: '100%', objectFit: 'cover',
                            border: '1px solid rgb(var(--color-warm-gray-light))',
                            opacity: ph.uploading ? 0.35 : 1,
                          }}
                        />
                        {ph.uploading && (
                          <span style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                            <Spinner size={12} />
                          </span>
                        )}
                        {!ph.uploading && (
                          <button
                            type="button" aria-label="Remove photo"
                            onClick={() => removePhoto(piece.id, i)}
                            style={{
                              position: 'absolute', top: -6, right: -6, width: 18, height: 18,
                              borderRadius: '50%', border: '1px solid rgb(var(--color-warm-gray-light))',
                              background: 'rgb(var(--color-cream))', cursor: 'pointer',
                              fontSize: 10, lineHeight: 1, color: 'rgb(var(--color-ink))', padding: 0,
                            }}
                          >×</button>
                        )}
                      </div>
                    ))}
                    {overCard === piece.id && (
                      <div style={{
                        width: 62, height: 62, display: 'grid', placeItems: 'center',
                        border: '1px dashed rgb(var(--color-ink))',
                        fontFamily: 'monospace', fontSize: 9, color: 'rgb(var(--color-ink))',
                        textAlign: 'center', padding: 4,
                      }}>ADD TO THIS PIECE</div>
                    )}
                  </div>

                  <input
                    style={{ ...input, fontSize: 13 }} value={piece.title} placeholder="Title"
                    onChange={e => update(piece.id, { title: e.target.value })}
                  />
                  <input
                    style={input} value={piece.medium} placeholder="Medium"
                    onChange={e => update(piece.id, { medium: e.target.value })}
                  />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <input
                      style={input} value={piece.size} placeholder="Size"
                      onChange={e => update(piece.id, { size: e.target.value })}
                    />
                    <input
                      style={input} value={piece.year} placeholder="Year"
                      type="number" min="1900" max="2100"
                      onChange={e => update(piece.id, { year: e.target.value })}
                    />
                  </div>
                  <input
                    style={input} value={piece.weightOz} placeholder="Weight (oz)"
                    type="number" min="0" step="0.1"
                    onChange={e => update(piece.id, { weightOz: e.target.value })}
                  />
                  <p className="font-mono text-[10px] text-warm-gray">by {artistName}</p>
                </div>
              ))}
            </div>

            <div className="border-t border-warm-gray-light mt-8 pt-6 flex items-center gap-4 flex-wrap">
              <button className="btn-outline" onClick={saveAll} disabled={busy || !readyCount}>
                {busy ? 'Saving…' : `Submit ${readyCount || ''} Piece${readyCount !== 1 ? 's' : ''}`.replace('  ', ' ')}
              </button>
              {readyCount < pieces.length && (
                <span className="font-mono text-[11px] text-warm-gray">
                  {pieces.length - readyCount} still need a title
                </span>
              )}
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="font-mono text-[12px] mt-4" style={{ color: '#b94040' }}>{error}</p>
        )}
      </div>
      <Footer />
    </main>
  )
}
