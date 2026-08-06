import { Footer } from 'art-saturated'

// Footer is the site footer: gradient wordmark, nav links, and copyright. It
// carries a large top margin in-app (mt-24); the negative margin here pulls it
// up so the card frames the footer itself.

export const Default = () => (
  <div style={{ marginTop: -96 }}>
    <Footer />
  </div>
)
