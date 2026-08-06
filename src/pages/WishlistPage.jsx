import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'
import { setPageMeta, resetPageMeta } from '../lib/meta'

export default function WishlistPage() {
  const { uid }      = useParams()
  const navigate     = useNavigate()
  const [items,      setItems]      = useState([])
  const [ownerName,  setOwnerName]  = useState('')
  const [loading,    setLoading]    = useState(true)
  const [notFound,   setNotFound]   = useState(false)

  useEffect(() => {
    if (!uid) return
    getDoc(doc(db, 'wishlists', uid))
      .then(snap => {
        if (!snap.exists() || !(snap.data().items?.length)) {
          setNotFound(true)
        } else {
          const data = snap.data()
          setItems(data.items || [])
          setOwnerName(data.ownerName || '')
        }
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [uid])

  useEffect(() => {
    if (!ownerName) return
    const title = ownerName ? `${ownerName}'s Wishlist — Art Saturated` : 'Wishlist — Art Saturated'
    setPageMeta({ title, description: `See what ${ownerName || 'someone'} is saving on Art Saturated.`, url: window.location.href })
    return () => resetPageMeta()
  }, [ownerName])

  if (loading) {
    return (
      <main className="pt-[60px] flex items-center justify-center min-h-screen">
        <Spinner size={20} color="#3d2810" />
      </main>
    )
  }

  if (notFound) {
    return (
      <main className="pt-[60px]">
        <div style={{ maxWidth: '480px', margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
          <p className="font-serif text-[2rem] font-normal mb-4">Nothing here.</p>
          <p className="font-mono text-[13px] text-warm-gray mb-8">This wishlist is empty or doesn't exist.</p>
          <button onClick={() => navigate('/shop')} className="btn-outline">Browse the Shop</button>
        </div>
        <Footer />
      </main>
    )
  }

  return (
    <main className="pt-[60px]">
      <section style={{ maxWidth: '560px', margin: '0 auto', padding: '48px 24px 80px' }}>
        <p className="eyebrow mb-2">Wishlist</p>
        <h1 className="font-serif font-normal mb-8" style={{ fontSize: 'clamp(1.6rem, 5vw, 2.2rem)' }}>
          {ownerName ? `${ownerName}'s Picks` : 'Saved Items'}
        </h1>

        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {items.map(item => (
            <li
              key={item.id}
              style={{ display: 'flex', alignItems: 'center', gap: '14px', border: '1px solid #e8e0d4', padding: '12px', background: '#faf8f4', cursor: 'pointer' }}
              onClick={() => navigate(`/shop/${item.slug}`)}
            >
              {item.image ? (
                <img
                  src={item.image}
                  alt={item.name}
                  loading="lazy"
                  style={{ width: '56px', height: '56px', objectFit: 'cover', flexShrink: 0 }}
                />
              ) : (
                <div style={{ width: '56px', height: '56px', background: '#f0ebe2', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ fontSize: '1.5rem' }}>{item.emoji}</span>
                </div>
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p className="font-serif" style={{ fontSize: '1rem', margin: '0 0 3px', color: '#1a1208', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.name}
                </p>
                <p className="font-mono" style={{ fontSize: '12px', color: '#3d2810', margin: 0 }}>${item.price}</p>
              </div>
              <span className="font-mono" style={{ fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#8a7060', flexShrink: 0 }}>View →</span>
            </li>
          ))}
        </ul>

        <div style={{ marginTop: '40px', borderTop: '1px solid #e8e0d4', paddingTop: '24px', textAlign: 'center' }}>
          <p className="font-mono" style={{ fontSize: '12px', color: '#8a7060', marginBottom: '12px' }}>
            Discover more at Art Saturated
          </p>
          <button onClick={() => navigate('/shop')} className="btn-outline">
            Enter Shop
          </button>
        </div>
      </section>
      <Footer />
    </main>
  )
}
