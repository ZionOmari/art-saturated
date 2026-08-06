import { lazy, Suspense, useEffect, Component } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigationType } from 'react-router-dom'
import { CartProvider } from './context/CartContext'
import { AuthProvider } from './context/AuthContext'
import { useAuth }       from './context/AuthContext'
import Navbar            from './components/Navbar'
import FeedbackBubble    from './components/FeedbackBubble'
import ProfileSetupModal from './components/ProfileSetupModal'
import Spinner           from './components/Spinner'

// Top-level error boundary — prevents a single bad component from white-screening the app
class ErrorBoundary extends Component {
  state = { error: null }
  static getDerivedStateFromError(error) { return { error } }
  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error.name, error.message, info)
    // ChunkLoadError = stale HTML referencing a chunk from a previous deploy.
    // Auto-reload once to pull the latest index.html + fresh chunks.
    const isChunkError = error.name === 'ChunkLoadError'
      || /Loading chunk|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(error.message)
    if (isChunkError && !sessionStorage.getItem('chunkReloaded')) {
      sessionStorage.setItem('chunkReloaded', '1')
      window.location.reload()
    }
  }
  render() {
    if (this.state.error) {
      return (
        <main className="pt-[60px] flex flex-col items-center justify-center min-h-screen px-6 gap-6"
              style={{ background: 'rgb(var(--color-cream))' }}>
          <p className="font-serif text-[3rem] font-normal text-ink">Something went wrong.</p>
          <p className="font-mono text-[13px] text-warm-gray">
            {this.state.error?.message || 'An unexpected error occurred.'}
          </p>
          <button className="btn-outline" onClick={() => {
            sessionStorage.removeItem('chunkReloaded')
            this.setState({ error: null })
          }}>Try again</button>
          <a href="/home" className="btn-outline">Go Home</a>
        </main>
      )
    }
    return this.props.children
  }
}

// Lazy-loaded pages — each becomes its own chunk, only downloaded when visited
const HomePage          = lazy(() => import('./pages/HomePage'))
const ShopPage          = lazy(() => import('./pages/ShopPage'))
const ProductPage       = lazy(() => import('./pages/ProductPage'))
const CartPage          = lazy(() => import('./pages/CartPage'))
const AboutPage         = lazy(() => import('./pages/AboutPage'))
const AdminPage         = lazy(() => import('./pages/AdminPage'))
const AccountPage       = lazy(() => import('./pages/AccountPage'))
const PaymentSuccess    = lazy(() => import('./pages/PaymentSuccess'))
const PaymentCancelled  = lazy(() => import('./pages/PaymentCancelled'))
const LoginPage         = lazy(() => import('./pages/LoginPage'))
const ConsultPage       = lazy(() => import('./pages/ConsultPage'))
const ArtistsPage       = lazy(() => import('./pages/ArtistsPage'))
const ArtistProfilePage = lazy(() => import('./pages/ArtistProfilePage'))
const GalleryUploadPage = lazy(() => import('./pages/GalleryUploadPage'))

// ── Retired routes (August 2026) ─────────────────────────────────────────────
// The site was narrowed to the shop plus 1:1 consultations. These pages still
// exist under src/pages and are fully intact — they are simply not routed or
// linked. To bring one back, re-add its lazy import and its <Route> below.
//
//   /book           BookingPage        superseded by /consult
//   /workshop       WorkshopPage       superseded by /consult
//   /events         EventsPage         also /events/past, /events/:eventId
//   /magazine       MagazinePage       also /magazine/:slug, /blog-submit
//   /interview/:t   InterviewPage      magazine artist interviews
//   /submit-art     SubmitArtPage      replaced by /gallery-upload (membership)
//
// /artists and /artists/:uid were un-retired in the artist-membership work —
// a paying member gets a public profile, so the directory is live again.
//   /mystery        MysteryPage        mystery record / crate builder
//   /preorder/:slug PreorderPage       removed: Enigma now sells as a product
//   /order/cd       QuoteRequestPage   CD duplication quote builder
//   /wishlist/:uid  WishlistPage       public wishlist sharing

function SetupGate() {
  const { profile } = useAuth()
  if (profile?.profileSetupDone === false) return <ProfileSetupModal />
  return null
}

// Minimal fallback shown while a page chunk loads
function PageLoader() {
  return (
    <main className="pt-[60px] min-h-screen flex items-center justify-center">
      <Spinner size={20} color="#3d2810" />
    </main>
  )
}

// Routes where the background should stay static (text-heavy, reading-focused pages)
const TEXT_HEAVY_ROUTES = ['/about', '/book', '/account', '/admin', '/submit-art', '/events', '/cart', '/order', '/login', '/payment-success', '/payment-cancelled', '/events/past', '/workshop']

