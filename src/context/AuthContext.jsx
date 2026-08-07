import { createContext, useContext, useEffect, useState } from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  sendEmailVerification,
} from 'firebase/auth'
import {
  doc, setDoc, getDoc, serverTimestamp,
  collection, addDoc, query, where, getDocs, orderBy,
  arrayUnion, arrayRemove,
} from 'firebase/firestore'
import { auth, db, googleProvider } from '../lib/firebase'

const AuthContext = createContext(null)

// Normalize legacy string accountType to array, handle 'both' → ['collector','creator']
export function normalizeTypes(accountType) {
  if (Array.isArray(accountType)) return accountType
  if (accountType === 'both') return ['collector', 'creator']
  return [accountType || 'collector']
}

// Check if a user has a given role — works with both old strings and new arrays
export function hasRole(accountType, role) {
  return normalizeTypes(accountType).includes(role)
}

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  // Listen for auth state changes
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (firebaseUser) {
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid))
        setProfile(snap.exists() ? snap.data() : null)
      } else {
        setProfile(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  async function createUserDoc(firebaseUser, extra = {}) {
    const ref  = doc(db, 'users', firebaseUser.uid)
    const snap = await getDoc(ref)
    if (!snap.exists()) {
      const data = {
        uid:              firebaseUser.uid,
        email:            firebaseUser.email,
        name:             firebaseUser.displayName || extra.name || '',
        phone:            extra.phone || '',
        notify:           extra.notify || { email: true, sms: false },
        accountType:      extra.accountType ? normalizeTypes(extra.accountType) : ['collector'],
        profileSetupDone: false,   // triggers first-login wizard
        createdAt:        serverTimestamp(),
      }
      await setDoc(ref, data)
      setProfile(data)
    } else {
      setProfile(snap.data())
    }
  }

  async function switchAccountType(type) {
    if (!user) return
    const ref     = doc(db, 'users', user.uid)
    const current = normalizeTypes(profile?.accountType)
    const next    = current.includes(type)
      ? current.filter(t => t !== type)
      : [...current, type]
    if (next.length === 0) return
    await setDoc(ref, { accountType: next }, { merge: true })
    setProfile(prev => ({ ...prev, accountType: next }))
  }

  // Set the account-type array directly (vs. switchAccountType which toggles one role).
  // Use when a UI owns the full selection — e.g. the onboarding wizard's multi-select.
  async function setAccountTypes(types) {
    if (!user) return
    const ref  = doc(db, 'users', user.uid)
    const next = [...new Set(normalizeTypes(types))].filter(Boolean)
    const final = next.length ? next : ['collector']
    await setDoc(ref, { accountType: final }, { merge: true })
    setProfile(prev => ({ ...prev, accountType: final }))
  }

  async function signUp({ email, password, name, phone, notify, accountType }) {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(cred.user, { displayName: name })
    await createUserDoc(cred.user, { name, phone, notify, accountType })
    sendEmailVerification(cred.user).catch(() => {}) // non-blocking — best effort
    return cred.user
  }

  async function signIn({ email, password }) {
    const cred = await signInWithEmailAndPassword(auth, email, password)
    await createUserDoc(cred.user)
    return cred.user
  }

  async function signInWithGoogle() {
    const cred = await signInWithPopup(auth, googleProvider)
    await createUserDoc(cred.user)
    return cred.user
  }

  async function logOut() {
    await signOut(auth)
    setProfile(null)
  }

  async function updateNotifyPrefs(notify, phone, extra = {}) {
    if (!user) return
    const ref     = doc(db, 'users', user.uid)
    const updates = { notify, ...(phone !== undefined ? { phone } : {}), ...extra }
    await setDoc(ref, updates, { merge: true })
    setProfile(prev => ({ ...prev, ...updates }))
  }

  // Persist that onboarding is finished. Pass { local: false } to write the flag to
  // Firestore WITHOUT flipping it in memory yet — the wizard uses this to save progress
  // when the last real step is reached (so navigating away won't re-trigger setup) while
  // keeping the modal mounted for the celebratory "done" screen. The default flips locally,
  // which unmounts the wizard via SetupGate.
  async function completeProfileSetup({ local = true } = {}) {
    if (!user) return
    await setDoc(doc(db, 'users', user.uid), { profileSetupDone: true }, { merge: true })
    if (local) setProfile(prev => ({ ...prev, profileSetupDone: true }))
  }

  async function updateDisplayName(name) {
    if (!user) return
    await updateProfile(user, { displayName: name })
    await setDoc(doc(db, 'users', user.uid), { name }, { merge: true })
    setProfile(prev => ({ ...prev, name }))
  }

  async function updateArtistProfile({ artistBio, instagram, website, artistPublic, bannerURL }) {
    if (!user) return
    const ref     = doc(db, 'users', user.uid)
    const updates = { artistBio, instagram, website, artistPublic, bannerURL }
    await setDoc(ref, updates, { merge: true })
    setProfile(prev => ({ ...prev, ...updates }))
  }

  // ── Wishlist ──────────────────────────────────────────────────────────────
  async function addToWishlist(product) {
    if (!user) return
    const ref    = doc(db, 'users', user.uid)
    const wlRef  = doc(db, 'wishlists', user.uid)
    const item   = { id: product.id, slug: product.slug, name: product.name, price: product.price, emoji: product.emoji || '🛍️', image: product.image || null }
    const ownerName = profile?.name || user.displayName || ''
    await setDoc(ref, { wishlist: arrayUnion(item) }, { merge: true })
    setDoc(wlRef, { items: arrayUnion(item), ownerName, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {})
    setProfile(prev => ({ ...prev, wishlist: [...(prev?.wishlist || []).filter(w => w.id !== item.id), item] }))
  }

  async function removeFromWishlist(productId) {
    if (!user) return
    const ref      = doc(db, 'users', user.uid)
    const wlRef    = doc(db, 'wishlists', user.uid)
    const existing = profile?.wishlist?.find(w => w.id === productId)
    if (!existing) return
    await setDoc(ref, { wishlist: arrayRemove(existing) }, { merge: true })
    setDoc(wlRef, { items: arrayRemove(existing), updatedAt: serverTimestamp() }, { merge: true }).catch(() => {})
    setProfile(prev => ({ ...prev, wishlist: (prev?.wishlist || []).filter(w => w.id !== productId) }))
  }

  function inWishlist(productId) {
    return (profile?.wishlist || []).some(w => w.id === productId)
  }

  // ── Orders ────────────────────────────────────────────────────────────────
  async function placeOrder(cart, subtotal, shippingMethod = 'ship', shippingCost = 0, taxAmount = 0, shippingAddress = null, bundleDiscount = 0) {
    if (!user) return null
    // Must mirror what Stripe actually charges — the checkout function applies the
    // bundle deal as a coupon, so omitting it here overstates the recorded total
    // (and every commission/payout derived from it).
    const discount = Number(bundleDiscount) || 0
    const total = parseFloat((subtotal + shippingCost + taxAmount - discount).toFixed(2))

    // If all Art items share one seller uid, tag the order for the seller dashboard
    const artSellerUids = [...new Set(
      (cart || []).filter(i => i.uid && i.category === 'Art').map(i => i.uid)
    )]
    const sellerId = artSellerUids.length === 1 ? artSellerUids[0] : null

    const isLocalDropoff = (cart || []).some(i => i.localDropoff === true)

    const orderRef = await addDoc(collection(db, 'orders'), {
      uid:            user.uid,
      email:          user.email,
      name:           profile?.name || user?.displayName || '',
      items:          cart,
      subtotal,
      shippingCost,
      taxAmount,
      shippingMethod,
      ...(discount > 0 ? { bundleDiscount: discount } : {}),
      total,
      status:         'pending',
      paymentStatus:  'pending',
      ...(sellerId        ? { sellerId }        : {}),
      ...(isLocalDropoff  ? { isLocalDropoff }  : {}),
      ...(shippingAddress ? { shippingAddress } : {}),
      createdAt:      serverTimestamp(),
    })
    return orderRef.id
  }

  async function fetchOrders() {
    if (!user) return []
    const q    = query(collection(db, 'orders'), where('uid', '==', user.uid), orderBy('createdAt', 'desc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  }

  // Orders where the current user is the seller (art sales dashboard)
  async function fetchSellerOrders() {
    if (!user) return []
    const q    = query(collection(db, 'orders'), where('sellerId', '==', user.uid), orderBy('createdAt', 'desc'))
    const snap = await getDocs(q)
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
  }

  return (
    <AuthContext.Provider value={{
      user, profile, setProfile, loading,
      signUp, signIn, signInWithGoogle, logOut,
      updateNotifyPrefs, updateDisplayName, updateArtistProfile, switchAccountType, setAccountTypes, completeProfileSetup,
      addToWishlist, removeFromWishlist, inWishlist,
      placeOrder, fetchOrders, fetchSellerOrders,
    }}>
      {!loading && children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
