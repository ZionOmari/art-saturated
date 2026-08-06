import { EnigmaField } from 'art-saturated'

// EnigmaField is the reusable "drifting white specks on black" canvas visual.
// It fills its parent, so each story gives it an explicit size. Children render
// as an overlay above the field.

export const Default = () => (
  <div style={{ width: 380, height: 220 }}>
    <EnigmaField />
  </div>
)

export const WithOverlay = () => (
  <div style={{ width: 380, height: 220 }}>
    <EnigmaField
      density={1.1}
      contentStyle={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <span style={{ fontFamily: 'Georgia, serif', fontSize: 30, letterSpacing: '0.24em', color: '#fff' }}>
        ENIGMA
      </span>
    </EnigmaField>
  </div>
)

export const DeepBrown = () => (
  <div style={{ width: 380, height: 160 }}>
    <EnigmaField background="#1a1208" density={0.7} />
  </div>
)
