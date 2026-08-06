import { Toast } from 'art-saturated'

// Toast is a fixed bottom-center notification. The `transform` on Stage makes
// it the containing block for the toast's `position: fixed`, so the toast sits
// inside the card instead of escaping to the page.

const Stage = ({ children }: any) => (
  <div style={{ position: 'relative', transform: 'translateZ(0)', width: 460, height: 130, background: 'rgba(120,90,40,0.04)' }}>
    {children}
  </div>
)

export const Visible = () => (
  <Stage>
    <Toast message="Added to cart" visible={true} />
  </Stage>
)

export const LongerMessage = () => (
  <Stage>
    <Toast message="Saved to your wishlist" visible={true} />
  </Stage>
)
