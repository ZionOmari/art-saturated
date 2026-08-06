// Design-system entry for the claude.ai/design sync.
//
// The app's components are all `export default`, and the converter's synth
// entry uses `export *`, which does NOT re-export defaults. So we name them
// explicitly here and point cfg.entry / --entry at this file. We also expose
// the context providers the preview wrapper (cfg.provider) and the auth-gated
// component previews need on window.ArtSaturated.

// ── Components (named re-exports of default exports) ───────────────────────
export { default as Spinner } from '../src/components/Spinner.jsx'
export { default as Toast } from '../src/components/Toast.jsx'
export { default as StylePicker } from '../src/components/StylePicker.jsx'
export { default as EnigmaField } from '../src/components/EnigmaField.jsx'
export { default as ProductCard } from '../src/components/ProductCard.jsx'
export { default as ProductGrid } from '../src/components/ProductGrid.jsx'
export { default as FloatingProductColumn } from '../src/components/FloatingProductColumn.jsx'
export { default as EnigmaPreorderSpotlight } from '../src/components/EnigmaPreorderSpotlight.jsx'
export { default as Footer } from '../src/components/Footer.jsx'
export { default as ArtCarousel } from '../src/components/ArtCarousel.jsx'
export { default as ProfileAvatar } from '../src/components/ProfileAvatar.jsx'
export { default as Navbar } from '../src/components/Navbar.jsx'

// ── Providers (preview wrappers, not rendered as cards) ────────────────────
// MemoryRouter > ThemeProvider > CartProvider is the safe global wrapper
// (cfg.provider). AuthProvider gates render on a Firebase auth callback, so it
// is wrapped per-component in the previews that need it (Navbar, ProfileAvatar).
export { MemoryRouter } from 'react-router-dom'
export { ThemeProvider } from '../src/context/ThemeContext.jsx'
export { CartProvider } from '../src/context/CartContext.jsx'
export { AuthProvider } from '../src/context/AuthContext.jsx'
