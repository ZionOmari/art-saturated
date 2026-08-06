import { Navbar, AuthProvider } from 'art-saturated'

// Navbar reads auth/cart/theme context. The global wrapper already supplies
// Router + Theme + Cart; AuthProvider is added here so the logged-out nav
// (Sign In, empty cart) renders. The `transform` on the frame makes it the
// containing block for the navbar's `position: fixed` header so it stays in the
// card. A wide viewport (see cfg.overrides.Navbar) reveals the desktop nav.

export const Default = () => (
  <AuthProvider>
    <div style={{ position: 'relative', transform: 'translateZ(0)', width: '100%', height: 60 }}>
      <Navbar />
    </div>
  </AuthProvider>
)
