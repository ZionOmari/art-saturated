import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import Footer from '../components/Footer'
import EventsSection from '../components/EventsSection'
import ArtCarousel from '../components/ArtCarousel'
import FloatingProductColumn from '../components/FloatingProductColumn'
import { useAuth } from '../context/AuthContext'
import { fetchAllProducts } from '../data/storage'

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const FLORA_DARK = '#1a1208'

function DarkHoverBtn({ children, onClick, fullWidth = false }) {
  const [hovered, setHovered] = useState(false)
  const [pressed, setPressed]  = useState(false)
  const active = hovered || pressed
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false) }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => setPressed(false)}
      style={{
        display: fullWidth ? 'block' : 'inline-block',
        width: fullWidth ? '100%' : undefined,
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: '11px',
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        border: `1px solid ${active ? FLORA_DARK : 'currentColor'}`,
        padding: '0.875rem 2rem',
        cursor: 'pointer',
        transition: 'all 0.2s',
        background: active ? FLORA_DARK : 'transparent',
        color: active ? '#f2ebe0' : 'inherit',
        textAlign: 'center',
      }}
    >
      {children}
    </button>
  )
}

function FilledBtn({ children, onClick, fullWidth = false }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: fullWidth ? 'block' : 'inline-block',
        width: fullWidth ? '100%' : undefined,
        fontFamily: 'var(--font-mono, monospace)',
        fontSize: '11px',
        letterSpacing: '0.15em',
        textTransform: 'uppercase',
        border: `1px solid ${FLORA_DARK}`,
        padding: '0.875rem 2rem',
        cursor: 'pointer',
        transition: 'all 0.2s',
        background: hovered ? 'transparent' : FLORA_DARK,
        color: hovered ? FLORA_DARK : '#f2ebe0',
        textAlign: 'center',
      }}
    >
      {children}
    </button>
  )
}

