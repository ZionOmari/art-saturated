import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { collection, query, where, orderBy, getDocs, doc, updateDoc, deleteDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { db, storage } from '../lib/firebase'
import { useAuth, hasRole, normalizeTypes } from '../context/AuthContext'
import Footer from '../components/Footer'
import ProfileAvatar from '../components/ProfileAvatar'
import Spinner from '../components/Spinner'
import MessageThread from '../components/MessageThread'
import MysteryPreferencesPanel, { DEFAULT_MYSTERY_PREFS } from '../components/MysteryPreferencesPanel'
import ArtistMembershipPanel from '../components/ArtistMembershipPanel'

// ── Shared input style ────────────────────────────────────────────────────────
const inputStyle = {
  width: '100%',
  fontFamily: 'monospace',
  fontSize: '13px',
  padding: '12px 14px',
  border: '1px solid #d4c9bb',
  background: 'rgb(var(--color-paper))',
  color: 'rgb(var(--color-ink))',
  outline: 'none',
  boxSizing: 'border-box',
  marginBottom: '14px',
}

// ── Sign In ───────────────────────────────────────────────────────────────────
function SignIn({ onSwitch }) {
  const { signIn, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [form,  setForm]  = useState({ email: '', password: '' })
  const [error, setError] = useState('')
  const [busy,  setBusy]  = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await signIn(form)
      navigate('/account/profile')
    } catch (err) {
      setError('Incorrect email or password.')
    } finally { setBusy(false) }
  }

  async function handleGoogle() {
    setBusy(true); setError('')
    try {
      await signInWithGoogle()
      navigate('/account/profile')
    } catch (err) {
      setError('Google sign-in failed. Try again.')
    } finally { setBusy(false) }
  }

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6" style={{ paddingTop: '48px', paddingBottom: '60px' }}>
      <p className="eyebrow mb-2">Welcome back</p>
      <h1 className="font-serif text-[2rem] font-normal mb-10">Sign In</h1>

      <form onSubmit={handleSubmit}>
        <input style={inputStyle} type="email"    placeholder="Email"    value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))} required />
        <input style={inputStyle} type="password" placeholder="Password" value={form.password}
          onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required />
        {error && <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#b94040', marginBottom: '12px' }}>{error}</p>}
        <button type="submit" disabled={busy}
          className="btn-outline w-full text-center mb-3" style={{ display: 'block' }}>
          {busy ? 'Signing in...' : 'Sign In'}
        </button>
      </form>

      <button onClick={handleGoogle} disabled={busy}
        className="btn-ghost w-full text-center mb-8" style={{ display: 'block' }}>
        Continue with Google
      </button>

      <p style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-warm-gray))' }}>
        No account?{' '}
        <button onClick={onSwitch} style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-ink))' }}>
          Sign up
        </button>
      </p>
    </div>
  )
}

// ── Sign Up ───────────────────────────────────────────────────────────────────
function SignUp({ onSwitch }) {
  const { signUp, signInWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [form,        setForm]        = useState({ name: '', email: '', password: '', phone: '' })
  const [notify,      setNotify]      = useState({ email: true, sms: false })
  const [accountType, setAccountType] = useState(['collector'])
  function toggleSignupType(type) {
    setAccountType(prev => {
      const next = prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
      return next.length === 0 ? prev : next
    })
  }
  const [error,       setError]       = useState('')
  const [busy,        setBusy]        = useState(false)

  function field(key) {
    return { value: form[key], onChange: e => setForm(f => ({ ...f, [key]: e.target.value })) }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      await signUp({ ...form, notify, accountType })
      navigate('/account/profile')
    } catch (err) {
      setError(err.message?.includes('email-already-in-use')
        ? 'That email is already registered.'
        : 'Something went wrong. Try again.')
    } finally { setBusy(false) }
  }

  async function handleGoogle() {
    setBusy(true); setError('')
    try {
      await signInWithGoogle()
      navigate('/account/profile')
    } catch (err) {
      setError('Google sign-in failed. Try again.')
    } finally { setBusy(false) }
  }

  const toggleStyle = (on) => ({
    display: 'inline-block', fontFamily: 'monospace', fontSize: '11px',
    letterSpacing: '0.12em', textTransform: 'uppercase', padding: '9px 18px',
    border: '1px solid', cursor: 'pointer',
    background: on ? 'rgb(var(--color-ink))' : 'transparent',
    borderColor: on ? 'rgb(var(--color-ink))' : 'rgb(var(--color-warm-gray-light))',
    color: on ? 'rgb(var(--color-cream))' : 'rgb(var(--color-warm-gray))', transition: 'all 0.18s',
  })

  const typeCard = (type) => ({
    flex: 1, padding: '14px 12px', border: '1px solid',
    cursor: 'pointer', textAlign: 'left', background: accountType === type ? 'rgb(var(--color-ink))' : 'rgb(var(--color-paper))',
    borderColor: accountType === type ? 'rgb(var(--color-ink))' : 'rgb(var(--color-warm-gray-light))',
    transition: 'all 0.18s',
  })

  return (
    <div className="max-w-md mx-auto px-4 sm:px-6" style={{ paddingTop: '48px', paddingBottom: '60px' }}>
      <p className="eyebrow mb-2">Join the community</p>
      <h1 className="font-serif text-[2rem] font-normal mb-10">Create Account</h1>

      <form onSubmit={handleSubmit}>
        {/* Account type */}
        <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgb(var(--color-warm-gray))', marginBottom: '10px' }}>
          I want to
        </p>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', flexWrap: 'wrap' }}>
          {[
            { key: 'collector', label: 'Collect',  desc: 'Shop, track orders, save items' },
            { key: 'creator',   label: 'Create',   desc: 'List art, track sales, reach collectors' },
          ].map(({ key, label, desc }) => {
            const on = accountType.includes(key)
            return (
              <button key={key} type="button" style={{ ...typeCard(key), background: on ? 'rgb(var(--color-ink))' : 'rgb(var(--color-paper))', borderColor: on ? 'rgb(var(--color-ink))' : 'rgb(var(--color-warm-gray-light))' }} onClick={() => toggleSignupType(key)}>
                <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: on ? 'rgb(var(--color-cream))' : 'rgb(var(--color-ink))', marginBottom: '4px' }}>{label}</p>
                <p style={{ fontFamily: 'monospace', fontSize: '10px', color: on ? 'rgba(255,255,255,0.6)' : 'rgb(var(--color-warm-gray))' }}>{desc}</p>
              </button>
            )
          })}
        </div>

        <input style={inputStyle} type="text"     placeholder="Name"     {...field('name')}     required />
        <input style={inputStyle} type="email"    placeholder="Email"    {...field('email')}    required />
        <input style={inputStyle} type="password" placeholder="Password" {...field('password')} required />
        <input style={inputStyle} type="tel"      placeholder="Phone (optional)" {...field('phone')} />

        {/* Notification preferences */}
        <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgb(var(--color-warm-gray))', marginBottom: '10px' }}>
          Notify me by
        </p>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
          <button type="button" style={toggleStyle(notify.email)} onClick={() => setNotify(n => ({ ...n, email: !n.email }))}>Email</button>
        </div>

        {error && <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#b94040', marginBottom: '12px' }}>{error}</p>}

        <button type="submit" disabled={busy} className="btn-outline w-full text-center mb-3" style={{ display: 'block' }}>
          {busy ? 'Creating account...' : `Create Account`}
        </button>
      </form>

      <button onClick={handleGoogle} disabled={busy} className="btn-ghost w-full text-center mb-8" style={{ display: 'block' }}>
        Continue with Google
      </button>

      <p style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-warm-gray))' }}>
        Already have an account?{' '}
        <button onClick={onSwitch} style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-ink))' }}>
          Sign in
        </button>
      </p>
    </div>
  )
}

