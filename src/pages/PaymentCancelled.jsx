import { useNavigate } from 'react-router-dom'
import Footer from '../components/Footer'

export default function PaymentCancelled() {
  const navigate = useNavigate()
  return (
    <main className="pt-[60px]">
      <div style={{ maxWidth: '480px', margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
        <p style={{ fontSize: '2.5rem', marginBottom: '16px' }}>✕</p>
        <h1 className="font-serif" style={{ fontSize: '2rem', fontWeight: 'normal', marginBottom: '12px' }}>
          Payment cancelled.
        </h1>
        <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#8a5c3a', marginBottom: '32px' }}>
          No charge was made. You can try again whenever you're ready.
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => navigate(-1)}   className="btn-outline">Go Back</button>
          <button onClick={() => navigate('/shop')} className="btn-ghost">Back to Shop</button>
        </div>
      </div>
      <Footer />
    </main>
  )
}
