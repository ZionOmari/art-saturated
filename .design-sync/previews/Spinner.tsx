import { Spinner } from 'art-saturated'

// Spinner inherits `currentColor`, so the wrapper's color drives it unless a
// `color` prop is passed.

export const Sizes = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 28, padding: 28, color: '#1a1208' }}>
    <Spinner size={16} />
    <Spinner size={24} />
    <Spinner size={40} />
  </div>
)

export const OnDark = () => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 28, padding: 28, background: '#1a1208' }}>
    <Spinner size={24} color="#f2ebe0" />
    <Spinner size={32} color="#d2a564" />
    <Spinner size={40} color="#b97a30" />
  </div>
)

export const InlineWithLabel = () => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: 28,
      fontFamily: '"DM Mono", monospace',
      fontSize: 12,
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      color: '#5a3820',
    }}
  >
    <Spinner size={16} color="#b97a30" />
    <span>Loading work…</span>
  </div>
)
