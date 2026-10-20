import { useState } from 'react'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { sendPasswordResetEmail } from 'firebase/auth'
import { auth } from '../lib/firebase'

const inp = {
  fontFamily: 'monospace', fontSize: '13px', padding: '11px 14px',
  border: '1px solid #d4c9bb', background: 'rgba(250,248,244,0.8)',
  color: '#1a1208', outline: 'none', width: '100%', boxSizing: 'border-box',
  marginBottom: '12px',
}

const btn = (gold) => ({
  width: '100%', padding: '13px', border: '1px solid',
  fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.12em',
  textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.15s',
  background: gold ? '#1a1208' : 'transparent',
  color:      gold ? '#f2ebe0' : '#1a1208',
  borderColor: '#1a1208',
  marginBottom: '10px',
})

// `from` can arrive in the URL (?from=), so anyone can craft a login link.
// Only same-site paths are honoured: "//evil.com" and "/\evil.com" are read by
// browsers as another site, which would make our login page an open redirect.
function safeReturnPath(p) {
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (typeof p !== 'string' || !p.startsWith('/') || /^\/[/\\]/.test(p) || /[\u0000-\u001f\\]/.test(p)) return '/account'
  return p
}

export default function LoginPage() {
  const { signIn, signUp, signInWithGoogle } = useAuth()
  const navigate  = useNavigate()
  const location  = useLocation()
  const [searchParams] = useSearchParams()
  const from      = safeReturnPath(location.state?.from || searchParams.get('from'))

  const [mode,     setMode]     = useState('signin') // 'signin' | 'signup'
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [name,     setName]     = useState('')
  const [acctType, setAcctType] = useState('collector')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState('')
  const [notice,   setNotice]   = useState('')

  async function handleGoogle() {
    setBusy(true); setError('')
    try {
      await signInWithGoogle()
      navigate(from, { replace: true })
    } catch (e) {
      setError(e.message)
    } finally { setBusy(false) }
  }

  async function handleForgot() {
    if (!email) { setError('Enter your email above first, then tap “Forgot password.”'); return }
    setBusy(true); setError(''); setNotice('')
    try {
      await sendPasswordResetEmail(auth, email)
      setNotice('Password reset email sent — check your inbox.')
    } catch (e) {
      setError(e.code === 'auth/user-not-found' ? 'No account with that email.' : 'Could not send reset email. Try again.')
    } finally { setBusy(false) }
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setBusy(true); setError(''); setNotice('')
    try {
      if (mode === 'signin') {
        await signIn({ email, password })
      } else {
        await signUp({ email, password, name, accountType: acctType })
      }
      navigate(from, { replace: true })
    } catch (e) {
      setError(
        e.code === 'auth/wrong-password' ? 'Incorrect password.' :
        e.code === 'auth/user-not-found' ? 'No account with that email.' :
        e.code === 'auth/email-already-in-use' ? 'Email already in use.' :
        e.code === 'auth/weak-password' ? 'Password must be at least 6 characters.' :
        e.message
      )
    } finally { setBusy(false) }
  }

  const pillBtn = (active) => ({
    flex: 1, padding: '8px', border: '1px solid', cursor: 'pointer',
    fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em',
    textTransform: 'uppercase', transition: 'all 0.15s',
    background: active ? '#1a1208' : 'transparent',
    color:      active ? '#f2ebe0' : '#8a5c3a',
    borderColor: active ? '#1a1208' : '#c8bfb0',
  })

  return (
    <main style={{
      minHeight: '100vh', background: '#faf8f4',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '80px 16px 40px',
    }}>
      <div style={{ width: '100%', maxWidth: '400px' }}>

        {/* Header */}
        <div style={{ marginBottom: '32px', textAlign: 'left' }}>
          <button onClick={() => navigate('/')} className="gradient-text" style={{
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: "'Inter', sans-serif", fontWeight: 700, fontSize: '1.4rem', letterSpacing: '-0.01em',
            marginBottom: '8px', display: 'block', textAlign: 'left', padding: 0,
          }}>
            Art Saturated
          </button>
          <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.2em', textTransform: 'uppercase', color: '#8a5c3a' }}>
            {mode === 'signin' ? 'Welcome back' : 'Create your account'}
          </p>
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          <button onClick={() => { setMode('signin'); setError('') }} style={pillBtn(mode === 'signin')}>Sign In</button>
          <button onClick={() => { setMode('signup'); setError('') }} style={pillBtn(mode === 'signup')}>Create Account</button>
        </div>

        {/* Google */}
        <button onClick={handleGoogle} disabled={busy} style={{
          ...btn(false),
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
        }}>
          <svg width="16" height="16" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continue with Google
        </button>

        {/* Divider */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: '4px 0 16px' }}>
          <div style={{ flex: 1, height: '1px', background: '#d4c9bb' }} />
          <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#b0a898', letterSpacing: '0.1em' }}>or</span>
          <div style={{ flex: 1, height: '1px', background: '#d4c9bb' }} />
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {mode === 'signup' && (
            <input
              style={inp} type="text" placeholder="Your name"
              value={name} onChange={e => setName(e.target.value)} required
            />
          )}
          <input
            style={inp} type="email" placeholder="Email"
            value={email} onChange={e => setEmail(e.target.value)} required
          />
          <input
            style={{ ...inp, marginBottom: mode === 'signup' ? '16px' : '4px' }}
            type="password" placeholder="Password"
            value={password} onChange={e => setPassword(e.target.value)} required
          />

          {mode === 'signin' && (
            <div style={{ textAlign: 'right', marginBottom: '14px' }}>
              <button type="button" onClick={handleForgot} disabled={busy} style={{
                background: 'none', border: 'none', cursor: 'pointer',
                fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.06em',
                color: '#8a5c3a', textDecoration: 'underline', padding: 0,
              }}>
                Forgot password?
              </button>
            </div>
          )}

          {mode === 'signup' && (
            <div style={{ marginBottom: '16px' }}>
              <p style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', color: '#8a5c3a', marginBottom: '8px', letterSpacing: '0.1em' }}>
                Account type
              </p>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[['collector','Collector'],['creator','Creator'],['both','Both']].map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setAcctType(val)} style={pillBtn(acctType === val)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {notice && (
            <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#3a7a3a', marginBottom: '12px' }}>
              {notice}
            </p>
          )}

          {error && (
            <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b94040', marginBottom: '12px' }}>
              {error}
            </p>
          )}

          <button type="submit" disabled={busy} style={btn(true)}>
            {busy ? '...' : mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {/* Footer link */}
        <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', textAlign: 'center', marginTop: '8px' }}>
          {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
          <button
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setError('') }}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', color: '#1a1208', textDecoration: 'underline' }}
          >
            {mode === 'signin' ? 'Create one' : 'Sign in'}
          </button>
        </p>

      </div>
    </main>
  )
}
