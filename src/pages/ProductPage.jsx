import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { collection, query, where, limit, getDocs } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useCart } from '../context/CartContext'
import { useToast } from '../hooks/useToast'
import Toast from '../components/Toast'
import Footer from '../components/Footer'
import { formatItemNumber } from '../data/storage'
import { normalizeProduct } from '../data/products'
import { fetchReviews, addReview, calcAverageRating } from '../data/reviews'
import { setPageMeta, resetPageMeta } from '../lib/meta'
import TreeOfLifeConfigurator from '../components/TreeOfLifeConfigurator'
import AudioPreview from '../components/AudioPreview'
import ReportListing from '../components/ReportListing'
import { useAuth } from '../context/AuthContext'
import { checkoutDeposit } from '../lib/stripe'
import Spinner from '../components/Spinner'

// ── Photo gallery ─────────────────────────────────────────────────────────────
function ProductGallery({ product }) {
  // Build ordered list of { url, label, wide }
  const slides = []
  const primaryURL = product.imageURL || product.image || ''

  const SLOT_LABELS_MAP = {
    'Vinyl':          ['Front Jacket', 'Back Jacket', 'Front Record', 'Back Record', 'Detail', 'Detail'],
    'CDs':            ['Front Case', 'Back Case', 'Disc', 'Insert', 'Detail', 'Detail'],
    'Cassette Tapes': ['Front', 'Back', 'Tape', 'Insert', 'Detail', 'Detail'],
    '8 Tracks':       ['Front', 'Back', 'Detail', 'Detail', 'Detail', 'Detail'],
  }
  const allURLs    = product.imageURLs?.length ? product.imageURLs : (primaryURL ? [primaryURL] : [])
  // Keyed on `type` ('Vinyl', 'CDs', …), not `category` — category is the broad
  // bucket ('Physical Media'), so keying on it made every lookup undefined and
  // left every product photo with alt="".
  const slotLabels = SLOT_LABELS_MAP[product.type] || SLOT_LABELS_MAP[product.category] || []
  allURLs.forEach((url, i) => {
    if (url) slides.push({ url, label: slotLabels[i] || '', wide: false })
  })

  // Gatefold spread — double wide
  if (product.gatefold && product.gatefoldURL) {
    slides.push({ url: product.gatefoldURL, label: 'Inside Spread', wide: true })
  }

  // Extra photos
  if (product.extraPhotos?.length) {
    product.extraPhotos.forEach(ep => {
      slides.push({ url: ep.url, label: ep.label || 'Detail', wide: false })
    })
  }

  const [active, setActive] = useState(0)
  const cur = slides[active] || null

  const prev = useCallback(() => setActive(a => (a - 1 + slides.length) % slides.length), [slides.length])
  const next = useCallback(() => setActive(a => (a + 1) % slides.length), [slides.length])

  if (!slides.length) {
    return (
      <div className="aspect-square bg-paper border border-warm-gray-light flex items-center justify-center">
        <span className="text-[6rem] select-none" aria-hidden="true">{product.emoji}</span>
      </div>
    )
  }

  return (
    <div>
      {/* Main image */}
      <div
        className="bg-paper border border-warm-gray-light overflow-hidden relative"
        style={{ aspectRatio: cur?.wide ? '2/1' : '1/1', transition: 'aspect-ratio 0.2s' }}
      >
        {cur && (
          <img
            key={cur.url}
            src={cur.url}
            alt={cur.label ? `${product.name} — ${cur.label}` : product.name}
            className="w-full h-full"
            style={{ objectFit: product.category === 'Physical Media' ? 'contain' : 'cover' }}
          />
        )}
        {product.sold && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(26,18,8,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <span className="font-mono text-[13px] tracking-[0.2em] uppercase border border-cream px-4 py-2" style={{ color: '#f5f0e8' }}>Sold</span>
          </div>
        )}
        {slides.length > 1 && (
          <>
            <button onClick={prev} aria-label="Previous photo" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '40px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '18px', color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>‹</span>
            </button>
            <button onClick={next} aria-label="Next photo" style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '40px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '18px', color: '#fff', textShadow: '0 1px 4px rgba(0,0,0,0.5)' }}>›</span>
            </button>
          </>
        )}
        {cur?.label && (
          <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '6px 10px', background: 'rgba(26,18,8,0.55)' }}>
            <p className="font-mono" style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#d4b870', margin: 0 }}>
              {cur.label}{cur.wide ? ' — Gatefold' : ''}
            </p>
          </div>
        )}
      </div>

      {/* Thumbnail strip */}
      {slides.length > 1 && (
        <div style={{ display: 'flex', gap: '4px', marginTop: '6px', flexWrap: 'wrap' }}>
          {slides.map((s, i) => (
            <button
              key={i}
              onClick={() => setActive(i)}
              style={{
                width: s.wide ? '68px' : '40px', height: '40px', padding: 0, border: 'none',
                outline: active === i ? '2px solid #a08060' : '1px solid transparent',
                outlineOffset: '1px', cursor: 'pointer', overflow: 'hidden', flexShrink: 0,
              }}
            >
              <img src={s.url} alt={s.label ? `${product.name} — ${s.label}` : product.name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Stars display helper ──────────────────────────────────────────────────────
function Stars({ value, max = 5, color = '#b97a30', emptyColor = '#a08060', size = 16 }) {
  return (
    <span aria-label={`${value} out of ${max} stars`} style={{ display: 'inline-flex', gap: '1px' }}>
      {Array.from({ length: max }, (_, i) => (
        <span key={i} style={{ fontSize: size, color: i < Math.round(value) ? color : emptyColor, lineHeight: 1 }}>★</span>
      ))}
    </span>
  )
}

// ── Review section ────────────────────────────────────────────────────────────
function ReviewSection({ productId }) {
  const { user, profile } = useAuth()
  const [reviews,    setReviews]    = useState([])
  const [revLoading, setRevLoading] = useState(true)
  const [rating,     setRating]     = useState(0)
  const [hovered,    setHovered]    = useState(0)
  const [comment,    setComment]    = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted,  setSubmitted]  = useState(false)
  const [revError,   setRevError]   = useState('')

  useEffect(() => {
    fetchReviews(productId)
      .then(setReviews)
      .catch(() => {})
      .finally(() => setRevLoading(false))
  }, [productId])

  const avg    = calcAverageRating(reviews)
  const hasOwn = user && reviews.some(r => r.uid === user.uid)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!rating || submitting) return
    setSubmitting(true)
    setRevError('')
    try {
      await addReview(productId, {
        uid:         user.uid,
        displayName: profile?.name || user.displayName || 'Anonymous',
        rating,
        comment: comment.trim(),
      })
      const updated = await fetchReviews(productId)
      setReviews(updated)
      setRating(0)
      setComment('')
      setSubmitted(true)
      setTimeout(() => setSubmitted(false), 3000)
    } catch (err) {
      setRevError('Something went wrong. Try again.')
      console.error('Review error:', err)
    } finally {
      setSubmitting(false)
    }
  }

  const ratingLabels = ['', 'Terrible', 'Poor', 'OK', 'Good', 'Excellent']

  return (
    <div style={{ borderTop: '1px solid #e8e0d4', marginTop: '64px', paddingTop: '48px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', marginBottom: '28px', flexWrap: 'wrap' }}>
        <h2 className="font-serif" style={{ fontSize: '1.5rem', fontWeight: 400, margin: 0 }}>Reviews</h2>
        {avg !== null && (
          <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#3d2810', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Stars value={avg} size={13} />
            <span style={{ color: '#8a7060' }}>{avg.toFixed(1)} · {reviews.length} {reviews.length === 1 ? 'review' : 'reviews'}</span>
          </span>
        )}
        {avg === null && !revLoading && (
          <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#8a7060' }}>No reviews yet</span>
        )}
      </div>

      {/* Write-a-review form */}
      {user && !hasOwn && (
        <form onSubmit={handleSubmit} style={{ marginBottom: '36px', padding: '20px', border: '1px solid #e8e0d4', background: '#faf8f4' }}>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#3d2810', marginBottom: '14px' }}>
            Leave a Review
          </p>

          {/* Star picker */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '2px', marginBottom: '14px' }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n} type="button"
                onMouseEnter={() => setHovered(n)}
                onMouseLeave={() => setHovered(0)}
                onClick={() => setRating(n)}
                aria-label={`${n} star${n > 1 ? 's' : ''}`}
                style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '28px', padding: '0 1px', lineHeight: 1, color: n <= (hovered || rating) ? '#b97a30' : '#a08060', transition: 'color 0.1s' }}
              >
                ★
              </button>
            ))}
            {(hovered || rating) > 0 && (
              <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#3d2810', marginLeft: '8px' }}>
                {ratingLabels[hovered || rating]}
              </span>
            )}
          </div>

          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            placeholder="What did you think? (optional)"
            style={{
              width: '100%', fontFamily: 'monospace', fontSize: '13px',
              padding: '10px 12px', border: '1px solid #d4c9bb',
              background: '#fff', color: '#1a1208', outline: 'none',
              resize: 'vertical', minHeight: '80px', marginBottom: '14px',
              boxSizing: 'border-box',
            }}
          />

          {revError && (
            <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#b94040', marginBottom: '10px' }}>{revError}</p>
          )}

          <button
            type="submit"
            disabled={!rating || submitting}
            className="btn-outline"
            style={{ display: 'inline-block', opacity: (!rating || submitting) ? 0.5 : 1, cursor: (!rating || submitting) ? 'not-allowed' : 'pointer' }}
          >
            {submitting ? 'Posting…' : submitted ? 'Posted ✓' : 'Post Review'}
          </button>
        </form>
      )}

      {user && hasOwn && (
        <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#3d2810', marginBottom: '24px' }}>
          You've reviewed this product.
        </p>
      )}

      {!user && (
        <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#3d2810', marginBottom: '24px' }}>
          <a href="/account" style={{ color: '#1a1208', textDecoration: 'underline' }}>Sign in</a> to leave a review.
        </p>
      )}

      {/* Review list */}
      {revLoading ? (
        <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#8a7060' }}>Loading reviews…</p>
      ) : reviews.length > 0 ? (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {reviews.map(r => (
            <li key={r.id} style={{ borderBottom: '1px solid #e8e0d4', paddingBottom: '18px', marginBottom: '18px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px', flexWrap: 'wrap', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#1a1208', fontWeight: 500 }}>{r.displayName}</span>
                  <Stars value={r.rating} size={12} />
                </div>
                {r.createdAt?.toDate && (
                  <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a7060' }}>
                    {r.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                )}
              </div>
              {r.comment && (
                <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#3d2810', margin: 0, lineHeight: 1.7 }}>
                  {r.comment}
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export default function ProductPage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [product,    setProduct]    = useState(null)
  const [loading,    setLoading]    = useState(true)

  useEffect(() => {
    setLoading(true)
    // Resolve the one product by slug instead of downloading the whole catalog.
    getDocs(query(collection(db, 'products'), where('slug', '==', slug), limit(1)))
      .then(snap => setProduct(snap.empty ? null : normalizeProduct({ id: snap.docs[0].id, ...snap.docs[0].data() })))
      .catch(() => setProduct(null))
      .finally(() => setLoading(false))
  }, [slug])

  const { addToCart } = useCart()
  const { toast, showToast } = useToast()
  const { user, placeOrder } = useAuth()
  const [added,        setAdded]        = useState(false)
  const [depositBusy,  setDepositBusy]  = useState(false)
  const [depositError, setDepositError] = useState(null)
  const [copied,       setCopied]       = useState(false)

  useEffect(() => {
    if (!product) return
    setPageMeta({
      title:       `${product.name} — Art Saturated`,
      description: product.description
        ? product.description.slice(0, 160)
        : `${product.category} · $${product.price} · Art Saturated`,
      image:       product.imageURL || product.image || undefined,
      url:         window.location.href,
    })
    return () => resetPageMeta()
  }, [product])

  if (loading) {
    return (
      <main className="pt-[60px] flex items-center justify-center min-h-screen px-6">
        <Spinner size={20} color="#3d2810" />
      </main>
    )
  }

  // 404 state
  if (!product) {
    return (
      <main className="pt-[60px] flex flex-col items-center justify-center min-h-screen px-6">
        <p className="font-serif text-[2rem] font-normal mb-4">Not found.</p>
        <button className="btn-outline" onClick={() => navigate('/shop')}>
          Back to Shop
        </button>
      </main>
    )
  }

  function handleAddToCart() {
    addToCart(product)
    showToast('Added to cart')
    setAdded(true)
    setTimeout(() => setAdded(false), 1600)
  }


  // ── Stock helpers ──────────────────────────────────────────────────────────
  const stockNum   = (product.stock != null && product.stock !== '') ? Number(product.stock) : null
  // Hidden by the artist, taken down, or parked: reachable by link but not for
  // sale. Checkout refuses these server-side too; this just says so up front.
  const unlisted   = product.active === false || !!product.inBucket || product.moderation === 'removed'
  const outOfStock = unlisted || (stockNum !== null && stockNum <= 0)
  const lowStock   = stockNum !== null && stockNum > 0 && stockNum <= 5

  // ── Deposit handler ────────────────────────────────────────────────────────
  async function handleDeposit() {
    if (!user) { navigate('/login', { state: { from: location.pathname } }); return }
    setDepositBusy(true)
    setDepositError(null)
    try {
      // Create a pending order for just this item, then redirect to deposit Stripe session
      const orderId = await placeOrder(
        [{ ...product, qty: 1 }],
        product.price,
        'ship',
        0,
      )
      await checkoutDeposit({
        customerEmail: user.email,
        orderId,
        productId:   product.id,
        productName: product.name,
      })
    } catch (err) {
      setDepositError(err.message || 'Something went wrong')
    } finally {
      setDepositBusy(false)
    }
  }

  return (
    <main className="pt-[60px]">
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Back link */}
        <button
          onClick={() => navigate('/shop')}
          className="font-mono text-[11px] tracking-[0.1em] uppercase text-warm-gray
                     bg-transparent border-0 cursor-pointer mb-10 inline-block
                     hover:text-ink transition-colors"
        >
          ← Back to Shop
        </button>

        {/* ── Two-column layout ─────────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 md:gap-20 items-start">
          {/* Gallery */}
          <ProductGallery product={product} />

          {/* Details */}
          <div>
            <div className="flex items-center gap-3 mb-3 flex-wrap">
              <p className="eyebrow">{product.category}</p>
              {product.itemNumber && (
                <p className="font-mono text-[10px] tracking-[0.1em] text-warm-gray">
                  {formatItemNumber(product.itemNumber)}
                </p>
              )}
              {product.sold || outOfStock ? (
                <span className="font-mono text-[10px] tracking-[0.12em] uppercase border border-warm-gray-light px-2 py-0.5 text-warm-gray">
                  {product.sold ? 'Sold' : unlisted ? 'Not available' : 'Out of Stock'}
                </span>
              ) : lowStock ? (
                <span className="font-mono text-[10px] tracking-[0.12em] uppercase border border-earth px-2 py-0.5 text-earth">
                  Only {stockNum} left
                </span>
              ) : null}
            </div>

            <h1 className="font-serif text-[2rem] font-normal leading-tight mb-2">
              {product.name}
            </h1>

            {/* Seller attribution — shown when listing was submitted by an artist */}
            {product.artistName && (
              <p className="font-mono text-[11px] text-warm-gray mb-3">
                Sold by <span className="text-ink">{product.artistName}</span>
              </p>
            )}

            {/* Artist profile link — sellerId is the submitter's UID (reliable);
                fall back to artistUid for admin-added products without a submission */}
            {(product.sellerId || product.artistUid) && (
              <button
                onClick={() => navigate(`/artists/${product.sellerId || product.artistUid}`)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', color: '#7a5030', borderBottom: '1px solid #a08060', paddingBottom: '1px', marginBottom: '16px', display: 'inline-block' }}
              >
                View artist profile ↗
              </button>
            )}

            <p className="font-mono text-[1.1rem] text-ink mb-4" style={{ textDecoration: product.sold ? 'line-through' : 'none', opacity: product.sold ? 0.5 : 1 }}>
              ${product.price}
            </p>

            {/* Spec tags */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] tracking-[0.1em] uppercase text-warm-gray mb-6">
              {(product.details || []).map((d, i) => (
                <span key={i} className="flex items-center gap-3">
                  {i > 0 && <span className="text-earth-light">·</span>}
                  {d}
                </span>
              ))}
            </div>

            {/* Cross-format versions (Physical Media) */}
            {product.crossListings?.length > 0 && (
              <div className="mb-5">
                <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-warm-gray mb-2">
                  Also available as
                </p>
                <div className="flex flex-wrap gap-2">
                  {product.crossListings.map(cl => (
                    <button
                      key={cl.id}
                      onClick={() => navigate(`/shop/${cl.slug}`)}
                      className="font-mono text-[11px] tracking-[0.08em] uppercase border border-warm-gray-light bg-transparent px-3 py-1.5 cursor-pointer hover:border-ink hover:text-ink transition-colors"
                    >
                      {cl.type || cl.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* QR code — Physical Media with a digital/stream link */}
            {product.category === 'Physical Media' && product.digitalUrl && (
              <div className="mb-5 flex items-center gap-4 border border-warm-gray-light px-4 py-4">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=88x88&data=${encodeURIComponent(product.digitalUrl)}`}
                  alt="QR code — scan to stream"
                  width={88}
                  height={88}
                  loading="lazy"
                  style={{ flexShrink: 0, imageRendering: 'pixelated' }}
                />
                <div>
                  <p className="font-mono text-[10px] tracking-[0.1em] uppercase text-warm-gray mb-1">Stream / Listen</p>
                  <a
                    href={product.digitalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[12px] text-ink underline hover:text-earth transition-colors"
                  >
                    Open digital version ↗
                  </a>
                  <p className="font-mono text-[10px] text-warm-gray mt-1">or scan the QR code</p>
                </div>
              </div>
            )}

            {/* Description */}
            <div className="border-t border-warm-gray-light pt-6 mb-6">
              <p className="font-mono text-[13px] text-warm-gray leading-loose">
                {product.description}
              </p>
            </div>

            {/* Track previews — renders nothing unless the product has audio */}
            <AudioPreview tracks={product.previewTracks || []} />

            {/* One-of-a-kind notice */}
            {product.unique && (
              <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-earth mb-6">
                ↳ One of a kind — once it's gone, it's gone
              </p>
            )}

            {/* Shipping estimate */}
            {!product.sold && (
              <div className="border border-warm-gray-light px-4 py-3 mb-6">
                <p className="font-mono text-[11px] tracking-[0.08em] text-warm-gray">
                  🚚 Ships in <strong className="text-ink">3–7 business days</strong>
                  {' '}· <strong className="text-ink">shipping by weight</strong>, live rates at checkout
                </p>
                <p className="font-mono text-[10px] text-warm-gray mt-1">
                  Online only · outside the US, message us for a quote
                </p>
              </div>
            )}

            {/* Configurator or standard add-to-cart */}
            {product.sold || outOfStock ? (
              <div className="w-full font-mono text-[11px] tracking-[0.15em] uppercase border border-warm-gray-light text-warm-gray py-4 text-center mb-3">
                {product.sold ? 'This item has been sold' : unlisted ? 'Not available right now' : 'Out of Stock'}
              </div>
            ) : product.configurator === 'tree-of-life' ? (
              <TreeOfLifeConfigurator />
            ) : (
              <>
                <button
                  onClick={handleAddToCart}
                  className={`w-full font-mono text-[11px] tracking-[0.15em] uppercase
                             border py-4 cursor-pointer transition-all duration-200 mb-3
                             ${added
                               ? 'bg-ink text-offwhite border-ink'
                               : 'border-ink text-ink bg-transparent hover:bg-ink hover:text-offwhite'
                             }`}
                >
                  {added ? 'Added ✓' : 'Add to Cart'}
                </button>

                {/* Deposit button — shown when product opts in */}
                {product.acceptsDeposit && product.depositAmount > 0 && (
                  <>
                    {depositError && (
                      <p className="font-mono text-[10px] text-red-500 mb-2 text-center">{depositError}</p>
                    )}
                    <button
                      onClick={handleDeposit}
                      disabled={depositBusy}
                      className="w-full font-mono text-[11px] tracking-[0.15em] uppercase
                                 border border-earth text-earth bg-transparent
                                 py-4 cursor-pointer transition-all duration-200 mb-3
                                 hover:bg-earth hover:text-offwhite
                                 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {depositBusy
                        ? 'Redirecting…'
                        : `Reserve with Deposit — $${Number(product.depositAmount).toFixed(2)}`
                      }
                    </button>
                  </>
                )}

                <button
                  onClick={() => navigate('/cart')}
                  className="w-full font-mono text-[11px] tracking-[0.15em] uppercase
                             border border-warm-gray-light text-warm-gray bg-transparent
                             py-4 cursor-pointer transition-all duration-200
                             hover:border-ink hover:text-ink mb-3"
                >
                  View Cart
                </button>


                {/* Marketplace disclaimer — shown for artist-submitted listings */}
                {product.artistName && (
                  <p className="font-mono text-[10px] text-warm-gray leading-relaxed mt-4 pt-4"
                     style={{ borderTop: '1px solid #e8ddd0' }}>
                    Sold and fulfilled by <span className="text-ink">{product.artistName}</span> · Art Saturated facilitates payment only
                  </p>
                )}
              </>
            )}

            {/* Share strip — always visible regardless of sold/stock state */}
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(window.location.href)
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                }}
                className="flex-1 font-mono text-[11px] tracking-[0.1em] uppercase
                           border border-warm-gray-light bg-transparent
                           py-3 cursor-pointer transition-all duration-200
                           hover:border-ink hover:text-ink"
                style={{ color: copied ? '#3a7a40' : undefined }}
              >
                {copied ? 'Copied ✓' : '⎘ Copy'}
              </button>
              <button
                onClick={() => window.open(
                  `https://x.com/intent/tweet?text=${encodeURIComponent(`Check out "${product.name}" on Art Saturated`)}&url=${encodeURIComponent(window.location.href)}`,
                  '_blank', 'noopener,noreferrer'
                )}
                className="flex-1 font-mono text-[11px] tracking-[0.1em] uppercase
                           border border-warm-gray-light bg-transparent
                           py-3 cursor-pointer transition-all duration-200
                           hover:border-ink hover:text-ink"
                aria-label="Share on X"
              >
                Post on X
              </button>
              <button
                onClick={() => window.open(
                  `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(window.location.href)}`,
                  '_blank', 'noopener,noreferrer'
                )}
                className="flex-1 font-mono text-[11px] tracking-[0.1em] uppercase
                           border border-warm-gray-light bg-transparent
                           py-3 cursor-pointer transition-all duration-200
                           hover:border-ink hover:text-ink"
                aria-label="Share on Facebook"
              >
                Facebook
              </button>
            </div>

            <ReportListing product={product} />
          </div>
        </div>

        {/* Reviews */}
        <ReviewSection productId={product.id} />
      </div>

      <Footer />
      <Toast message={toast.message} visible={toast.visible} />
    </main>
  )
}
