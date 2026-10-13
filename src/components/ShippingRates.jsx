import { useState, useEffect } from 'react'
import { shippingRequest } from '../lib/shipping'
import Spinner from './Spinner'

// Live carrier rates for an order. The parent owns the address form; this asks
// the server for rates (it works out the package weight itself), lists them,
// and reports the customer's pick as { quoteId, rate, address }.
//
// `request` is the rest of the quote: { kind: 'cart', items } or { kind: 'cd', config }.
// `resetKey` changes whenever the order or address changes — any quote for the
// old one is dropped, since checkout rejects a quote that doesn't match.
export default function ShippingRates({ address, request, email, resetKey, value, onChange, signedIn = true }) {
  const [quote, setQuote] = useState(null)   // { id, rates }
  const [busy,  setBusy]  = useState(false)
  const [err,   setErr]   = useState('')

  useEffect(() => { setQuote(null); setErr(''); onChange(null) }, [resetKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const complete = ['name', 'street1', 'city', 'state', 'zip'].every(k => String(address?.[k] || '').trim())

  async function getRates() {
    setErr(''); setBusy(true)
    try {
      const r = await shippingRequest({ action: 'quote', address, email, ...request })
      setQuote({ id: r.id, rates: r.rates })
      onChange({ quoteId: r.id, rate: r.rates[0], address })   // cheapest preselected
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  if (!signedIn) {
    return <p className="font-mono text-[11px] text-warm-gray">Sign in to see shipping rates for your address.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {!quote && (
        <button type="button" onClick={getRates} disabled={busy || !complete}
          className="btn-outline w-full text-center disabled:opacity-50">
          {busy
            ? <span className="flex items-center justify-center gap-2"><Spinner />Getting live rates…</span>
            : complete ? 'Get shipping rates' : 'Enter your address to see shipping rates'}
        </button>
      )}
      {err && <p className="font-mono text-[11px] text-red-500" role="alert">{err}</p>}

      {quote && (
        <div className="flex flex-col gap-1" role="radiogroup" aria-label="Shipping service">
          {quote.rates.map(r => {
            const on = value?.rate?.objectId === r.objectId
            return (
              <label key={r.objectId}
                className="flex items-center justify-between gap-3 px-3 py-2 border cursor-pointer font-mono text-[12px]"
                style={{ borderColor: on ? 'rgb(var(--color-ink))' : '#c5bfb5' }}>
                <span className="flex items-center gap-2">
                  <input type="radio" name="shiprate" checked={on}
                    onChange={() => onChange({ quoteId: quote.id, rate: r, address })} />
                  <span>
                    {r.carrier} {r.service}
                    {r.days ? <span className="text-warm-gray"> · {r.days} day{r.days === 1 ? '' : 's'}</span> : null}
                  </span>
                </span>
                <span>${(r.amountCents / 100).toFixed(2)}</span>
              </label>
            )
          })}
          <p className="font-mono text-[10px] text-warm-gray">
            Live carrier rates for your package's weight. Delivery time starts when the order ships.
          </p>
        </div>
      )}
    </div>
  )
}