// Scroll to top on every route change
function ScrollToTop() {
  const { pathname } = useLocation()
  const navType = useNavigationType()
  // Skip on POP (back/forward) so the browser restores the previous scroll position.
  useEffect(() => { if (navType !== 'POP') window.scrollTo(0, 0) }, [pathname, navType])
  return null
}

// Gradient position maps 1:1 to scroll depth — no easing, no cycling, no rAF.
// Sweeps linearly from the dark-coffee corner (top) to the cream center (bottom).
// On text-heavy routes the background is frozen at the dark coffee corner.
function useGradientDrift() {
  const location = useLocation()
  const isHome = location.pathname === '/home'
  const isTextHeavy = TEXT_HEAVY_ROUTES.some(
    r => location.pathname === r || location.pathname.startsWith(r + '/')
  )

  useEffect(() => {
    const root = document.documentElement

    if (isTextHeavy) {
      root.style.setProperty('--bg-x', '0%')
      root.style.setProperty('--bg-y', '0%')
      return
    }

    if (!isHome) {
      // All other pages: frozen at neutral cream center
      root.style.setProperty('--bg-x', '50%')
      root.style.setProperty('--bg-y', '50%')
      return
    }

    // Home page only: scroll-driven sweep
    // Starts at 40% (cream band lit across center) and sweeps to 65% (slight drift).
    // Keeps the cream highlight in the content focus area throughout the page.
    function update() {
      const maxScroll = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1)
      const t = window.scrollY / maxScroll
      const pos = (40 + t * 25).toFixed(1)
      root.style.setProperty('--bg-x', `${pos}%`)
      root.style.setProperty('--bg-y', `${pos}%`)
    }

    update()
    window.addEventListener('scroll', update, { passive: true })
    return () => window.removeEventListener('scroll', update)
  }, [isHome, isTextHeavy])
}

export default function App() {
  const location = useLocation()
  useGradientDrift()

  // GA4 — injected dynamically so the script only loads when VITE_GA4_ID is set.
  // Prevents the literal "%VITE_GA4_ID%" string from appearing when the env var is missing.
  useEffect(() => {
    const id = import.meta.env.VITE_GA4_ID
    if (!id) return
    const script = document.createElement('script')
    script.async = true
    script.src = `https://www.googletagmanager.com/gtag/js?id=${id}`
    document.head.appendChild(script)
    window.dataLayer = window.dataLayer || []
    window.gtag = function gtag() { window.dataLayer.push(arguments) }
    window.gtag('js', new Date())
    window.gtag('config', id, { send_page_view: true })
  }, [])

  return (
    <AuthProvider>
    <CartProvider>
      <ScrollToTop />
      <Navbar />
      <SetupGate />

      <ErrorBoundary>
      <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route path="/"            element={<Navigate to="/home" replace />} />
          <Route path="/home"        element={<HomePage />}    />
          <Route path="/shop"        element={<ShopPage />}    />
          <Route path="/shop/:slug"  element={<ProductPage />} />
          <Route path="/cart"        element={<CartPage />}    />
          <Route path="/about"       element={<AboutPage />}   />
          <Route path="/consult"     element={<ConsultPage />} />
          <Route path="/artists"           element={<ArtistsPage />}       />
          <Route path="/artists/:uid"      element={<ArtistProfilePage />} />
          <Route path="/gallery-upload"    element={<GalleryUploadPage />} />
          <Route path="/admin"       element={<AdminPage />}   />
          <Route path="/account"     element={<AccountPage />} />
          <Route path="/account/profile" element={<AccountPage />} />
          <Route path="/payment-success"   element={<PaymentSuccess />}   />
          <Route path="/payment-cancelled" element={<PaymentCancelled />} />
          <Route path="/login"             element={<LoginPage />}        />

          {/* Retired paths → send visitors somewhere useful instead of a 404,
              since these URLs may be in search results, links, or old emails. */}
          <Route path="/book"      element={<Navigate to="/consult" replace />} />
          <Route path="/workshop"  element={<Navigate to="/consult" replace />} />
          <Route path="/preorder/:slug" element={<Navigate to="/shop" replace />} />
          <Route path="/events/*"  element={<Navigate to="/home" replace />} />
          <Route path="/magazine/*" element={<Navigate to="/home" replace />} />
          <Route path="/mystery"   element={<Navigate to="/shop" replace />} />
          <Route path="/submit-art" element={<Navigate to="/shop" replace />} />
          <Route path="/order/cd"  element={<Navigate to="/shop" replace />} />

          <Route
            path="*"
            element={
              <main className="pt-[60px] flex flex-col items-center justify-center min-h-screen px-6 gap-6">
                <p className="font-serif text-[3rem] font-normal text-ink">404</p>
                <p className="font-mono text-[13px] text-warm-gray">Page not found.</p>
                <a href="/home" className="btn-outline">Go Home</a>
              </main>
            }
          />
        </Routes>
      </Suspense>
      </ErrorBoundary>

      <FeedbackBubble />
    </CartProvider>
    </AuthProvider>
  )
}
