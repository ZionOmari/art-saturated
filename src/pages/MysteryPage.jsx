import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, updateDoc } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { useCart } from '../context/CartContext'
import { useAuth } from '../context/AuthContext'
import { fetchMysteryProducts } from '../data/storage'
import Footer from '../components/Footer'
import MysteryPreferencesPanel, {
  VibeSlider, PrefPill, GenreGrid,
  FORMAT_OPTIONS, DECADE_OPTIONS,
  DEFAULT_MYSTERY_PREFS,
  scaleLabel, jacketLabel, mediaLabel, formatPrefsNote,
} from '../components/MysteryPreferencesPanel'

// ── Stock images (Unsplash, free license) ─────────────────────────────────────
const IMG_VINYL = 'https://images.unsplash.com/photo-1602848597941-0d3d3a2c1241?auto=format&fit=crop&w=900&q=75'
const IMG_CRATE = 'https://images.unsplash.com/photo-1569823035625-1af6550f37d4?auto=format&fit=crop&w=900&q=75'
const IMG_DIG   = 'https://images.unsplash.com/photo-1530288782965-fbad40327074?auto=format&fit=crop&w=1200&q=70'
const IMG_HERO  = 'https://images.unsplash.com/photo-1488841714725-bb4c32d1ac94?auto=format&fit=crop&w=1400&q=70'

