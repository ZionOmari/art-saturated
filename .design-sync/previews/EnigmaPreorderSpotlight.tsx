import { EnigmaPreorderSpotlight } from 'art-saturated'

// A pinned preorder spotlight whose "cover" is the live EnigmaField visual.
// Reusable template — props drive title/artist/price/copy for any release.

export const Default = () => <EnigmaPreorderSpotlight />

export const CustomRelease = () => (
  <EnigmaPreorderSpotlight
    slug="nightshade"
    title="Nightshade"
    artist="Zionomari"
    price={12}
    pickupCopy="Pickup on or after Aug 15"
    shipCopy="Ships starting Aug 16"
  />
)