export default function HomePage() {
  const navigate  = useNavigate()
  const { user, profile } = useAuth()
  const isCreator = profile?.accountType?.includes('creator')
  const isPartner = profile?.partnerApplication === 'approved'

  const [localLegends,   setLocalLegends]   = useState([])
  const [randomProducts, setRandomProducts] = useState([])

  useEffect(() => {
    fetchAllProducts().then(all => {
      const active = all.filter(p => p.active !== false && !p.inBucket && p.category !== 'Mystery')
      setLocalLegends(active.filter(p => p.localLegend).slice(0, 8))
      setRandomProducts(shuffle(active.filter(p => !p.localLegend)).slice(0, 8))
    }).catch(() => {})
  }, [])

  return (
    <main className="pt-[60px]">

      {/* ── Hero (with side columns at xl+) ──────────────────── */}
      <div style={{ position: 'relative' }}>

        {/* Left column — Local Legends */}
        {localLegends.length > 0 && (
          <div className="hidden xl:flex" style={{
            position: 'absolute', left: '20px', top: 0, bottom: 0,
            alignItems: 'flex-start', paddingTop: '80px', zIndex: 1,
          }}>
            <FloatingProductColumn products={localLegends} label="Local Legends" duration={24} />
          </div>
        )}

        {/* Right column — Random shop, with Enigma preorder backdrop + hover reveal */}
        {randomProducts.length > 0 && (
          <div className="hidden xl:flex" style={{
            position: 'absolute', right: '20px', top: 0, bottom: 0,
            alignItems: 'flex-start', paddingTop: '80px', zIndex: 1,
          }}>
            <FloatingProductColumn products={randomProducts} label="Preorder" duration={17} enigma />
          </div>
        )}

      <section className="max-w-4xl mx-auto px-6 pt-24 pb-20 border-b border-warm-gray-light">
        <p className="eyebrow mb-8">Fort Wayne, Indiana · Est. Here. Now.</p>

        <h1 style={{
          fontFamily: "'Inter', sans-serif", fontWeight: 700,
          fontSize: 'clamp(3.5rem,10vw,7rem)', lineHeight: 0.93,
          letterSpacing: '-0.03em', marginBottom: '1.5rem',
        }}>
          Art<br />Saturated
        </h1>

        <p className="font-mono text-[11px] tracking-[0.15em] uppercase text-warm-gray mb-12">
          A marketplace for independent creators
        </p>

        <blockquote className="font-serif italic text-[clamp(1.4rem,3.5vw,2rem)] text-ink leading-snug
                               pl-6 border-l-2 border-earth mb-14 max-w-xl">
          "You can't make everything,<br />but you can make anything."
        </blockquote>

        <div className="flex items-center gap-4 flex-wrap">
          {user && isCreator ? (
            <FilledBtn onClick={() => navigate('/submit-art')}>List Your Art</FilledBtn>
          ) : (
            <FilledBtn onClick={() => navigate('/account?acctab=artist')}>Become a Creator</FilledBtn>
          )}
          <DarkHoverBtn onClick={() => navigate('/shop')}>Become a Collector</DarkHoverBtn>
          <DarkHoverBtn onClick={() => navigate('/order/cd')}>CD Print Service</DarkHoverBtn>
        </div>

        {/* Mobile columns — shown below CTA buttons on small screens */}
        {(localLegends.length > 0 || randomProducts.length > 0) && (
          <div className="flex xl:hidden justify-center items-start gap-5 mt-10">
            {localLegends.length > 0 && (
              <FloatingProductColumn products={localLegends} label="Local Legends" duration={24} cardWidth={88} colHeight={260} />
            )}
            {randomProducts.length > 0 && (
              <FloatingProductColumn products={randomProducts} label="Preorder" duration={17} cardWidth={88} colHeight={260} enigma />
            )}
          </div>
        )}
      </section>
      </div>{/* end hero wrapper */}

      {/* ── Featured art slideshow ───────────────────────────── */}
      <ArtCarousel />

      {/* ── Creator recruitment ───────────────────────────────── */}
      <section className="border-b border-warm-gray-light">
        <div className="max-w-4xl mx-auto px-6 py-20">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-14 items-start">

            {/* Left: pitch */}
            <div>
              <p className="eyebrow mb-5">For Creators</p>
              <h2 className="font-serif text-[clamp(1.6rem,4vw,2.4rem)] font-normal leading-tight mb-6">
                List your work.<br />Build your audience.<br />Keep what you earn.
              </h2>
              <div className="font-mono text-[13px] text-warm-gray leading-relaxed flex flex-col gap-4">
                <p>
                  Art Saturated is a creator-first marketplace built in Fort Wayne for independent
                  artists, painters, photographers, and makers. Upload your work, set your price,
                  and we handle the storefront — so you can focus on making.
                </p>
                <p>
                  Your first <strong className="text-ink">10 listings are completely free.</strong>{' '}
                  No upfront cost, no gatekeeping. Hit your limit? Apply for the{' '}
                  <strong className="text-ink">Art Saturated Partnership</strong> — unlimited
                  listings, no listing fees, ever.
                </p>
              </div>

              <div className="mt-8 flex flex-col gap-3">
                {user && isCreator ? (
                  <DarkHoverBtn onClick={() => navigate('/submit-art')}>Submit a Listing →</DarkHoverBtn>
                ) : (
                  <>
                    <FilledBtn onClick={() => navigate('/account?acctab=artist')}>Create Your Account →</FilledBtn>
                    {user && (
                      <p className="font-mono text-[11px] text-warm-gray">
                        Already signed in — enable creator mode in your account settings.
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Right: how it works */}
            <div className="flex flex-col gap-4">
              {[
                {
                  n: '01',
                  title: 'Create an account',
                  body: 'Sign up free. Enable creator mode in your account settings to unlock listings.',
                },
                {
                  n: '02',
                  title: 'Submit your work',
                  body: 'Upload photos, set your price, add details. Your first 10 listings are on us.',
                },
                {
                  n: '03',
                  title: 'Get discovered',
                  body: 'Your work goes live in the shop and your artist profile is added to the directory.',
                },
                {
                  n: '04',
                  title: 'Get paid',
                  body: 'When something sells we coordinate pickup or shipping and send your payout.',
                },
              ].map(step => (
                <div key={step.n} className="flex gap-4 items-start p-5 border border-warm-gray-light bg-cream">
                  <span className="font-mono text-[11px] tracking-widest text-warm-gray flex-shrink-0 pt-0.5">{step.n}</span>
                  <div>
                    <p className="font-mono text-[12px] tracking-[0.08em] uppercase text-ink mb-1">{step.title}</p>
                    <p className="font-mono text-[12px] text-warm-gray leading-relaxed">{step.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Events ───────────────────────────────────────────── */}
      <EventsSection />

      {/* ── Beta transparency ────────────────────────────────── */}
      <section className="max-w-4xl mx-auto px-6 pb-20">
        <div style={{ border: '1px solid #a08060', padding: 'clamp(24px, 4vw, 40px)', background: 'rgba(185,122,48,0.03)' }}>
          <div className="flex flex-col sm:flex-row sm:items-start gap-5">
            <span style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.15em', color: '#b97a30', border: '1px solid #b97a30', padding: '3px 7px', flexShrink: 0, alignSelf: 'flex-start', marginTop: '3px' }}>
              BETA
            </span>
            <div>
              <h3 className="font-serif text-[1.25rem] font-normal mb-3">We're building in public.</h3>
              <p className="font-mono text-[12px] text-warm-gray leading-relaxed max-w-xl">
                Art Saturated is in active development. The shop, booking, artist submissions, and event calendar
                are all live and fully functional — but you may encounter rough edges as we keep building.
                New features land regularly and we're transparent about what's in progress.
              </p>
              <p className="font-mono text-[11px] text-warm-gray mt-4 leading-relaxed">
                Your feedback directly shapes what gets built next. Use the{' '}
                <span className="text-ink">feedback button</span>{' '}
                in the corner of any page — we read everything.
              </p>
              <div className="flex flex-wrap gap-6 mt-6 pt-5 border-t border-warm-gray-light">
                {[
                  { label: 'Shop & cart',               status: 'Live' },
                  { label: 'Artist listings',            status: 'Live' },
                  { label: 'Artist profiles',            status: 'Live' },
                  { label: 'Creator accounts',           status: 'Live' },
                  { label: 'Partnership program',        status: 'Live' },
                  { label: 'Creative services booking',  status: 'Live' },
                  { label: 'Events calendar',            status: 'Live' },
                  { label: 'Wishlist & accounts',        status: 'Live' },
                  { label: 'Custom CDs',                 status: 'Live' },
                  { label: 'Shipping labels',            status: 'Coming soon' },
                ].map(({ label, status }) => (
                  <div key={label} className="flex items-center gap-2">
                    <span style={{ width: '6px', height: '6px', borderRadius: '50%', flexShrink: 0, background: status === 'Live' ? '#5a8a5a' : '#b97a30' }} />
                    <span className="font-mono text-[11px] text-warm-gray">{label}</span>
                    <span className="font-mono text-[10px]" style={{ color: status === 'Live' ? '#5a8a5a' : '#b97a30' }}>— {status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </main>
  )
}
