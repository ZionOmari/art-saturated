import { useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useCart } from '../context/CartContext'
import Footer from '../components/Footer'

export default function PaymentSuccess() {
  const [params]   = useSearchParams()
  const navigate   = useNavigate()
  const { clearCart } = useCart()
  const type    = params.get('type')    // 'order' | 'deposit' | 'cd_order'
  const orderId = params.get('orderId')

  // The cart is emptied here rather than at redirect time, so abandoning at the
  // Stripe page leaves it intact to come back to.
  useEffect(() => {
    if (type !== 'order') return
    clearCart()
  }, [type]) // eslint-disable-line react-hooks/exhaustive-deps

  // Fire a GA4 `purchase` event so Google Ads can count sales as conversions.
  // De-duped per order; value enriched from the order doc when readable.
  useEffect(() => {
    if (!window.gtag) return
    if (!(type === 'order' || type === 'deposit' || type === 'cd_order')) return
    const key = `ga_purchase_${orderId || type}`
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
    ;(async () => {
      let value
      try {
        if (orderId) {
          const snap = await getDoc(doc(db, 'orders', orderId))
          if (snap.exists()) value = Number(snap.data().total) || undefined
        }
      } catch {}
      window.gtag('event', 'purchase', {
        transaction_id: orderId || `${type}-${Date.now()}`,
        ...(value != null ? { value, currency: 'USD' } : {}),
        items: [{ item_name: type }],
      })
    })()
  }, [type, orderId])

  const isDeposit  = type === 'deposit'
  const isCd       = type === 'cd_order'

  const heading = isDeposit  ? 'Deposit received.'
                : isCd       ? 'CD order paid.'
                : 'Order confirmed.'

  const body = isDeposit
    ? "Your deposit is confirmed. We'll be in touch with next steps and your balance due before shipping."
    : isCd
    ? "Your files are in the print queue. A receipt is on its way to your email within a few minutes, and we'll email you again when your CDs are ready."
    : "Your order is confirmed. You'll receive an email with details and shipping updates."

  const orderRef = orderId ? `#${orderId.slice(-6).toUpperCase()}` : null

  return (
    <main className="pt-[60px]">
      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
        <p style={{ fontSize: '2.5rem', marginBottom: '16px' }}>✓</p>
        <h1 className="font-serif" style={{ fontSize: '2rem', fontWeight: 'normal', marginBottom: '12px' }}>
          {heading}
        </h1>
        {orderRef && (
          <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', color: '#3d2810', marginBottom: '8px', textTransform: 'uppercase' }}>
            Order {orderRef}
          </p>
        )}
        <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#8a5c3a', marginBottom: '24px', lineHeight: '1.7' }}>
          {body}
        </p>
        <p style={{ fontFamily: 'serif', fontStyle: 'italic', fontSize: '1.05rem', color: '#3d2810', lineHeight: '1.75', marginBottom: '32px', paddingTop: '24px', borderTop: '1px solid #e8ddd0' }}>
          Thank you for supporting! Every transaction is instrumental to making this all work. We offer infinite gratitude for not only seeing the vision, but also being a part of our dream.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => navigate(isCd ? '/home' : '/account')} className="btn-outline">
            {isCd ? 'Back to Home' : 'View Orders'}
          </button>
          <button onClick={() => navigate('/shop')} className="btn-ghost">
            Back to Shop
          </button>
        </div>
      </div>
      <Footer />
    </main>
  )
}