// ── Vinyl record illustration ─────────────────────────────────────────────────
function VinylRecord({ size = 120 }) {
  const label = Math.round(size * 0.38)
  const hole  = Math.round(size * 0.07)
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: '#1a1208',
      boxShadow: `0 0 0 ${Math.round(size * 0.03)}px #2a1e10, inset 0 0 0 ${Math.round(size * 0.035)}px #252010`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    }}>
      <div style={{
        width: label, height: label, borderRadius: '50%',
        background: 'linear-gradient(135deg, #9a6840 0%, #7a4c2a 100%)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <div style={{ width: hole, height: hole, borderRadius: '50%', background: '#1a1208' }} />
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function MysteryPage() {
  const { addToCart }      = useCart()
  const { user, profile }  = useAuth()
  const navigate           = useNavigate()

  const [products,        setProducts]        = useState([])
  const [loading,         setLoading]         = useState(true)
  const [mode,            setMode]            = useState('pick')  // 'pick' | 'single' | 'crate'
  const [step,            setStep]            = useState(1)       // 1-4 for crate
  const [added,           setAdded]           = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [profileSaved,    setProfileSaved]    = useState(false)
  const [hasSavedProfile, setHasSavedProfile] = useState(false)
  const [saveToProf,      setSaveToProf]      = useState(true)

  const [prefs, setPrefs] = useState({ ...DEFAULT_MYSTERY_PREFS, size: 3 })

  // Fetch mystery products
  useEffect(() => {
    fetchMysteryProducts().then(p => { setProducts(p); setLoading(false) })
  }, [])

  // Load saved profile preferences once profile is available
  useEffect(() => {
    if (profile?.mysteryPreferences) {
      setPrefs(prev => ({
        ...DEFAULT_MYSTERY_PREFS,
        ...profile.mysteryPreferences,
        size: prev.size,  // keep the current size selection, don't override from profile
      }))
      setHasSavedProfile(true)
    }
  }, [profile?.mysteryPreferences]) // eslint-disable-line react-hooks/exhaustive-deps

  const singleProduct = products.find(p => p.crateSize === 1)
  const crateProduct  = products.find(p => p.crateSize === prefs.size)
  const crateProducts = products.filter(p => (p.crateSize ?? 1) > 1)
  const minCratePrice = crateProducts.length
    ? Math.min(...crateProducts.map(p => Number(p.price) || 0))
    : null

  function updatePref(key, val) { setPrefs(p => ({ ...p, [key]: val })) }

  async function handleSaveToProfile() {
    if (!user) return
    setSaving(true)
    try {
      const { size: _size, ...profilePrefs } = prefs  // don't persist size in profile
      await updateDoc(doc(db, 'users', user.uid), {
        mysteryPreferences: { ...profilePrefs, savedAt: new Date().toISOString() },
      })
      setProfileSaved(true)
      setHasSavedProfile(true)
      setTimeout(() => setProfileSaved(false), 2500)
    } catch (err) {
      console.error('Failed to save mystery preferences:', err)
    } finally {
      setSaving(false)
    }
  }

  function handleAddSingle() {
    if (!user) { navigate('/login', { state: { from: '/mystery' } }); return }
    if (!singleProduct) return
    const notes = [
      prefs.format !== 'Any' ? `Format: ${prefs.format}` : null,
      `Jacket: ${jacketLabel(prefs.jacket)}`,
      `Media: ${mediaLabel(prefs.media)}`,
    ].filter(Boolean).join(' · ')
    addToCart({
      ...singleProduct,
      preferences: { format: prefs.format, jacket: prefs.jacket, media: prefs.media },
      notes,
    })
    setAdded(true)
    if (saveToProf) handleSaveToProfile()
  }

  function handleAddCrate() {
    if (!user) { navigate('/login', { state: { from: '/mystery' } }); return }
    if (!crateProduct) return
    addToCart({
      ...crateProduct,
      preferences: { ...prefs },
      notes: formatPrefsNote(prefs),
    })
    setAdded(true)
    if (saveToProf) handleSaveToProfile()
  }

  function nextStep() {
    if (step === 2) { setStep(3); setTimeout(() => setStep(4), 2500) }
    else setStep(s => s + 1)
  }

  function resetPrefs() { setPrefs(p => ({ ...DEFAULT_MYSTERY_PREFS, size: p.size })) }
  function goBack()   { setMode('pick');   setStep(1); setAdded(false) }
  function goSingle() { setMode('single'); setAdded(false) }
  function goCrate()  { setMode('crate');  setStep(1); setAdded(false) }

  // ── Saved profile banner ───────────────────────────────────────────────────
  function SavedProfileBanner() {
    if (!hasSavedProfile) return null
    return (
      <div className="mb-6 px-3 py-2 border border-earth/40 bg-earth/5 flex items-center justify-between gap-4">
        <span className="font-mono text-[10px] text-earth">Loaded from your saved crate profile</span>
        <button
          onClick={resetPrefs}
          className="font-mono text-[9px] text-warm-gray hover:text-ink bg-transparent border-0 cursor-pointer shrink-0"
        >
          Reset
        </button>
      </div>
    )
  }

  // ── Save checkbox ─────────────────────────────────────────────────────────
  function SaveCheckbox() {
    if (!user) return null
    return (
      <label className="flex items-center gap-2 mb-5 cursor-pointer">
        <input
          type="checkbox"
          checked={saveToProf}
          onChange={e => setSaveToProf(e.target.checked)}
          style={{ accentColor: '#1a1208' }}
        />
        <span className="font-mono text-[10px] text-warm-gray">Save preferences to my profile for next time</span>
      </label>
    )
  }

  if (loading) {
    return (
      <main className="pt-[60px] min-h-screen flex items-center justify-center">
        <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-warm-gray animate-pulse">Loading…</p>
      </main>
    )
  }

  const noProducts = products.length === 0

  return (
    <>
      <style>{`
        @keyframes vinyl-spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes crate-drop {
          from { opacity: 0; transform: translateY(-14px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <main className="pt-[60px] min-h-screen bg-cream">

        {/* ── Pick (landing) ─────────────────────────────────────────── */}
        {mode === 'pick' && (
          <>
            {/* Hero with photo */}
            <div className="relative overflow-hidden" style={{ height: 340 }}>
              <img
                src={IMG_HERO}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover"
                loading="eager"
              />
              <div className="absolute inset-0 bg-cream/82" />
              <div className="relative z-10 h-full flex flex-col items-center justify-center px-6 text-center">
                <p className="font-mono text-[10px] tracking-[0.35em] uppercase text-earth mb-4">Art Saturated</p>
                <h1 className="font-serif text-[2.8rem] md:text-[4.2rem] font-normal text-ink leading-tight mb-4">
                  Mystery Records
                </h1>
                <p className="font-mono text-[13px] text-warm-gray leading-relaxed max-w-xs">
                  Let the music find you. Share your vibe — Zionomari digs the rest.
                </p>
              </div>
            </div>

            {noProducts ? (
              <div className="max-w-md mx-auto px-6 py-16 text-center">
                <p className="font-mono text-[12px] text-warm-gray border border-warm-gray-light py-8">
                  Mystery drops coming soon. Check back shortly.
                </p>
              </div>
            ) : (
              <section className="max-w-3xl mx-auto px-6 pt-10 pb-20 grid md:grid-cols-2 gap-5">

                {/* Single record card */}
                <button
                  onClick={goSingle}
                  className="group text-left border border-warm-gray-light bg-offwhite hover:border-ink transition-all duration-300 cursor-pointer overflow-hidden"
                >
                  <div className="relative overflow-hidden" style={{ height: 200 }}>
                    <img
                      src={IMG_VINYL}
                      alt="Close-up of a vinyl record"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-ink/50 flex items-center justify-center">
                      <div style={{ animation: 'vinyl-spin 7s linear infinite' }}>
                        <VinylRecord size={84} />
                      </div>
                    </div>
                  </div>
                  <div className="p-6">
                    <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-earth mb-2">One Pick</p>
                    <h2 className="font-serif text-[1.6rem] text-ink mb-2">Mystery Record</h2>
                    <p className="font-mono text-[12px] text-warm-gray leading-relaxed mb-4">
                      One hand-selected record. Dial in your condition preferences — we handle the rest.
                    </p>
                    {singleProduct
                      ? <p className="font-mono text-[14px] text-ink mb-4">${Number(singleProduct.price).toFixed(2)}</p>
                      : <p className="font-mono text-[11px] text-warm-gray mb-4">Coming soon</p>
                    }
                    <div className="font-mono text-[10px] tracking-[0.2em] uppercase border border-ink px-4 py-2.5 text-center text-ink group-hover:bg-ink group-hover:text-cream transition-all duration-200">
                      Get a Pick
                    </div>
                  </div>
                </button>

                {/* Crate builder card */}
                <button
                  onClick={goCrate}
                  className="group text-left border border-warm-gray-light bg-offwhite hover:border-ink transition-all duration-300 cursor-pointer overflow-hidden"
                >
                  <div className="relative overflow-hidden" style={{ height: 200 }}>
                    <img
                      src={IMG_CRATE}
                      alt="Vinyl records in a wooden rack"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-ink/55 flex items-center justify-center gap-3">
                      {[0, 1, 2].map(i => (
                        <div
                          key={i}
                          className="border-2 border-cream/60 bg-cream/10"
                          style={{
                            width: 22 + i * 7,
                            height: 28 + i * 9,
                            transform: `translateY(${(2 - i) * 5}px)`,
                          }}
                        >
                          <div
                            className="rounded-full bg-cream/30 mx-auto"
                            style={{ width: 5 + i * 2, height: 5 + i * 2, marginTop: 6 + i * 2 }}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="p-6">
                    <p className="font-mono text-[9px] tracking-[0.25em] uppercase text-earth mb-2">Build Your Own</p>
                    <h2 className="font-serif text-[1.6rem] text-ink mb-2">Mystery Crate</h2>
                    <p className="font-mono text-[12px] text-warm-gray leading-relaxed mb-4">
                      3, 5, or 8 records curated to your vibe. Sliders, genres, era — dial in exactly what you want.
                    </p>
                    {minCratePrice != null
                      ? <p className="font-mono text-[13px] text-warm-gray mb-4">From ${minCratePrice.toFixed(2)}</p>
                      : <p className="font-mono text-[11px] text-warm-gray mb-4">Coming soon</p>
                    }
                    <div className="font-mono text-[10px] tracking-[0.2em] uppercase border border-earth px-4 py-2.5 text-center text-earth group-hover:bg-earth group-hover:text-cream transition-all duration-200">
                      Build a Crate
                    </div>
                  </div>
                </button>
              </section>
            )}
          </>
        )}

        {/* ── Single mode ────────────────────────────────────────────── */}
        {mode === 'single' && (
          <section className="max-w-lg mx-auto px-6 pt-10 pb-20">
            <button
              onClick={goBack}
              className="font-mono text-[10px] tracking-[0.15em] uppercase text-warm-gray hover:text-ink transition-colors mb-10 flex items-center gap-2 bg-transparent border-0 cursor-pointer"
            >
              ← Back
            </button>

            {/* Photo header */}
            <div className="relative overflow-hidden mb-8 border border-warm-gray-light" style={{ height: 220 }}>
              <img
                src={IMG_VINYL}
                alt="Vinyl record close-up"
                className="w-full h-full object-cover"
                loading="lazy"
              />
              <div className="absolute inset-0 bg-ink/60 flex items-center justify-center">
                <div style={{ animation: 'vinyl-spin 3.5s linear infinite' }}>
                  <VinylRecord size={130} />
                </div>
              </div>
            </div>

            <p className="font-mono text-[9px] tracking-[0.3em] uppercase text-earth mb-2">One Mystery Pick</p>
            <h2 className="font-serif text-3xl text-ink mb-8">Mystery Record</h2>

            {!singleProduct ? (
              <p className="font-mono text-[12px] text-warm-gray text-center py-8 border border-warm-gray-light">
                Mystery records are being restocked. Check back soon.
              </p>
            ) : (
              <>
                <SavedProfileBanner />

                {/* Format preference */}
                <div className="mb-6">
                  <p className="font-mono text-[9px] tracking-[0.2em] uppercase text-warm-gray mb-3">Format Preference</p>
                  <div className="flex flex-wrap gap-2">
                    {FORMAT_OPTIONS.map(o => (
                      <PrefPill
                        key={o.value}
                        value={o.value}
                        selected={prefs.format === o.value}
                        onSelect={v => updatePref('format', v)}
                      >
                        {o.label}
                      </PrefPill>
                    ))}
                  </div>
                </div>

                {/* Condition sliders */}
                <div className="space-y-5 mb-8">
                  <VibeSlider
                    label="Jacket / Sleeve"
                    left="No Jacket Fine"
                    right="Pristine Sleeve"
                    value={prefs.jacket}
                    onChange={v => updatePref('jacket', v)}
                    getLabel={jacketLabel}
                  />
                  <VibeSlider
                    label="Media Quality"
                    left="Any Condition"
                    right="Near Mint"
                    value={prefs.media}
                    onChange={v => updatePref('media', v)}
                    getLabel={mediaLabel}
                  />
                </div>

                <div className="border-t border-warm-gray-light pt-6 flex items-end justify-between mb-4">
                  <div>
                    <p className="font-mono text-[9px] tracking-[0.15em] uppercase text-warm-gray mb-1">Price</p>
                    <p className="font-mono text-[22px] text-ink">${Number(singleProduct.price).toFixed(2)}</p>
                    <p className="font-mono text-[10px] text-warm-gray mt-1">+ shipping · hand-selected</p>
                  </div>
                </div>

                <SaveCheckbox />

                {added ? (
                  <div className="text-center py-6 border border-warm-gray-light bg-offwhite">
                    <p className="font-mono text-[12px] text-earth mb-4">
                      {profileSaved ? 'Added to cart + profile saved!' : 'Added to cart!'}
                    </p>
                    <div className="flex gap-3 justify-center">
                      <button
                        onClick={() => navigate('/cart')}
                        className="font-mono text-[10px] tracking-[0.15em] uppercase bg-ink text-cream py-2.5 px-5 border-0 cursor-pointer hover:bg-earth transition-colors"
                      >
                        View Cart
                      </button>
                      <button
                        onClick={() => setAdded(false)}
                        className="font-mono text-[10px] tracking-[0.15em] uppercase border border-ink text-ink py-2.5 px-5 bg-transparent cursor-pointer hover:bg-ink hover:text-cream transition-colors"
                      >
                        Keep Shopping
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleAddSingle}
                    className="w-full font-mono text-[11px] tracking-[0.15em] uppercase bg-ink text-cream py-3.5 hover:bg-earth transition-colors cursor-pointer border-0"
                  >
                    Add to Cart
                  </button>
                )}
              </>
            )}
          </section>
        )}

        {/* ── Crate builder ──────────────────────────────────────────── */}
        {mode === 'crate' && (
          <section className="max-w-xl mx-auto px-6 pt-10 pb-20">

            {step < 3 && (
              <button
                onClick={goBack}
                className="font-mono text-[10px] tracking-[0.15em] uppercase text-warm-gray hover:text-ink transition-colors mb-10 flex items-center gap-2 bg-transparent border-0 cursor-pointer"
              >
                ← Back
              </button>
            )}

            {/* Step indicators */}
            {step < 3 && (
              <div className="flex items-center gap-2 mb-8">
                {[1, 2].map(s => (
                  <div key={s} className="flex items-center gap-2">
                    <div
                      className={`w-6 h-6 border flex items-center justify-center font-mono text-[10px] transition-all duration-300 ${
                        step >= s ? 'border-ink bg-ink text-cream' : 'border-warm-gray-light text-warm-gray'
                      }`}
                    >
                      {s}
                    </div>
                    {s < 2 && (
                      <div className={`w-10 h-px transition-all duration-500 ${step > s ? 'bg-ink' : 'bg-warm-gray-light'}`} />
                    )}
                  </div>
                ))}
                <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-warm-gray ml-3">
                  {step === 1 ? 'Choose Size' : 'Your Vibe Profile'}
                </p>
              </div>
            )}

            {/* Step 1 — size picker */}
            {step === 1 && (
              <>
                <h2 className="font-serif text-3xl text-ink mb-2">How many records?</h2>
                <p className="font-mono text-[12px] text-warm-gray mb-8">Each one hand-selected from the stacks.</p>

                <div className="grid grid-cols-3 gap-3 mb-8">
                  {[3, 5, 8].map(size => {
                    const prod   = products.find(p => p.crateSize === size)
                    const active = prefs.size === size
                    return (
                      <button
                        key={size}
                        onClick={() => updatePref('size', size)}
                        className={`border p-5 flex flex-col items-center gap-2.5 transition-all duration-200 cursor-pointer ${
                          active
                            ? 'border-ink bg-ink text-cream'
                            : 'border-warm-gray-light bg-offwhite text-ink hover:border-ink'
                        }`}
                      >
                        {/* Record stack visual */}
                        <div className="flex items-end gap-0.5" style={{ height: 30 }}>
                          {Array.from({ length: Math.min(size, 5) }).map((_, i) => (
                            <div
                              key={i}
                              className={`border ${active ? 'border-cream/50 bg-cream/15' : 'border-ink/30'}`}
                              style={{ width: 6, height: 8 + (i % 3) * 5 }}
                            />
                          ))}
                          {size > 5 && (
                            <span className={`font-mono text-[8px] ml-0.5 self-center ${active ? 'text-cream/60' : 'text-warm-gray'}`}>
                              +{size - 5}
                            </span>
                          )}
                        </div>
                        <p className="font-serif text-[1.9rem] leading-none">{size}</p>
                        <p className="font-mono text-[9px] tracking-[0.15em] uppercase">Records</p>
                        {prod
                          ? <p className="font-mono text-[12px]">${Number(prod.price).toFixed(2)}</p>
                          : <p className={`font-mono text-[9px] ${active ? 'text-cream/50' : 'text-warm-gray/60'}`}>soon</p>
                        }
                      </button>
                    )
                  })}
                </div>

                <button
                  onClick={() => products.find(p => p.crateSize === prefs.size) ? nextStep() : null}
                  disabled={!products.find(p => p.crateSize === prefs.size)}
                  className="w-full font-mono text-[11px] tracking-[0.15em] uppercase bg-ink text-cream py-3.5 hover:bg-earth transition-colors cursor-pointer border-0 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Continue →
                </button>
              </>
            )}

            {/* Step 2 — full vibe profile */}
            {step === 2 && (
              <>
                <h2 className="font-serif text-3xl text-ink mb-2">Dial in your vibe</h2>
                <p className="font-mono text-[12px] text-warm-gray mb-6">
                  Builds your {prefs.size}-record crate profile. Everything is optional.
                </p>

                <SavedProfileBanner />

                <MysteryPreferencesPanel
                  prefs={prefs}
                  onChange={setPrefs}
                  showScale={true}
                />

                <div className="mt-10">
                  <button
                    onClick={nextStep}
                    className="w-full font-mono text-[11px] tracking-[0.15em] uppercase bg-ink text-cream py-3.5 hover:bg-earth transition-colors cursor-pointer border-0"
                  >
                    Build My Crate →
                  </button>
                </div>
              </>
            )}

            {/* Step 3 — building animation */}
            {step === 3 && (
              <div className="relative overflow-hidden" style={{ minHeight: 320 }}>
                <img
                  src={IMG_DIG}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 w-full h-full object-cover opacity-25 blur-sm"
                  loading="lazy"
                />
                <div className="relative z-10 flex flex-col items-center justify-center py-20 text-center">
                  <div className="flex justify-center items-end gap-1.5 mb-10">
                    {Array.from({ length: Math.min(prefs.size, 6) }).map((_, i) => (
                      <div
                        key={i}
                        className="border-2 border-ink bg-offwhite"
                        style={{
                          width: 16 + (i % 3) * 4,
                          height: 22 + (i % 3) * 6,
                          animation: `crate-drop 0.4s ease-out ${i * 100}ms both`,
                        }}
                      />
                    ))}
                  </div>
                  <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-ink animate-pulse">
                    Curating your crate…
                  </p>
                  <p className="font-mono text-[10px] text-warm-gray mt-2">Digging through the stacks</p>
                </div>
              </div>
            )}

            {/* Step 4 — confirm & add to cart */}
            {step === 4 && (
              <>
                <p className="font-mono text-[9px] tracking-[0.3em] uppercase text-earth mb-2">Your Crate</p>
                <h2 className="font-serif text-3xl text-ink mb-8">Ready to Ship</h2>

                {/* Summary card */}
                <div className="border border-ink bg-offwhite p-6 mb-5">
                  <div className="flex items-start justify-between mb-5">
                    <div>
                      <p className="font-mono text-[9px] tracking-[0.15em] uppercase text-warm-gray mb-1">
                        {prefs.size} Records
                      </p>
                      <p className="font-serif text-xl text-ink">Hand-Curated Mystery Crate</p>
                    </div>
                    {crateProduct && (
                      <p className="font-mono text-[20px] text-ink">${Number(crateProduct.price).toFixed(2)}</p>
                    )}
                  </div>

                  <div className="border-t border-warm-gray-light pt-4">
                    <p className="font-mono text-[9px] tracking-[0.15em] uppercase text-warm-gray mb-3">
                      Your Preferences
                    </p>
                    {[
                      { label: 'Scale',  value: scaleLabel(prefs.scale)   },
                      { label: 'Jacket', value: jacketLabel(prefs.jacket)  },
                      { label: 'Media',  value: mediaLabel(prefs.media)    },
                      { label: 'Format', value: prefs.format === 'Any' ? 'Surprise me!'  : prefs.format },
                      { label: 'Era',    value: prefs.decade === 'Any' ? 'Any era'        : prefs.decade },
                    ].map(row => (
                      <div
                        key={row.label}
                        className="flex items-center justify-between py-1.5 border-b border-warm-gray-light/40 last:border-0"
                      >
                        <span className="font-mono text-[10px] text-warm-gray">{row.label}</span>
                        <span className="font-mono text-[11px] text-ink">{row.value}</span>
                      </div>
                    ))}

                    {/* Genre summary */}
                    {(() => {
                      const g       = prefs.genres || {}
                      const loved   = Object.entries(g).filter(([, v]) => v === 1).map(([k]) => k)
                      const skipped = Object.entries(g).filter(([, v]) => v === 2).map(([k]) => k)
                      return (
                        <>
                          {loved.length > 0 && (
                            <div className="flex items-start justify-between py-1.5 border-b border-warm-gray-light/40">
                              <span className="font-mono text-[10px] text-warm-gray shrink-0 mr-4">Loves</span>
                              <span className="font-mono text-[10px] text-ink text-right">{loved.join(', ')}</span>
                            </div>
                          )}
                          {skipped.length > 0 && (
                            <div className="flex items-start justify-between py-1.5">
                              <span className="font-mono text-[10px] text-warm-gray shrink-0 mr-4">Skip</span>
                              <span className="font-mono text-[10px] text-ink text-right">{skipped.join(', ')}</span>
                            </div>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </div>

                <p className="font-mono text-[11px] text-warm-gray text-center mb-5 leading-relaxed">
                  Zionomari hand-selects each record based on these preferences. Mystery crates are final sale.
                </p>

                <SaveCheckbox />

                {added ? (
                  <div className="text-center py-6 border border-warm-gray-light bg-offwhite">
                    <p className="font-mono text-[12px] text-earth mb-4">
                      {profileSaved ? 'Crate added + profile saved!' : 'Crate added to cart!'}
                    </p>
                    <div className="flex gap-3 justify-center">
                      <button
                        onClick={() => navigate('/cart')}
                        className="font-mono text-[10px] tracking-[0.15em] uppercase bg-ink text-cream py-2.5 px-5 border-0 cursor-pointer hover:bg-earth transition-colors"
                      >
                        View Cart
                      </button>
                      <button
                        onClick={goBack}
                        className="font-mono text-[10px] tracking-[0.15em] uppercase border border-ink text-ink py-2.5 px-5 bg-transparent cursor-pointer hover:bg-ink hover:text-cream transition-colors"
                      >
                        Back to Mystery
                      </button>
                    </div>
                  </div>
                ) : crateProduct ? (
                  <>
                    <button
                      onClick={handleAddCrate}
                      disabled={saving}
                      className="w-full font-mono text-[11px] tracking-[0.15em] uppercase bg-ink text-cream py-3.5 hover:bg-earth transition-colors cursor-pointer border-0 disabled:opacity-60 mb-3"
                    >
                      {saving ? 'Saving…' : 'Add to Cart'}
                    </button>
                    <button
                      onClick={() => setStep(2)}
                      className="w-full font-mono text-[10px] tracking-[0.12em] uppercase text-warm-gray hover:text-ink py-2 bg-transparent border-0 cursor-pointer transition-colors"
                    >
                      ← Change Preferences
                    </button>
                  </>
                ) : (
                  <div className="text-center py-6 border border-warm-gray-light">
                    <p className="font-mono text-[12px] text-warm-gray mb-3">This crate size is being restocked.</p>
                    <button
                      onClick={() => setStep(1)}
                      className="font-mono text-[10px] tracking-[0.12em] uppercase text-earth bg-transparent border-0 cursor-pointer"
                    >
                      Try a different size
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        )}
      </main>

      <Footer />
    </>
  )
}
