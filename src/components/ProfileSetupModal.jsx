import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth, normalizeTypes } from '../context/AuthContext'


const inp = {
  width: '100%', fontFamily: 'monospace', fontSize: '14px',
  padding: '12px 14px', border: '1px solid #a08060',
  background: 'rgba(236,230,217,0.7)', color: '#1a1814',
  outline: 'none', boxSizing: 'border-box', marginBottom: '14px',
}

const pill = (active) => ({
  fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em',
  textTransform: 'uppercase', padding: '10px 20px', border: '1px solid',
  cursor: 'pointer', transition: 'all 0.15s',
  background:   active ? '#1a1814' : 'transparent',
  borderColor:  active ? '#1a1814' : '#a08060',
  color:        active ? '#f5f2ec' : '#7a5030',
})

export default function ProfileSetupModal() {
  const { user, profile, updateDisplayName, updateArtistProfile, setAccountTypes, completeProfileSetup } = useAuth()
  const navigate = useNavigate()

  const [step,       setStep]       = useState(0)
  const [name,       setName]       = useState(profile?.name || user?.displayName || '')
  const [acctType,   setAcctType]   = useState(() => normalizeTypes(profile?.accountType))
  const [bio,        setBio]        = useState(profile?.artistBio || '')
  const [instagram,  setInstagram]  = useState(profile?.instagram || '')
  const [busy,       setBusy]       = useState(false)

  // acctType is the role array (e.g. ['collector','creator']). 'both' is a UI shortcut
  // for collector+creator; it's never stored as its own role.
  const pillActive = (val) =>
    val === 'both'
      ? acctType.includes('collector') && acctType.includes('creator')
      : acctType.includes(val)

  function toggleType(val) {
    setAcctType(prev => {
      if (val === 'both') {
        const hasBoth   = prev.includes('collector') && prev.includes('creator')
        const withoutCC = prev.filter(t => t !== 'collector' && t !== 'creator')
        return hasBoth ? withoutCC : [...withoutCC, 'collector', 'creator']
      }
      return prev.includes(val) ? prev.filter(t => t !== val) : [...prev, val]
    })
  }

  // Mark setup complete (which unmounts this modal via SetupGate) and land the
  // user on the page they actually need next.
  async function finishTo(path) {
    await completeProfileSetup()
    navigate(path)
  }

  const isCreator = acctType.includes('creator')
  // Build the actual step sequence depending on account type
  const stepList = isCreator ? ['name','type','artist','done'] : ['name','type','done']
  const current  = stepList[step]
  const total    = stepList.length - 1 // excludes 'done' from progress

  async function advance(save = true) {
    if (busy) return
    setBusy(true)
    try {
      if (current === 'name'   && save && name.trim())  await updateDisplayName(name.trim())
      if (current === 'type'   && save)                 await setAccountTypes(acctType)
      if (current === 'artist' && save)                 await updateArtistProfile({ artistBio: bio, instagram, website: profile?.website || '', artistPublic: profile?.artistPublic ?? false })
    } catch (err) { console.error(err) }
    finally { setBusy(false) }

    const nextStep = step + 1
    // Reaching the final 'done' screen means every real step is saved. Persist completion
    // now (without flipping the local flag, so the modal stays mounted for the done screen)
    // so navigating away from 'done' won't re-trigger the wizard next session.
    if (stepList[nextStep] === 'done') {
      completeProfileSetup({ local: false }).catch(err => console.error(err))
    }
    setStep(nextStep)
  }

  async function skip() { await advance(false) }

  const progress = step / total

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
      background: 'rgba(20,16,10,0.6)',
      backdropFilter: 'blur(2px)',
    }}>
      <div style={{
        background: '#f5f1e8', border: '1px solid #a08060',
        width: '100%', maxWidth: '460px',
        padding: '40px 36px',
        position: 'relative',
      }}>
        {/* Progress bar */}
        {current !== 'done' && (
          <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '3px', background: '#e8e0d4' }}>
            <div style={{ height: '100%', width: `${progress * 100}%`, background: '#a08060', transition: 'width 0.3s' }} />
          </div>
        )}

        {/* Step counter */}
        {current !== 'done' && (
          <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#a08060', marginBottom: '24px' }}>
            Step {step + 1} of {total}
          </p>
        )}

        {/* ── Name step ── */}
        {current === 'name' && (
          <>
            <h2 style={{ fontFamily: 'serif', fontSize: '1.6rem', fontWeight: 400, color: '#1a1814', marginBottom: '8px' }}>
              What should we call you?
            </h2>
            <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#7a5030', marginBottom: '24px', lineHeight: 1.6 }}>
              This is your display name across Art Saturated.
            </p>
            <input
              style={inp}
              type="text"
              placeholder="Your name"
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && advance()}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
              <button onClick={() => advance()} disabled={busy} className="btn-outline" style={{ flex: 1, textAlign: 'center' }}>
                {busy ? '…' : 'Continue'}
              </button>
              <button onClick={skip} disabled={busy} style={{ fontFamily: 'monospace', fontSize: '11px', color: '#7a5030', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Skip
              </button>
            </div>
          </>
        )}

        {/* ── Account type step ── */}
        {current === 'type' && (
          <>
            <h2 style={{ fontFamily: 'serif', fontSize: '1.6rem', fontWeight: 400, color: '#1a1814', marginBottom: '8px' }}>
              How will you use Art Saturated?
            </h2>
            <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#7a5030', marginBottom: '28px', lineHeight: 1.6 }}>
              Select all that apply — you can change this anytime in settings.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '28px' }}>
              {[
                ['collector', 'Collecting',      'Browse and buy art, media, and goods'],
                ['creator',   'Creating',        'Sell your work — $7.99/month, unlimited uploads'],
                ['both',      'Both',            'Shop and sell on the platform'],
              ].map(([val, label, hint]) => (
                <button key={val} onClick={() => toggleType(val)} style={{ ...pill(pillActive(val)), textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '2px', padding: '12px 16px' }}>
                  <span>{label}</span>
                  <span style={{ fontSize: '10px', opacity: 0.6, letterSpacing: '0.06em', fontWeight: 400 }}>{hint}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={() => advance()} disabled={busy} className="btn-outline" style={{ flex: 1, textAlign: 'center' }}>
                {busy ? '…' : 'Continue'}
              </button>
              <button onClick={skip} disabled={busy} style={{ fontFamily: 'monospace', fontSize: '11px', color: '#7a5030', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Skip
              </button>
            </div>
          </>
        )}

        {/* ── Artist profile step (creators only) ── */}
        {current === 'artist' && (
          <>
            <h2 style={{ fontFamily: 'serif', fontSize: '1.6rem', fontWeight: 400, color: '#1a1814', marginBottom: '8px' }}>
              Set up your artist profile
            </h2>
            <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#7a5030', marginBottom: '24px', lineHeight: 1.6 }}>
              Tell people about yourself and your work. You can always edit this later.
            </p>
            <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#a08060', marginBottom: '8px' }}>
              Bio
            </p>
            <textarea
              style={{ ...inp, minHeight: '90px', resize: 'vertical' }}
              placeholder="A few words about your art and what you make…"
              value={bio}
              onChange={e => setBio(e.target.value)}
            />
            <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.12em', textTransform: 'uppercase', color: '#a08060', marginBottom: '8px' }}>
              Instagram
            </p>
            <input
              style={inp}
              type="text"
              placeholder="@yourhandle"
              value={instagram}
              onChange={e => setInstagram(e.target.value)}
            />
            <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
              <button onClick={() => advance()} disabled={busy} className="btn-outline" style={{ flex: 1, textAlign: 'center' }}>
                {busy ? '…' : 'Save & Continue'}
              </button>
              <button onClick={skip} disabled={busy} style={{ fontFamily: 'monospace', fontSize: '11px', color: '#7a5030', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                Skip
              </button>
            </div>
          </>
        )}

        {/* ── Done step ──
            Previously a dead end: it told creators to "submit your work" but gave
            no way to do it, dropping them wherever they happened to be. Now the
            primary button takes each account type straight to its next action. */}
        {current === 'done' && (
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '2.5rem', marginBottom: '16px' }}>✦</p>
            <h2 style={{ fontFamily: 'serif', fontSize: '1.8rem', fontWeight: 400, color: '#1a1814', marginBottom: '12px' }}>
              You're all set{name ? `, ${name.split(' ')[0]}` : ''}.
            </h2>
            <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#7a5030', marginBottom: '32px', lineHeight: 1.7 }}>
              {isCreator
                ? 'Next: start uploading your work. Listing runs on a $7.99/month membership — unlimited uploads, no per-listing fees.'
                : 'Welcome to Art Saturated. Have a look around the shop.'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
              <button
                onClick={() => finishTo(isCreator ? '/gallery-upload' : '/shop')}
                className="btn-outline"
                style={{ minWidth: '200px' }}
              >
                {isCreator ? 'Start uploading →' : 'Browse the shop →'}
              </button>
              <button
                onClick={() => completeProfileSetup()}
                style={{ fontFamily: 'monospace', fontSize: '11px', color: '#7a5030', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.1em', textTransform: 'uppercase' }}
              >
                {isCreator ? 'Maybe later' : 'Close'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