const tabBtn = (active) => ({
  fontFamily: 'monospace',
  fontSize: '11px',
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '10px 16px',
  border: '1px solid',
  cursor: 'pointer',
  background: active ? 'rgb(var(--color-ink))' : 'transparent',
  borderColor: active ? 'rgb(var(--color-ink))' : 'rgb(var(--color-warm-gray-light))',
  color: active ? 'rgb(var(--color-cream))' : 'rgb(var(--color-warm-gray))',
  transition: 'all 0.18s',
})

const statusColor = { pending: '#b97a30', ready: '#3a7a40', completed: 'rgb(var(--color-warm-gray))', shipped: '#3a5a7a' }

// ── Profile ───────────────────────────────────────────────────────────────────
function Profile() {
  const { user, profile, logOut, updateNotifyPrefs, updateDisplayName, updateArtistProfile, removeFromWishlist, fetchOrders, fetchSellerOrders, switchAccountType } = useAuth()
  const navigate   = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const isOwner    = user?.email === 'zionomari@artsaturated.com'
  const isCreator  = isOwner || hasRole(profile?.accountType, 'creator')
  // Land everyone on the Artist Profile tab by default — encourages submitting,
  // sharing work, and going public (and the "become a Creator" toggle lives there).
  const defaultTab = 'artist'
  const tab = searchParams.get('acctab') || defaultTab
  function setTab(t) { setSearchParams(p => { const n = new URLSearchParams(p); n.set('acctab', t); return n }, { replace: true }) }

  const [notify,           setNotify]           = useState(profile?.notify        || { email: true, sms: false })
  const [notifyEvents,     setNotifyEvents]     = useState(profile?.notifyEvents  ?? false)
  const [notifyPromo,      setNotifyPromo]      = useState(profile?.notifyPromo   ?? false)
  const [notifyBlog,       setNotifyBlog]       = useState(profile?.notifyBlog    ?? false)
  // Sync from profile once it loads
  useEffect(() => {
    if (profile?.notify)       setNotify(profile.notify)
    if (profile?.notifyEvents !== undefined) setNotifyEvents(profile.notifyEvents)
    if (profile?.notifyPromo  !== undefined) setNotifyPromo(profile.notifyPromo)
    if (profile?.notifyBlog   !== undefined) setNotifyBlog(profile.notifyBlog)
  }, [profile?.notify, profile?.notifyEvents, profile?.notifyPromo, profile?.notifyBlog]) // eslint-disable-line react-hooks/exhaustive-deps
  const [phone,        setPhone]        = useState(profile?.phone  || '')
  const [displayName,  setDisplayName]  = useState(profile?.name   || '')
  const [nameSaved,    setNameSaved]    = useState(false)
  const [saved,        setSaved]        = useState(false)
  const [wlCopied,     setWlCopied]     = useState(false)
  const [orders,       setOrders]       = useState([])
  const [sellerOrders, setSellerOrders] = useState([])
  const [artistBio,    setArtistBio]    = useState(profile?.artistBio  || '')
  const [artistInsta,  setArtistInsta]  = useState(profile?.instagram  || '')
  const [artistSite,   setArtistSite]   = useState(profile?.website    || '')
  const [artistPublic, setArtistPublic] = useState(profile?.artistPublic ?? false)
  const [artistBanner, setArtistBanner] = useState(profile?.bannerURL  || '')
  const [bannerBusy,   setBannerBusy]   = useState(false)
  const bannerInputRef = useRef()
  const [artistSaved,  setArtistSaved]  = useState(false)
  const [submissions,        setSubmissions]        = useState([])
  const [subsLoading,        setSubsLoading]        = useState(false)
  const [commissionRequests, setCommissionRequests] = useState([])
  const [commReqLoading,     setCommReqLoading]     = useState(false)
  const [collectorRequests,  setCollectorRequests]  = useState([])
  const [collReqLoading,     setCollReqLoading]     = useState(false)
  const [openThreadId,       setOpenThreadId]       = useState(null)
  const [mysteryPrefs,    setMysteryPrefs]    = useState({ ...DEFAULT_MYSTERY_PREFS })
  const [mysteryPrefsSaved,   setMysteryPrefsSaved]   = useState(false)
  const [mysteryPrefsSaving,  setMysteryPrefsSaving]  = useState(false)

  useEffect(() => {
    if (profile?.mysteryPreferences) {
      setMysteryPrefs(prev => ({ ...DEFAULT_MYSTERY_PREFS, ...profile.mysteryPreferences, size: prev.size }))
    }
  }, [profile?.mysteryPreferences]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { fetchOrders().then(setOrders).catch(() => {}) }, [])
  useEffect(() => {
    if (isCreator) fetchSellerOrders().then(setSellerOrders).catch(() => {})
  }, [isCreator])

  useEffect(() => {
  }, [tab, user?.email])

  useEffect(() => {
    if (tab !== 'submissions' || !user) return
    setSubsLoading(true)
    getDocs(query(
      collection(db, 'submissions'),
      where('uid', '==', user.uid),
      orderBy('submittedAt', 'desc'),
    )).then(snap => {
      setSubmissions(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    }).catch(e => console.error('submissions query failed:', e.code || e.message)).finally(() => setSubsLoading(false))
  }, [tab, user])

  useEffect(() => {
    if (tab !== 'commissions' || !user) return
    setCommReqLoading(true)
    getDocs(query(
      collection(db, 'commissionRequests'),
      where('artistId', '==', user.uid),
      orderBy('createdAt', 'desc'),
    )).then(snap => {
      setCommissionRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    }).catch(e => console.error('commissionRequests query failed:', e.code || e.message)).finally(() => setCommReqLoading(false))
  }, [tab, user])

  useEffect(() => {
    if (tab !== 'requests' || !user) return
    setCollReqLoading(true)
    getDocs(query(
      collection(db, 'commissionRequests'),
      where('collectorUid', '==', user.uid),
    )).then(snap => {
      const docs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      setCollectorRequests(docs)
    }).catch(() => {}).finally(() => setCollReqLoading(false))
  }, [tab, user])

  // Partition buyer orders (exclude archived from all visible lists)
  const visibleOrders   = orders.filter(o => !o.archived)
  // The order doc is written before the Stripe redirect, so an abandoned checkout
  // leaves a permanently-unpaid record. Show it honestly instead of "Processing".
  const isUnpaid = (o) => !['paid', 'deposit_paid'].includes(o.paymentStatus)
  const pendingOrders   = visibleOrders.filter(o => ['pending','ready','shipped'].includes(o.status))
  const completedOrders = visibleOrders.filter(o => o.status === 'completed')
  const cancelledOrders = visibleOrders.filter(o => o.status === 'cancelled')

  // Art sales = Firestore query on sellerId for creators; owner sees all from buyer orders too
  const artSales = isOwner
    ? visibleOrders.filter(o => (o.items || []).some(i => i.category === 'Art'))
    : sellerOrders.filter(o => !o.archived)

  const wishlist = profile?.wishlist || []

  async function handleLogOut() { await logOut(); navigate('/') }

  async function handleSaveName() {
    if (!displayName.trim()) return
    await updateDisplayName(displayName.trim())
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 1600)
  }

  async function saveMysteryPrefs() {
    setMysteryPrefsSaving(true)
    try {
      await updateDoc(doc(db, 'users', user.uid), {
        mysteryPreferences: { ...mysteryPrefs, savedAt: new Date().toISOString() },
      })
      setMysteryPrefsSaved(true)
      setTimeout(() => setMysteryPrefsSaved(false), 2000)
    } finally { setMysteryPrefsSaving(false) }
  }

  async function handleSavePrefs() {
    await updateNotifyPrefs(notify, phone, { notifyEvents, notifyPromo, notifyBlog })
    setSaved(true)
    setTimeout(() => setSaved(false), 1600)
  }

  async function handleBannerUpload(e) {
    const file = e.target.files?.[0]
    if (!file || !user) return
    setBannerBusy(true)
    try {
      const imgRef = storageRef(storage, `banners/${user.uid}`)
      const snap   = await uploadBytes(imgRef, file)
      const url    = await getDownloadURL(snap.ref)
      setArtistBanner(url)
    } catch (err) {
      console.error(err)
    } finally {
      setBannerBusy(false)
      e.target.value = ''
    }
  }

  async function handleSaveArtistProfile() {
    await updateArtistProfile({ artistBio, instagram: artistInsta, website: artistSite, artistPublic, bannerURL: artistBanner })
    setArtistSaved(true)
    setTimeout(() => setArtistSaved(false), 1600)
  }

  async function cancelOrder(orderId) {
    if (!window.confirm('Cancel this order?')) return
    setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: 'cancelled' } : o))
    updateDoc(doc(db, 'orders', orderId), { status: 'cancelled' }).catch(() => {})
  }

  async function archiveOrder(orderId) {
    setOrders(prev => prev.filter(o => o.id !== orderId))
    updateDoc(doc(db, 'orders', orderId), { archived: true }).catch(() => {})
  }

  async function deleteOrder(orderId) {
    if (!window.confirm('Permanently delete this order? This cannot be undone.')) return
    setOrders(prev => prev.filter(o => o.id !== orderId))
    deleteDoc(doc(db, 'orders', orderId)).catch(() => {})
  }

  const toggleStyle = (on) => ({
    display: 'inline-block', fontFamily: 'monospace', fontSize: '11px',
    letterSpacing: '0.12em', textTransform: 'uppercase', padding: '9px 18px',
    border: '1px solid', cursor: 'pointer',
    background: on ? 'rgb(var(--color-ink))' : 'transparent',
    borderColor: on ? 'rgb(var(--color-ink))' : 'rgb(var(--color-warm-gray-light))',
    color: on ? 'rgb(var(--color-cream))' : 'rgb(var(--color-warm-gray))', transition: 'all 0.18s',
  })

  const accountLabel = isOwner
    ? 'Owner'
    : normalizeTypes(profile?.accountType).map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' · ')

  return (
    <div className="max-w-xl mx-auto px-4 sm:px-6" style={{ paddingTop: '32px', paddingBottom: '60px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '24px' }}>
        <ProfileAvatar size={64} showUpload={true} />
        <div style={{ minWidth: 0 }}>
          <p className="eyebrow mb-1">{accountLabel}</p>
          <h1 className="font-serif leading-tight" style={{ fontSize: 'clamp(1.4rem, 5vw, 2rem)', margin: 0 }}>
            {profile?.name || user?.displayName || 'Your Account'}
          </h1>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: 'rgb(var(--color-warm-gray))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email}
          </p>
        </div>
      </div>

      {/* Tabs — wrapping grid like admin panel */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '28px' }}>
        <button style={tabBtn(tab === 'artist')}      onClick={() => setTab('artist')}>Artist Profile</button>
        <button style={tabBtn(tab === 'activity')}    onClick={() => setTab('activity')}>Activity</button>
        {isCreator && (
          <>
            <button style={tabBtn(tab === 'submissions')} onClick={() => setTab('submissions')}>Submissions</button>
            <button style={tabBtn(tab === 'commissions')} onClick={() => setTab('commissions')}>Commissions</button>
          </>
        )}
        <button style={tabBtn(tab === 'wishlist')}    onClick={() => setTab('wishlist')}>Wishlist</button>
        <button style={tabBtn(tab === 'requests')}   onClick={() => setTab('requests')}>My Requests</button>
        <button style={tabBtn(tab === 'settings')}    onClick={() => setTab('settings')}>Settings</button>
        <button style={tabBtn(tab === 'mystery')}     onClick={() => setTab('mystery')}>Mystery Profile</button>
        {isOwner && (
          <button
            style={{ ...tabBtn(false), borderColor: '#b97a30', color: '#b97a30' }}
            onClick={() => navigate('/admin')}
          >
            ✦ Admin
          </button>
        )}
      </div>

      {/* ── Activity — consolidated orders + art sales ──────────────── */}
      {tab === 'activity' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>

          {/* Art Sales section — creators only */}
          {isCreator && (
            <div>
              <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgb(var(--color-warm-gray))', marginBottom: '16px' }}>Art Sales</p>
              {artSales.length === 0 ? (
                <p style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-warm-gray))' }}>
                  No art sales yet.{' '}
                  <button onClick={() => navigate('/gallery-upload')} style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-ink))' }}>
                    Submit your art
                  </button>{' '}to get started.
                </p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {artSales.map(o => {
                    const artItems = isOwner
                      ? (o.items || []).filter(i => i.category === 'Art')
                      : (o.items || [])
                    const artTotal = artItems.reduce((s, i) => s + (Number(i.price) * (i.qty || 1)), 0)
                    const payout   = (artTotal * 0.90).toFixed(2)
                    return (
                      <li key={o.id} style={{ borderBottom: '1px solid #e8e0d4', paddingBottom: '16px', marginBottom: '16px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                          <span style={{ fontFamily: 'monospace', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: statusColor[o.status] || 'rgb(var(--color-warm-gray))' }}>{o.status}</span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <span style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-ink))' }}>
                              ${payout} <span style={{ color: 'rgb(var(--color-warm-gray))', fontSize: '10px' }}>after 10% commission</span>
                            </span>
                            {isOwner && <button onClick={() => archiveOrder(o.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', color: 'rgb(var(--color-warm-gray))', textDecoration: 'underline' }}>Archive</button>}
                          </div>
                        </div>
                        {o.name && (
                          <p style={{ fontFamily: 'monospace', fontSize: '10px', color: 'rgb(var(--color-warm-gray))', margin: '0 0 6px' }}>
                            Buyer: {o.name}
                          </p>
                        )}
                        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                          {artItems.map((item, i2) => (
                            <li key={i2} style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-warm-gray))' }}>
                              {item.emoji || '🖼️'} {item.name} × {item.qty || 1}
                            </li>
                          ))}
                        </ul>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          {/* Active Orders */}
          <div>
            <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgb(var(--color-warm-gray))', marginBottom: '16px' }}>Active Orders</p>
            {pendingOrders.length === 0 ? (
              <p style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-warm-gray))' }}>No active orders.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {pendingOrders.map(o => (
                  <li key={o.id} style={{ borderBottom: '1px solid #e8e0d4', paddingBottom: '16px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: isUnpaid(o) ? 'rgb(var(--color-warm-gray))' : statusColor[o.status] || 'rgb(var(--color-warm-gray))' }}>
                        {o.status === 'ready'   ? '✓ Ready for pickup'
                         : o.status === 'shipped' ? '⟶ Shipped'
                         : isUnpaid(o)            ? '○ Payment not completed'
                         : '⧗ Processing'}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-ink))' }}>${o.total}</span>
                        {isOwner && (
                          <>
                            <button onClick={() => cancelOrder(o.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', color: '#b94040', textDecoration: 'underline' }}>Cancel</button>
                            <button onClick={() => archiveOrder(o.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', color: 'rgb(var(--color-warm-gray))', textDecoration: 'underline' }}>Archive</button>
                          </>
                        )}
                      </div>
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {(o.items || []).map((item, i) => (
                        <li key={i} style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-warm-gray))' }}>
                          {item.emoji || '📦'} {item.name} × {item.qty || 1}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Past Purchases */}
          <div>
            <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgb(var(--color-warm-gray))', marginBottom: '16px' }}>Past Purchases</p>
            {completedOrders.length === 0 ? (
              <p style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-warm-gray))' }}>No completed orders yet.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {completedOrders.map(o => (
                  <li key={o.id} style={{ borderBottom: '1px solid #e8e0d4', paddingBottom: '16px', marginBottom: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '11px', color: 'rgb(var(--color-warm-gray))' }}>Completed</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-ink))' }}>${o.total}</span>
                        {isOwner && <button onClick={() => archiveOrder(o.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', color: 'rgb(var(--color-warm-gray))', textDecoration: 'underline' }}>Archive</button>}
                      </div>
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {(o.items || []).map((item, i) => (
                        <li key={i} style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-warm-gray))' }}>
                          {item.emoji || '📦'} {item.name} × {item.qty || 1}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Cancelled — owner only, with delete */}
          {isOwner && cancelledOrders.length > 0 && (
            <div>
              <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgb(var(--color-warm-gray))', marginBottom: '16px' }}>Cancelled</p>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {cancelledOrders.map(o => (
                  <li key={o.id} style={{ borderBottom: '1px solid #e8e0d4', paddingBottom: '14px', marginBottom: '14px', opacity: 0.7 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                      <span style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#b94040' }}>Cancelled</span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-warm-gray))' }}>${o.total}</span>
                        <button onClick={() => archiveOrder(o.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', color: 'rgb(var(--color-warm-gray))', textDecoration: 'underline' }}>Archive</button>
                        <button onClick={() => deleteOrder(o.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', color: '#b94040', textDecoration: 'underline' }}>Delete</button>
                      </div>
                    </div>
                    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                      {(o.items || []).map((item, i) => (
                        <li key={i} style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-warm-gray))' }}>
                          {item.emoji || '📦'} {item.name} × {item.qty || 1}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => {
                  if (!window.confirm(`Delete all ${cancelledOrders.length} cancelled orders? This cannot be undone.`)) return
                  setOrders(prev => prev.filter(o => o.status !== 'cancelled'))
                  Promise.all(cancelledOrders.map(o => deleteDoc(doc(db, 'orders', o.id)))).catch(() => {})
                }}
                style={{ marginTop: '8px', background: 'none', border: '1px solid #b94040', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#b94040', padding: '8px 16px' }}
              >
                Delete All Cancelled ({cancelledOrders.length})
              </button>
            </div>
          )}

        </div>
      )}

      {/* ── Wishlist ───────────────────────────────────────────── */}
      {tab === 'wishlist' && (
        <div>
          {wishlist.length === 0 ? (
            <p style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-warm-gray))' }}>Nothing saved yet. Hit ♡ on any product to save it.</p>
          ) : (
            <>
              {/* Share button */}
              <div style={{ marginBottom: '20px' }}>
                <button
                  onClick={async () => {
                    // Sync current wishlist to public collection
                    const wlRef = doc(db, 'wishlists', user.uid)
                    await setDoc(wlRef, {
                      items: wishlist,
                      ownerName: profile?.name || user?.displayName || '',
                      updatedAt: serverTimestamp(),
                    }, { merge: false }).catch(() => {})
                    const link = `${window.location.origin}/wishlist/${user.uid}`
                    navigator.clipboard.writeText(link).catch(() => {})
                    setWlCopied(true)
                    setTimeout(() => setWlCopied(false), 2000)
                  }}
                  style={{ ...toggleStyle(false), fontSize: '10px', padding: '8px 16px' }}
                >
                  {wlCopied ? '✓ Link copied!' : '⎘ Share Wishlist'}
                </button>
              </div>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {wishlist.map(item => (
                  <li key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #e8e0d4', paddingBottom: '12px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      {item.image
                        ? <img src={item.image} alt={item.name} loading="lazy" style={{ width: '40px', height: '40px', objectFit: 'cover', flexShrink: 0 }} />
                        : <span style={{ fontSize: '1.5rem' }}>{item.emoji}</span>
                      }
                      <div>
                        <p style={{ fontFamily: 'serif', fontSize: '1rem', margin: 0, color: 'rgb(var(--color-ink))' }}>{item.name}</p>
                        <p style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-warm-gray))', margin: 0 }}>${item.price}</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => navigate(`/shop/${item.slug}`)} style={{ ...toggleStyle(false), padding: '6px 12px', fontSize: '10px' }}>View</button>
                      <button onClick={() => { if (window.confirm(`Remove "${item.name}" from wishlist?`)) removeFromWishlist(item.id) }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: '12px', color: '#b94040' }}>✕</button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {/* ── Submissions (creator) ──────────────────────────────── */}
      {tab === 'submissions' && (
        <div>
          <button onClick={() => navigate('/gallery-upload')} className="btn-outline mb-8" style={{ display: 'inline-block' }}>
            + Submit New Art
          </button>
          {subsLoading && <div className="py-4 flex justify-center"><Spinner size={20} color="#3d2810" /></div>}
          {!subsLoading && submissions.length === 0 && (
            <p style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-warm-gray))' }}>
              No submissions yet. Submit your first piece to get it listed in the shop.
            </p>
          )}
          {!subsLoading && submissions.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {submissions.map(sub => {
                // pending_payment only exists on submissions predating the $1 fee's
                // removal. There is no payment to make any more, so don't ask for one.
                const statusLabel = { pending_payment: 'Needs review — contact us', pending_review: 'Under Review', approved: 'Live in Shop', rejected: 'Rejected' }[sub.status] || sub.status
                const sColor = { pending_payment: '#b97a30', pending_review: '#4a7a9b', approved: '#3a7a40', rejected: '#b94040' }[sub.status] || 'rgb(var(--color-warm-gray))'
                const sbNum = sub.submissionNumber ? `SB-${String(sub.submissionNumber).padStart(4,'0')}` : null
                return (
                  <div key={sub.id} style={{ border: '1px solid #e8e0d4', padding: '12px', background: 'rgb(var(--color-paper))' }}>
                    <div style={{ display: 'flex', gap: '12px' }}>
                      {sub.imageURL && (
                        <img src={sub.imageURL} alt={sub.title} style={{ width: '56px', height: '56px', objectFit: 'cover', flexShrink: 0 }} />
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px' }}>
                          <p style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-ink))', margin: '0 0 2px', fontWeight: 500 }}>{sub.title}</p>
                          {sbNum && <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#b97a30', flexShrink: 0 }}>{sbNum}</span>}
                        </div>
                        <p style={{ fontFamily: 'monospace', fontSize: '11px', color: 'rgb(var(--color-warm-gray))', margin: '0 0 6px' }}>
                          ${sub.price} · {sub.category}
                        </p>
                        <span style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', color: sColor, border: `1px solid ${sColor}`, padding: '2px 8px' }}>
                          {statusLabel}
                        </span>
                      </div>
                    </div>
                    {/* Rejection feedback from admin */}
                    {sub.status === 'rejected' && sub.rejectionFeedback && (
                      <div style={{ marginTop: '10px', padding: '10px 12px', background: 'rgba(185,64,64,0.05)', border: '1px solid rgba(185,64,64,0.2)' }}>
                        <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b94040', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Feedback</p>
                        <p style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-warm-gray))', margin: 0, lineHeight: '1.6' }}>{sub.rejectionFeedback}</p>
                      </div>
                    )}
                    {/* Admin responded to feedback request */}
                    {sub.feedbackAnswered && sub.adminFeedback && (
                      <div style={{ marginTop: '10px', padding: '10px 12px', background: 'rgba(185,122,48,0.05)', border: '1px solid rgba(185,122,48,0.25)' }}>
                        <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b97a30', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Team Feedback</p>
                        <p style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-warm-gray))', margin: 0, lineHeight: '1.6' }}>{sub.adminFeedback}</p>
                      </div>
                    )}
                    {/* Request feedback button — shown on rejections without feedback */}
                    {sub.status === 'rejected' && !sub.rejectionFeedback && !sub.feedbackRequested && !sub.feedbackAnswered && (
                      <button
                        onClick={async () => {
                          await updateDoc(doc(db, 'submissions', sub.id), { feedbackRequested: true }).catch(() => {})
                          setSubmissions(prev => prev.map(s => s.id === sub.id ? { ...s, feedbackRequested: true } : s))
                        }}
                        style={{ marginTop: '10px', fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '5px 12px', background: 'transparent', color: '#b94040', border: '1px solid #b94040', cursor: 'pointer' }}
                      >
                        Request Feedback
                      </button>
                    )}
                    {sub.feedbackRequested && !sub.feedbackAnswered && (
                      <p style={{ marginTop: '8px', fontFamily: 'monospace', fontSize: '11px', color: '#b97a30' }}>
                        ↳ Feedback requested — we'll follow up by email.
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Commission Requests (creator) ─────────────────────── */}
      {tab === 'commissions' && (
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-warm-gray))', marginBottom: '20px', lineHeight: '1.7' }}>
            Collectors who want custom work can send you an inquiry from your public profile.
            Art Saturated takes <strong>no commission on custom work</strong> — you arrange payment directly with the collector.
          </p>
          {commReqLoading && <div className="py-4 flex justify-center"><Spinner size={20} color="#3d2810" /></div>}
          {!commReqLoading && commissionRequests.length === 0 && (
            <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#7a5030' }}>
              No commission inquiries yet. Make sure your profile is public so collectors can find you.
            </p>
          )}
          {!commReqLoading && commissionRequests.map(req => {
            const dateStr = req.createdAt?.toDate
              ? req.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : ''
            const statusColors = { new: '#4a7a9b', responded: '#3a7a40', declined: '#b94040' }
            const threadOpen = openThreadId === req.id
            return (
              <div key={req.id} style={{ border: '1px solid #e8e0d4', marginBottom: '14px', background: req.status === 'new' ? 'rgb(var(--color-paper))' : '#f5f2ee' }}>
                <div style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
                    <div>
                      <p style={{ fontFamily: 'monospace', fontSize: '13px', fontWeight: 600, color: 'rgb(var(--color-ink))', margin: '0 0 2px' }}>{req.collectorName || 'Anonymous'}</p>
                      <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', margin: 0 }}>{req.collectorEmail} {dateStr && `· ${dateStr}`}</p>
                    </div>
                    <span style={{ fontFamily: 'monospace', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em', color: statusColors[req.status] || '#8a5c3a', border: `1px solid ${statusColors[req.status] || '#a08060'}`, padding: '2px 7px', flexShrink: 0 }}>
                      {req.status || 'new'}
                    </span>
                  </div>
                  {(req.budget || req.timeline) && (
                    <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b97a30', margin: '0 0 6px' }}>
                      {req.budget && `Budget: ${req.budget}`}{req.budget && req.timeline ? ' · ' : ''}{req.timeline && `Timeline: ${req.timeline}`}
                    </p>
                  )}
                  <p style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-warm-gray))', margin: '0 0 12px', lineHeight: '1.6' }}>{req.description}</p>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      onClick={() => setOpenThreadId(threadOpen ? null : req.id)}
                      style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '5px 12px', background: threadOpen ? 'rgb(var(--color-ink))' : 'transparent', color: threadOpen ? '#f5f2ec' : 'rgb(var(--color-ink))', border: '1px solid #1a1208', cursor: 'pointer', transition: 'all 0.15s' }}>
                      {threadOpen ? '↑ Close Thread' : '↓ Open Thread'}
                    </button>
                    <a href={`mailto:${req.collectorEmail}`}
                      style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '5px 12px', background: 'transparent', color: '#8a5c3a', border: '1px solid #c0a080', textDecoration: 'none', display: 'inline-block' }}>
                      Email ↗
                    </a>
                    {req.status === 'new' && (
                      <button onClick={async () => {
                        await updateDoc(doc(db, 'commissionRequests', req.id), { status: 'responded' }).catch(() => {})
                        setCommissionRequests(prev => prev.map(r => r.id === req.id ? { ...r, status: 'responded' } : r))
                      }}
                        style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '5px 12px', background: 'transparent', color: '#3a7a40', border: '1px solid #3a7a40', cursor: 'pointer' }}>
                        Mark Responded
                      </button>
                    )}
                  </div>
                </div>
                {threadOpen && (
                  <div style={{ padding: '0 16px 16px' }}>
                    <MessageThread
                      requestId={req.id}
                      currentUid={user.uid}
                      currentName={profile?.name || user.displayName || 'Artist'}
                      role="artist"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── My Commission Requests (collector) ───────────────────── */}
      {tab === 'requests' && (
        <div>
          <p style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-warm-gray))', marginBottom: '20px', lineHeight: '1.7' }}>
            Commission inquiries you've sent to artists. Open a thread to continue the conversation.
          </p>
          {collReqLoading && <div className="py-4 flex justify-center"><Spinner size={20} color="#3d2810" /></div>}
          {!collReqLoading && collectorRequests.length === 0 && (
            <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#7a5030' }}>
              No inquiries yet. Browse the{' '}
              <a href="/artists" style={{ color: '#b97a30', textDecoration: 'underline' }}>Artists</a>{' '}
              page to find creators and send a commission request.
            </p>
          )}
          {!collReqLoading && collectorRequests.map(req => {
            const dateStr = req.createdAt?.toDate
              ? req.createdAt.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
              : ''
            const statusColors = { new: '#4a7a9b', responded: '#3a7a40', declined: '#b94040' }
            const threadOpen = openThreadId === req.id
            return (
              <div key={req.id} style={{ border: '1px solid #e8e0d4', marginBottom: '14px', background: 'rgb(var(--color-paper))' }}>
                <div style={{ padding: '16px' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px', marginBottom: '8px' }}>
                    <div>
                      <p style={{ fontFamily: 'monospace', fontSize: '13px', fontWeight: 600, color: 'rgb(var(--color-ink))', margin: '0 0 2px' }}>
                        To: {req.artistName || 'Artist'}
                      </p>
                      <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', margin: 0 }}>
                        {dateStr}
                      </p>
                    </div>
                    <span style={{ fontFamily: 'monospace', fontSize: '9px', textTransform: 'uppercase', letterSpacing: '0.1em', color: statusColors[req.status] || '#8a5c3a', border: `1px solid ${statusColors[req.status] || '#a08060'}`, padding: '2px 7px', flexShrink: 0 }}>
                      {req.status || 'new'}
                    </span>
                  </div>
                  {(req.budget || req.timeline) && (
                    <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b97a30', margin: '0 0 6px' }}>
                      {req.budget && `Budget: ${req.budget}`}{req.budget && req.timeline ? ' · ' : ''}{req.timeline && `Timeline: ${req.timeline}`}
                    </p>
                  )}
                  <p style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-warm-gray))', margin: '0 0 12px', lineHeight: '1.6' }}>
                    {req.description}
                  </p>
                  <button
                    onClick={() => setOpenThreadId(threadOpen ? null : req.id)}
                    style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.1em', padding: '5px 12px', background: threadOpen ? 'rgb(var(--color-ink))' : 'transparent', color: threadOpen ? '#f5f2ec' : 'rgb(var(--color-ink))', border: '1px solid #1a1208', cursor: 'pointer', transition: 'all 0.15s' }}>
                    {threadOpen ? '↑ Close Thread' : '↓ Open Thread'}
                  </button>
                </div>
                {threadOpen && (
                  <div style={{ padding: '0 16px 16px' }}>
                    <MessageThread
                      requestId={req.id}
                      currentUid={user.uid}
                      currentName={profile?.name || user.displayName || 'Collector'}
                      role="collector"
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Artist Profile (creator) ───────────────────────────── */}
      {tab === 'artist' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>

          {/* Step 1 — Account Type */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#f5f0e8', background: 'rgb(var(--color-ink))', padding: '3px 7px' }}>01</span>
              <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgb(var(--color-ink))', margin: 0 }}>Account Type</p>
            </div>
            <p style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-ink))', marginBottom: '16px', lineHeight: '1.75' }}>
              Select all that apply. Add Creator to unlock selling features.
            </p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <button style={toggleStyle(hasRole(profile?.accountType, 'collector'))} onClick={() => switchAccountType('collector')}>Collector</button>
              <button style={toggleStyle(hasRole(profile?.accountType, 'creator'))}   onClick={() => switchAccountType('creator')}>Creator</button>
            </div>
            {isCreator && (
              <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#3a7a40' }}>✓ Creator features unlocked</p>
            )}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #e8e0d4', margin: 0 }} />

          {/* Step 2 — Profile Details */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#f5f0e8', background: 'rgb(var(--color-ink))', padding: '3px 7px' }}>02</span>
              <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgb(var(--color-ink))', margin: 0 }}>Your Profile</p>
            </div>
            <p style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-ink))', marginBottom: '20px', lineHeight: '1.75' }}>
              This appears on your public artist page. A strong bio and social links help collectors connect with your work.
            </p>

            <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgb(var(--color-ink))', marginBottom: '8px' }}>Bio</p>
            <textarea
              style={{ ...inputStyle, minHeight: '110px', resize: 'vertical', marginBottom: '20px' }}
              placeholder="Tell people about yourself and your work..."
              value={artistBio}
              onChange={e => setArtistBio(e.target.value)}
            />
            <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgb(var(--color-ink))', marginBottom: '8px' }}>Instagram Handle</p>
            <input style={{ ...inputStyle, marginBottom: '20px' }} type="text" placeholder="@yourhandle" value={artistInsta} onChange={e => setArtistInsta(e.target.value)} />
            <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgb(var(--color-ink))', marginBottom: '8px' }}>Website</p>
            <input style={{ ...inputStyle, marginBottom: '20px' }} type="url" placeholder="https://yoursite.com" value={artistSite} onChange={e => setArtistSite(e.target.value)} />

            <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgb(var(--color-ink))', marginBottom: '8px' }}>
              Profile Banner <span style={{ color: '#a08060', fontWeight: 400 }}>(optional)</span>
            </p>
            <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#7a5030', marginBottom: '12px', lineHeight: 1.6 }}>
              A wide image shown at the top of your profile page and as your card thumbnail in Discover Artists.
            </p>
            {artistBanner && (
              <div style={{ position: 'relative', marginBottom: '12px', maxWidth: '480px' }}>
                <img src={artistBanner} alt="Banner preview" style={{ width: '100%', aspectRatio: '16/6', objectFit: 'cover', display: 'block', border: '1px solid #d4c9bb' }} />
                <button
                  type="button"
                  onClick={() => setArtistBanner('')}
                  style={{ position: 'absolute', top: '6px', right: '6px', fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', background: 'rgba(26,24,20,0.7)', color: '#f5f0e8', border: 'none', cursor: 'pointer', padding: '4px 8px' }}
                >
                  Remove
                </button>
              </div>
            )}
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => bannerInputRef.current?.click()}
                disabled={bannerBusy}
                style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '9px 18px', border: '1px solid #d4c9bb', background: 'transparent', color: '#1a1814', cursor: 'pointer', opacity: bannerBusy ? 0.6 : 1 }}
              >
                {bannerBusy ? 'Uploading…' : artistBanner ? 'Replace Banner' : 'Upload Banner'}
              </button>
              {bannerBusy && <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#a08060' }}>uploading…</span>}
            </div>
            <input ref={bannerInputRef} type="file" accept="image/*" onChange={handleBannerUpload} style={{ display: 'none' }} />
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #e8e0d4', margin: 0 }} />

          {/* Step 3 — Visibility */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#f5f0e8', background: 'rgb(var(--color-ink))', padding: '3px 7px' }}>03</span>
              <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgb(var(--color-ink))', margin: 0 }}>Visibility</p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', padding: '16px', border: '1px solid #e8e0d4', marginBottom: '24px', background: artistPublic ? 'rgba(160,128,96,0.07)' : 'transparent' }}>
              <div>
                <p style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-ink))', margin: '0 0 4px' }}>Show in Discover Artists</p>
                <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#5a3820', margin: 0, lineHeight: '1.5' }}>
                  Let people find your profile and browse your work publicly.
                </p>
              </div>
              <button
                onClick={() => setArtistPublic(v => !v)}
                style={{ width: '44px', height: '26px', borderRadius: '13px', border: 'none', cursor: 'pointer', background: artistPublic ? 'rgb(var(--color-ink))' : '#c5bfb5', position: 'relative', flexShrink: 0, transition: 'background 0.2s' }}
                aria-label="Toggle public profile"
              >
                <span style={{ position: 'absolute', top: '4px', left: artistPublic ? '22px' : '4px', width: '18px', height: '18px', borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
              </button>
            </div>

            <button onClick={handleSaveArtistProfile} className="btn-outline" style={{ display: 'inline-block' }}>
              {artistSaved ? 'Saved ✓' : 'Save Profile'}
            </button>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid #e8e0d4', margin: 0 }} />

          {/* Artist membership */}
          <ArtistMembershipPanel profile={profile} />

          <hr style={{ border: 'none', borderTop: '1px solid #e8e0d4', margin: 0 }} />

          {/* Step 4 — Submit Your Work */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#f5f0e8', background: 'rgb(var(--color-ink))', padding: '3px 7px' }}>04</span>
              <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgb(var(--color-ink))', margin: 0 }}>List Your Work</p>
            </div>
            <p style={{ fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-ink))', marginBottom: '20px', lineHeight: '1.75' }}>
              Submit original work, prints, or any physical media to be listed in the shop. Every submission goes through a 48-hour review.
            </p>

            <div style={{ border: '1px solid #e8e0d4', padding: '20px', marginBottom: '24px', background: 'rgb(var(--color-paper))' }}>
              <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgb(var(--color-warm-gray))', marginBottom: '14px' }}>Terms</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {[
                  ['10% commission', 'on listed sales through the shop'],
                  ['5% commission', 'if you drop off in-store'],
                  ['$7.99/month', 'membership — unlimited uploads, no per-listing fee'],
                  ['48hr review', 'every submission is personally reviewed'],
                  ['0% on commissions', 'custom work is arranged directly — no platform cut'],
                ].map(([term, desc]) => (
                  <div key={term} style={{ display: 'flex', gap: '16px', alignItems: 'baseline' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-ink))', fontWeight: 600, flexShrink: 0, minWidth: '130px' }}>{term}</span>
                    <span style={{ fontFamily: 'monospace', fontSize: '12px', color: '#5a3820', lineHeight: '1.5' }}>{desc}</span>
                  </div>
                ))}
              </div>
            </div>

            <button onClick={() => navigate('/gallery-upload')} className="btn-outline" style={{ display: 'inline-block' }}>
              Upload Your Work →
            </button>
            <button
              onClick={() => setTab('submissions')}
              style={{ marginLeft: '16px', fontFamily: 'monospace', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'rgb(var(--color-warm-gray))', background: 'transparent', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
            >
              View Submissions
            </button>
          </div>

        </div>
      )}

      {/* ── Settings ───────────────────────────────────────────── */}
      {tab === 'settings' && (
        <>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgb(var(--color-warm-gray))', marginBottom: '10px' }}>
            Display Name
          </p>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '24px', alignItems: 'stretch' }}>
            <input
              style={{ ...inputStyle, marginBottom: 0, flex: 1, minWidth: 0 }}
              type="text"
              placeholder="Your name"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSaveName()}
            />
            <button onClick={handleSaveName} className="btn-outline" style={{ display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap', flexShrink: 0, padding: '0 16px' }}>
              {nameSaved ? 'Saved ✓' : 'Save'}
            </button>
          </div>

          <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgb(var(--color-warm-gray))', marginBottom: '10px' }}>
            Phone Number
          </p>
          <input style={{ ...inputStyle, marginBottom: '24px' }} type="tel"
            placeholder="Add a phone number for text notifications"
            value={phone} onChange={e => setPhone(e.target.value)} />

          <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgb(var(--color-warm-gray))', marginBottom: '10px' }}>
            Notify me by
          </p>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
            <button type="button" style={toggleStyle(notify.email)} onClick={() => setNotify(n => ({ ...n, email: !n.email }))}>Email</button>
          </div>

          <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgb(var(--color-warm-gray))', marginBottom: '10px' }}>
            Notify me about
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
            {[
              [notifyEvents,  setNotifyEvents,  'New events on the calendar'],
              [notifyPromo,   setNotifyPromo,   'Promotions, new listings & shop updates'],
              [notifyBlog,    setNotifyBlog,    'New articles in Art Saturated Magazine'],
            ].map(([val, setter, label]) => (
              <label key={label} style={{ display: 'flex', alignItems: 'center', gap: '10px', fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-warm-gray))', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={val}
                  onChange={e => setter(e.target.checked)}
                  style={{ accentColor: '#1a1814', width: '14px', height: '14px', cursor: 'pointer', flexShrink: 0 }}
                />
                {label}
              </label>
            ))}
          </div>

          <button onClick={handleSavePrefs} className="btn-outline mb-10" style={{ display: 'inline-block' }}>
            {saved ? 'Saved ✓' : 'Save Preferences'}
          </button>

          <hr className="divider mb-8" />

          {/* Switch account type */}
          <p style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgb(var(--color-warm-gray))', marginBottom: '10px' }}>
            Account Type
          </p>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '8px', flexWrap: 'wrap' }}>
            <button style={toggleStyle(hasRole(profile?.accountType, 'collector'))} onClick={() => switchAccountType('collector')}>Collector</button>
            <button style={toggleStyle(hasRole(profile?.accountType, 'creator'))}   onClick={() => switchAccountType('creator')}>Creator</button>
          </div>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: 'rgb(var(--color-warm-gray))', marginBottom: '24px' }}>
            {normalizeTypes(profile?.accountType).join(' · ') || 'No roles selected'}
          </p>

          <hr className="divider mb-8" />
          <button onClick={handleLogOut} className="btn-ghost" style={{ display: 'inline-block' }}>Sign Out</button>
        </>
      )}

      {/* ── Mystery Profile ─────────────────────────────────────────── */}
      {tab === 'mystery' && (
        <>
          <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgb(var(--color-warm-gray))', marginBottom: '8px' }}>Mystery Profile</p>
          <p style={{ fontFamily: 'serif', fontSize: '1.5rem', fontWeight: 400, color: 'rgb(var(--color-ink))', marginBottom: '6px' }}>Your Record Preferences</p>
          <p style={{ fontFamily: 'monospace', fontSize: '12px', color: 'rgb(var(--color-warm-gray))', marginBottom: '32px', lineHeight: 1.6 }}>
            These preferences are used when you order a Mystery Record or Mystery Crate. Save them here so you don't have to re-enter them each time.
          </p>

          <MysteryPreferencesPanel
            prefs={mysteryPrefs}
            onChange={setMysteryPrefs}
            showScale={true}
          />

          <div style={{ marginTop: '32px' }}>
            <button
              onClick={saveMysteryPrefs}
              disabled={mysteryPrefsSaving}
              className="btn-outline"
              style={{ display: 'inline-block' }}
            >
              {mysteryPrefsSaving ? 'Saving…' : mysteryPrefsSaved ? 'Saved ✓' : 'Save Mystery Preferences'}
            </button>
          </div>

          {profile?.mysteryPreferences?.savedAt && (
            <p style={{ fontFamily: 'monospace', fontSize: '10px', color: 'rgb(var(--color-warm-gray))', marginTop: '12px' }}>
              Last saved {new Date(profile.mysteryPreferences.savedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </p>
          )}
        </>
      )}
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function AccountPage() {
  const { user } = useAuth()
  const [mode, setMode] = useState('signin')

  return (
    <main className="pt-[60px]">
      {user
        ? <Profile />
        : mode === 'signin'
          ? <SignIn  onSwitch={() => setMode('signup')} />
          : <SignUp  onSwitch={() => setMode('signin')} />
      }
      <Footer />
    </main>
  )
}
