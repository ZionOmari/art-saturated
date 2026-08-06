import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { checkoutArtistSubscription } from '../lib/stripe'
import { cancelMembership, resumeMembership, openBillingPortal } from '../lib/billing'

const fmtDate = (v) => {
  if (!v) return null
  const d = v.toDate ? v.toDate() : new Date(v)
  return isNaN(d) ? null : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
}

/**
 * Artist membership status + self-service billing.
 *
 * Cancelling sets cancel_at_period_end rather than ending immediately — the
 * month is already paid for. Membership state is written only by the Stripe
 * sync function, so after an action we tell the user what will happen instead
 * of optimistically rewriting the profile.
 */
export default function ArtistMembershipPanel({ profile }) {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [busy,   setBusy]   = useState(null)   // 'join' | 'cancel' | 'resume' | 'portal'
  const [error,  setError]  = useState(null)
  const [notice, setNotice] = useState(null)

  const active     = profile?.artistSubActive === true
  const status     = profile?.artistSubStatus || null
  const cancelling = profile?.artistSubCancelAtEnd === true
  const renewsOn   = fmtDate(profile?.artistSubCurrentEnd)

  async function run(kind, fn, onDone) {
    setBusy(kind); setError(null); setNotice(null)
    try {
      const res = await fn()
      onDone?.(res)
    } catch (err) {
      setError(err?.message || 'That did not work.')
    } finally {
      setBusy(null)
    }
  }

  const label = { fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgb(var(--color-ink))', margin: 0 }
  const body  = { fontFamily: 'monospace', fontSize: '13px', color: 'rgb(var(--color-ink))', margin: '0 0 4px' }
  const sub   = { fontFamily: 'monospace', fontSize: '12px', color: '#8a857d', margin: 0, lineHeight: 1.6 }
  const linkBtn = { background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'monospace', fontSize: '11px', color: 'rgb(var(--color-warm-gray))', padding: 0 }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '14px' }}>
        <span style={{ fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#f5f0e8', background: 'rgb(var(--color-ink))', padding: '3px 7px' }}>M</span>
        <p style={label}>Membership</p>
      </div>

      <div style={{
        padding: '16px',
        border: '1px solid #e8e0d4',
        background: active ? 'rgba(58,122,64,0.05)' : '#faf8f4',
        marginBottom: '20px',
      }}>
        {active ? (
          <>
            <p style={{ ...body, color: '#3a7a40' }}>
              ✓ Artist membership active — $7.99/month
            </p>
            {cancelling ? (
              <p style={sub}>
                Ends{renewsOn ? ` on ${renewsOn}` : ' at the end of this period'}. You can keep
                uploading until then, and everything already listed stays up afterwards.
              </p>
            ) : (
              <p style={sub}>
                Unlimited uploads.{renewsOn ? ` Renews ${renewsOn}.` : ''}
              </p>
            )}
          </>
        ) : status === 'past_due' ? (
          <>
            <p style={{ ...body, color: '#b97a30' }}>Payment failed</p>
            <p style={sub}>
              Uploads are paused until the payment goes through. Your listed work is
              untouched.
            </p>
          </>
        ) : (
          <>
            <p style={body}>No membership</p>
            <p style={sub}>
              $7.99/month for unlimited uploads to your profile and the shop.
              {status ? ' Your previous membership has ended — work you listed is still up.' : ''}
            </p>
          </>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
        {!active && (
          <button
            className="btn-outline"
            disabled={busy === 'join'}
            onClick={() => run('join', () => checkoutArtistSubscription({ customerEmail: user.email }))}
          >
            {busy === 'join' ? 'Opening checkout…' : 'Join for $7.99/month'}
          </button>
        )}

        {active && (
          <button className="btn-outline" onClick={() => navigate('/gallery-upload')}>
            Upload Your Work →
          </button>
        )}

        {active && !cancelling && (
          <button
            style={linkBtn}
            disabled={busy === 'cancel'}
            onClick={() => {
              if (!window.confirm('Cancel your membership? You can keep uploading until the end of the period you have paid for, and work already listed stays up.')) return
              run('cancel', cancelMembership, () => setNotice('Membership will end at the end of this period.'))
            }}
          >
            {busy === 'cancel' ? 'Cancelling…' : 'Cancel membership'}
          </button>
        )}

        {active && cancelling && (
          <button
            style={{ ...linkBtn, color: '#3a7a40' }}
            disabled={busy === 'resume'}
            onClick={() => run('resume', resumeMembership, () => setNotice('Membership will continue.'))}
          >
            {busy === 'resume' ? 'Resuming…' : 'Keep my membership'}
          </button>
        )}

        {(active || status) && (
          <button
            style={linkBtn}
            disabled={busy === 'portal'}
            onClick={() => run('portal', openBillingPortal, (res) => {
              if (res?.url) window.location.href = res.url
            })}
          >
            {busy === 'portal' ? 'Opening…' : 'Manage billing'}
          </button>
        )}
      </div>

      {notice && (
        <p style={{ ...sub, marginTop: '12px', color: '#3a7a40' }}>
          {notice} It may take a moment to show above.
        </p>
      )}
      {error && (
        <p role="alert" style={{ ...sub, marginTop: '12px', color: '#b94040' }}>{error}</p>
      )}
    </div>
  )
}
