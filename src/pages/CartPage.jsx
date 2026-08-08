import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/AuthContext'
import { checkoutCart } from '../lib/stripe'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'

// Fallback shipping tiers (oz → price)
const DEFAULT_TIERS = [4.99, 7.99, 12.99, 18.99]
const DEFAULT_TAX   = 0.07

export default function CartPage() {
  useEffect(() => { document.title = 'Your Cart — Art Saturated'; return () => { document.title = 'Art Saturated' } }, [])
  const navigate = useNavigate()
  const { cart, cartTotal, updateQty, removeFromCart, clearCart, atMax, hydrateCart } = useCart()
  const { user, profile, placeOrder } = useAuth()

  const [method,           setMethod]           = useState('ship')
  const [loading,          setLoading]          = useState(false)
  const [status,           setStatus]           = useState('')
  const [error,            setError]            = useState(null)
  const [storeConfig,      setStoreConfig]      = useState(null)
  const [validationBanner, setValidationBanner] = useState(null)
  const [addr,             setAddr]             = useState({ name: '', street1: '', street2: '', city: '', state: '', zip: '', phone: '' })
  const [addrError,        setAddrError]        = useState(null)

  useEffect(() => {
    getDoc(doc(db, 'settings', 'storeConfig'))
      .then(snap => { if (snap.exists()) setStoreConfig(snap.data()) })
      .catch(() => {})
  }, [])

  // Pre-fill name from profile
  useEffect(() => {
    if (profile?.name) setAddr(a => a.name ? a : { ...a, name: profile.name })
  }, [profile?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (cart.length === 0) return
    let cancelled = false
    async function validate() {
      const removed = [], updated = []
      const fresh = await Promise.all(
        cart.map(async (item) => {
          try {
            const snap = await getDoc(doc(db, 'products', item.id))
            if (!snap.exists()) { removed.push(item.name); return null }
            const p = snap.data()
            if (p.sold) { removed.push(item.name); return null }
            const stock = (p.stock != null && p.stock !== '') ? Number(p.stock) : null
            if (stock !== null && stock <= 0) { removed.push(item.name); return null }
            const maxQty  = stock !== null ? stock : Infinity
            const newPrice = Number(p.price)
            if (newPrice !== item.price) updated.push(item.name)
            return { ...item, price: newPrice, stock: p.stock, qty: Math.min(item.qty, maxQty) }
          } catch { return item }
        })
      )
      if (cancelled) return
      const valid = fresh.filter(Boolean)
      hydrateCart(valid)
      if (removed.length || updated.length) {
        const parts = []
        if (removed.length) parts.push(`${removed.join(', ')} ${removed.length === 1 ? 'is' : 'are'} no longer available and ${removed.length === 1 ? 'was' : 'were'} removed`)
        if (updated.length) parts.push(`${updated.join(', ')} ${updated.length === 1 ? 'has' : 'have'} an updated price`)
        setValidationBanner(parts.join('. ') + '.')
      }
    }
    validate()
    return () => { cancelled = true }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const isEmpty = cart.length === 0

  const totalWeightOz = useMemo(
    () => cart.reduce((sum, i) => sum + (Number(i.weightOz) || 0) * i.qty, 0),
    [cart],
  )

  const tiers    = storeConfig?.shippingTiers ?? DEFAULT_TIERS
  const TAX_RATE = storeConfig?.taxRate ?? DEFAULT_TAX
  const bundleDeal = storeConfig?.bundleDeal

  function calcShipping(oz) {
    if (oz <= 0)  return 0
    if (oz <= 8)  return tiers[0]
    if (oz <= 16) return tiers[1]
    if (oz <= 48) return tiers[2]
    return tiers[3]
  }

  const physMediaQty = useMemo(
    () => cart.filter(i => i.category === 'Physical Media').reduce((s, i) => s + i.qty, 0),
    [cart],
  )
  const physMediaSubtotal = useMemo(
    () => cart.filter(i => i.category === 'Physical Media').reduce((s, i) => s + i.price * i.qty, 0),
    [cart],
  )
  const bundleDiscount = useMemo(() => {
    if (!bundleDeal?.enabled || physMediaQty < (bundleDeal.minQty ?? 2)) return 0
    return parseFloat((physMediaSubtotal * (bundleDeal.discountPct ?? 10) / 100).toFixed(2))
  }, [bundleDeal, physMediaQty, physMediaSubtotal])

  const shippingCost = method === 'pickup' ? 0 : calcShipping(totalWeightOz)
  const taxAmount    = parseFloat((cartTotal * TAX_RATE).toFixed(2))
  const orderTotal   = cartTotal + shippingCost + taxAmount - bundleDiscount

  async function handleCheckout(chosenMethod) {
    // Send them to sign-in with a return path, not to /account — landing on the
    // profile page stranded the buyer away from the cart and lost the shipping
    // address they had just typed.
    if (!user) { navigate('/login', { state: { from: '/cart' } }); return }

    // Validate shipping address for ship orders
    if (chosenMethod === 'ship') {
      const { name, street1, city, state, zip } = addr
      if (!name.trim() || !street1.trim() || !city.trim() || !state.trim() || !zip.trim()) {
        setAddrError('Please fill in all required address fields.')
        return
      }
      setAddrError(null)
    }

    setLoading(true)
    setError(null)
    setStatus('Creating order…')
    try {
      const cost    = chosenMethod === 'pickup' ? 0 : shippingCost
      const shipAddr = chosenMethod === 'ship' ? { ...addr, country: 'US' } : null
      const orderId = await placeOrder(cart, cartTotal, chosenMethod, cost, taxAmount, shipAddr, bundleDiscount)
      setStatus('Connecting to payment…')
      await checkoutCart({
        items:          cart,
        customerEmail:  user.email,
        orderId,
        shippingCost:   cost,
        taxAmount,
        shippingMethod: chosenMethod,
        bundleDiscount,
      })
      // Deliberately NOT clearing the cart here. checkoutCart redirects to
      // Stripe, and clearing at redirect time emptied the cart of anyone who
      // reached Stripe and backed out — they returned to an empty cart and had
      // to start over. PaymentSuccess clears it once payment actually lands.
    } catch (err) {
      const detail = err?.details || err?.message || err?.code || 'Unknown error'
      setError(String(detail))
      setStatus('')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="pt-[60px]" style={{ background: 'rgb(var(--color-cream))', minHeight: '100vh' }}>
      <div className="max-w-2xl mx-auto px-6 py-12">
        <h1 className="font-serif text-[2rem] font-normal mb-10">Your Cart</h1>

        {validationBanner && (
          <div className="flex items-start justify-between gap-4 border border-warm-gray-light bg-paper px-4 py-3 mb-6 font-mono text-[12px] text-ink">
            <span>{validationBanner}</span>
            <button onClick={() => setValidationBanner(null)} className="shrink-0 text-warm-gray hover:text-ink bg-transparent border-0 cursor-pointer font-mono text-[12px]">✕</button>
          </div>
        )}

        {/* ── Empty state ─────────────────────────────────────────────────── */}
        {isEmpty ? (
          <div className="flex flex-col items-center py-20 gap-5">
            <span className="font-serif text-[3rem] text-warm-gray-light" aria-hidden>○</span>
            <p className="font-mono text-[13px] text-warm-gray">Nothing here yet.</p>
            <button className="btn-outline mt-4" onClick={() => navigate('/shop')}>
              Browse Shop
            </button>
          </div>
        ) : (
          <>
            {/* ── Cart items ──────────────────────────────────────────────── */}
            <ul className="divide-y divide-warm-gray-light">
              {cart.map((item) => (
                <li key={item.id} className="grid grid-cols-[64px_1fr_auto] gap-4 py-5 items-start">
                  {/* Thumbnail */}
                  <div className="w-16 h-16 bg-paper border border-warm-gray-light flex items-center justify-center overflow-hidden flex-shrink-0">
                    {(item.imageURL || item.image)
                      ? <img src={item.imageURL || item.image} alt={item.name} className="w-full h-full object-cover" />
                      : <span className="text-2xl" aria-hidden="true">{item.emoji}</span>
                    }
                  </div>

                  {/* Name + qty controls */}
                  <div>
                    <p className="font-serif text-[1rem] font-normal mb-0.5 leading-snug">
                      {item.name}
                    </p>
                    <p className="font-mono text-[12px] text-warm-gray mb-3">
                      ${Number(item.price || 0).toFixed(2)} each
                    </p>

                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => updateQty(item.id, -1)}
                        className="w-6 h-6 border border-warm-gray-light text-ink bg-transparent
                                   cursor-pointer text-sm flex items-center justify-center
                                   hover:border-ink transition-colors"
                        aria-label="Decrease quantity"
                      >−</button>

                      <span className="font-mono text-[13px] min-w-[16px] text-center">
                        {item.qty}
                      </span>

                      <button
                        onClick={() => updateQty(item.id, +1)}
                        disabled={atMax(item.id)}
                        className="w-6 h-6 border border-warm-gray-light text-ink bg-transparent
                                   cursor-pointer text-sm flex items-center justify-center
                                   hover:border-ink transition-colors
                                   disabled:opacity-30 disabled:cursor-not-allowed"
                        aria-label="Increase quantity"
                      >+</button>

                      <button
                        onClick={() => removeFromCart(item.id)}
                        className="font-mono text-[10px] tracking-[0.1em] uppercase text-warm-gray
                                   bg-transparent border-0 cursor-pointer ml-3 hover:text-ink transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {/* Line total */}
                  <p className="font-mono text-[14px] text-ink mt-0.5">
                    ${(Number(item.price || 0) * item.qty).toFixed(2)}
                  </p>
                </li>
              ))}
            </ul>

            {/* ── Delivery method ─────────────────────────────────────────── */}
            <div className="border-t border-warm-gray-light pt-6 mt-2 mb-5">
              <p className="font-mono text-[11px] tracking-[0.12em] uppercase text-warm-gray mb-3">
                Delivery Method
              </p>
              <div className="flex gap-3">
                {[
                  { id: 'ship',   label: 'Ship to Me' },
                  { id: 'pickup', label: 'Local Pickup' },
                ].map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setMethod(opt.id)}
                    className={`flex-1 font-mono text-[11px] tracking-[0.1em] uppercase py-3 border
                                transition-all duration-150
                                ${method === opt.id
                                  ? 'bg-ink text-offwhite border-ink'
                                  : 'border-warm-gray-light text-warm-gray bg-transparent hover:border-ink hover:text-ink'
                                }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <p className="font-mono text-[11px] text-warm-gray mt-2">
                {method === 'ship' && totalWeightOz > 0 &&
                  `~${totalWeightOz.toFixed(1)} oz total · est. shipping $${shippingCost.toFixed(2)}`
                }
                {method === 'ship' && totalWeightOz === 0 &&
                  'Free shipping on this order'
                }
                {method === 'pickup' &&
                  'Free local pickup · 3945 Parnell Ave, Fort Wayne IN · We\'ll contact you when ready'
                }
              </p>
            </div>

            {/* ── Shipping address (ship orders only) ─────────────────────── */}
            {method === 'ship' && (
              <div className="border-t border-warm-gray-light pt-6 mb-5">
                <p className="font-mono text-[11px] tracking-[0.12em] uppercase text-warm-gray mb-4">
                  Ship To
                </p>
                <div className="flex flex-col gap-3">
                  {/* Full name */}
                  <input
                    type="text" placeholder="Full name *" value={addr.name}
                    onChange={e => setAddr(a => ({ ...a, name: e.target.value }))}
                    className="font-mono text-[13px] px-3 py-2 border border-warm-gray-light bg-paper text-ink outline-none focus:border-ink w-full"
                  />
                  {/* Street */}
                  <input
                    type="text" placeholder="Street address *" value={addr.street1}
                    onChange={e => setAddr(a => ({ ...a, street1: e.target.value }))}
                    className="font-mono text-[13px] px-3 py-2 border border-warm-gray-light bg-paper text-ink outline-none focus:border-ink w-full"
                  />
                  <input
                    type="text" placeholder="Apt, suite, unit (optional)" value={addr.street2}
                    onChange={e => setAddr(a => ({ ...a, street2: e.target.value }))}
                    className="font-mono text-[13px] px-3 py-2 border border-warm-gray-light bg-paper text-ink outline-none focus:border-ink w-full"
                  />
                  {/* City / State / ZIP */}
                  <div className="grid grid-cols-[1fr_80px_100px] gap-2">
                    <input
                      type="text" placeholder="City *" value={addr.city}
                      onChange={e => setAddr(a => ({ ...a, city: e.target.value }))}
                      className="font-mono text-[13px] px-3 py-2 border border-warm-gray-light bg-paper text-ink outline-none focus:border-ink"
                    />
                    <input
                      type="text" placeholder="State *" maxLength={2} value={addr.state}
                      onChange={e => setAddr(a => ({ ...a, state: e.target.value.toUpperCase() }))}
                      className="font-mono text-[13px] px-3 py-2 border border-warm-gray-light bg-paper text-ink outline-none focus:border-ink uppercase"
                    />
                    <input
                      type="text" placeholder="ZIP *" maxLength={10} value={addr.zip}
                      onChange={e => setAddr(a => ({ ...a, zip: e.target.value }))}
                      className="font-mono text-[13px] px-3 py-2 border border-warm-gray-light bg-paper text-ink outline-none focus:border-ink"
                    />
                  </div>
                  {/* Phone */}
                  <input
                    type="tel" placeholder="Phone (for carrier)" value={addr.phone}
                    onChange={e => setAddr(a => ({ ...a, phone: e.target.value }))}
                    className="font-mono text-[13px] px-3 py-2 border border-warm-gray-light bg-paper text-ink outline-none focus:border-ink w-full"
                  />
                </div>
                {addrError && (
                  <p className="font-mono text-[11px] text-red-500 mt-2">{addrError}</p>
                )}
              </div>
            )}

            {/* ── Order summary ───────────────────────────────────────────── */}
            <div className="border-t border-ink pt-6">
              <div className="space-y-2 mb-5">
                <div className="flex justify-between font-mono text-[12px] text-warm-gray">
                  <span>Subtotal</span>
                  <span>${cartTotal.toFixed(2)}</span>
                </div>
                {method === 'ship' && (
                  <div className="flex justify-between font-mono text-[12px] text-warm-gray">
                    <span>Shipping</span>
                    <span>{shippingCost > 0 ? `$${shippingCost.toFixed(2)}` : 'Free'}</span>
                  </div>
                )}
                <div className="flex justify-between font-mono text-[12px] text-warm-gray">
                  <span>Tax ({Math.round((storeConfig?.taxRate ?? DEFAULT_TAX) * 100)}%)</span>
                  <span>${taxAmount.toFixed(2)}</span>
                </div>
                {bundleDiscount > 0 && (
                  <div className="flex justify-between font-mono text-[12px]" style={{ color: '#b97a30' }}>
                    <span>Bundle deal ({bundleDeal.discountPct}% off Physical Media)</span>
                    <span>−${bundleDiscount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between items-baseline pt-2 border-t border-warm-gray-light">
                  <span className="font-mono text-[11px] tracking-[0.12em] uppercase text-warm-gray">
                    Total
                  </span>
                  <span className="font-serif text-[1.6rem] font-normal">
                    ${orderTotal.toFixed(2)}
                  </span>
                </div>
              </div>

              {status && !error && (
                <p className="font-mono text-[11px] text-warm-gray mb-3 text-center">{status}</p>
              )}
              {error && (
                <p className="font-mono text-[11px] text-red-500 mb-4 text-center">{error}</p>
              )}

              {/* Login gate — return to the cart after signing in, not /account,
                  so the buyer keeps their items and typed address. */}
              {!user ? (
                <div className="text-center py-2">
                  <p className="font-mono text-[12px] text-warm-gray mb-4">
                    Sign in to complete your purchase
                  </p>
                  <button
                    className="btn-ghost w-full"
                    onClick={() => navigate('/login', { state: { from: '/cart' } })}
                  >
                    Sign In / Create Account
                  </button>
                </div>
              ) : method === 'ship' ? (
                <button
                  onClick={() => handleCheckout('ship')}
                  disabled={loading}
                  className="btn-ghost w-full text-center mb-3
                             disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? <span className="flex items-center justify-center gap-2"><Spinner />{status || 'Processing…'}</span> : `Pay $${orderTotal.toFixed(2)} — Secure Checkout`}
                </button>
              ) : (
                <button
                  onClick={() => handleCheckout('pickup')}
                  disabled={loading}
                  className="btn-ghost w-full text-center mb-3
                             disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? <span className="flex items-center justify-center gap-2"><Spinner />{status || 'Processing…'}</span> : `Reserve for Pickup — Pay $${orderTotal.toFixed(2)}`}
                </button>
              )}

              <p className="font-mono text-[11px] text-center text-warm-gray tracking-wide">
                Secure payment via Stripe
              </p>

              {/* First-purchase reassurance — a one-person shop asking a stranger
                  for a card needs to answer "what if something's wrong?" up front.
                  Deliberately no invented return window; just a real human to reach. */}
              <p className="font-mono text-[10px] text-center text-warm-gray tracking-wide mt-3 leading-relaxed">
                Ships in 3–7 business days · Questions or an issue? Email{' '}
                <a href="mailto:zionomari@artsaturated.com" className="underline hover:text-ink">
                  zionomari@artsaturated.com
                </a>
              </p>
            </div>
          </>
        )}
      </div>

      <Footer />
    </main>
  )
}
