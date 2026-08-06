import { ProfileAvatar, AuthProvider } from 'art-saturated'

// Round avatar with a serif-initials fallback over a dark fill and cream ring.
// Without a signed-in user it shows the "?" placeholder — the logged-out state.
// Sizes demonstrate the `size` prop.

export const Sizes = () => (
  <AuthProvider>
    <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: 28 }}>
      <ProfileAvatar size={48} />
      <ProfileAvatar size={72} />
      <ProfileAvatar size={112} />
    </div>
  </AuthProvider>
)
