const functions = require('firebase-functions/v1')
const admin     = require('firebase-admin')
const { FieldValue } = require('firebase-admin/firestore')  // modular import — `admin.firestore.FieldValue` resolves undefined under the Functions emulator
const nodemailer = require('nodemailer')
const Stripe    = require('stripe')
const sharp     = require('sharp')

admin.initializeApp()

// Admin SDK rejects `undefined` field values by default (a common cause of
// silent WriteBatch.commit failures). Mirror the client SDK and ignore them.
admin.firestore().settings({ ignoreUndefinedProperties: true })

// orders@artsaturated.com has no mailbox — anything addressed to it hard-bounces.
// OWNER_EMAIL is the real inbox and is where every admin notification must go.
// FROM_EMAIL is only a sender identity, and Gmail SMTP overrides it with GMAIL_USER anyway.
const OWNER_EMAIL = 'zionomari@artsaturated.com'
const FROM_EMAIL  = process.env.GMAIL_USER || OWNER_EMAIL
const STORE_NAME = 'Art Saturated'
const CLIENT_URL = 'https://artsaturated.com'

// Artist membership. Amount lives here so checkout, emails and the UI copy
// can't drift apart; change it in one place.
const ARTIST_PLAN = {
  amount: 799,          // cents, per month
  label:  '$7.99/month',
}

// ── Email transport — Gmail / Google Workspace SMTP via nodemailer ───────────
// Auth uses an app password (GMAIL_APP_PASSWORD) on the GMAIL_USER mailbox.
let _transporter = null
function mailer() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: process.env.GMAIL_USER, pass: (process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '') },
    })
  }
  return _transporter
}
// No-op kept so existing call sites don't need touching (email now goes via Gmail SMTP)
function initSG() {}

// ── Test seams ───────────────────────────────────────────────────────────────
// The suite runs this file in-process, and CommonJS `require` can't be
// intercepted by the test runner's module mocks. These two hooks are the whole
// mechanism: both are inert unless FUNCTIONS_TEST is set, which only vitest does.
let _stripeStub = null          // swapped in by tests; null in production
const _sentMail = []            // captured instead of sent, tests assert on it

function stripe() {
  if (_stripeStub) return _stripeStub
  return Stripe(process.env.STRIPE_SECRET_KEY, { timeout: 15000 })
}

// ── Email helper — removes repeated from/to boilerplate ──────────────────────
function sendEmail(to, subject, text) {
  const from = process.env.GMAIL_USER || FROM_EMAIL
  const message = { to, subject, text, from: `"${STORE_NAME}" <${from}>` }
  if (process.env.FUNCTIONS_TEST) {
    _sentMail.push(message)
    return Promise.resolve({ messageId: 'captured-by-test' })
  }
  return mailer().sendMail(message)
}

function itemList(items = []) {
  return items.map(i => `  • ${i.name} x${i.qty || 1} — $${i.price}`).join('\n')
}

// Single-source email body builder — greeting + blank + lines + blank + sign-off
function fmtEmail(name, lines, signOff = '— Art Saturated') {
  return [`Hey ${name || 'there'},`, '', ...lines, '', signOff].join('\n')
}

function shippingWindow() {
  const now  = new Date()
  const low  = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
  const high = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const fmt  = d => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return `${fmt(low)} – ${fmt(high)}`
}

// ── Stripe: Firestore-triggered checkout (avoids HTTP IAM restrictions) ───────
exports.onCheckoutRequestCreated = functions
  .runWith({ timeoutSeconds: 120 })
  .firestore
  .document('checkoutRequests/{docId}')
  .onCreate(async (snap) => {
    const data = snap.data()

    async function safeUpdate(payload) {
      try { await snap.ref.update(payload) } catch (e) { console.error('safeUpdate failed:', e) }
    }

    try {
      const { items, customerEmail, orderId, shippingCost, shippingMethod, taxAmount, type } = data
      const key = process.env.STRIPE_SECRET_KEY
      console.log('Stripe key present:', !!key, 'type:', type)

      const s = stripe()

      // ── Artist upload subscription ($7.99/month) ────────────────────────────
      // Uses inline price_data rather than a pre-made Stripe Price so the amount
      // lives in one place (ARTIST_PLAN) and no dashboard setup is required.
      if (type === 'artist_subscription') {
        if (!data.uid) {
          await safeUpdate({ status: 'error', error: 'You must be signed in to subscribe.' })
          return
        }

        // Don't let someone pay twice for the same thing.
        const userSnap = await admin.firestore().doc(`users/${data.uid}`).get()
        if (userSnap.exists && userSnap.data().artistSubStatus === 'active') {
          await safeUpdate({ status: 'error', error: 'You already have an active membership.' })
          return
        }

        const session = await s.checkout.sessions.create({
          mode: 'subscription',
          line_items: [{
            price_data: {
              currency: 'usd',
              unit_amount: ARTIST_PLAN.amount,
              recurring: { interval: 'month' },
              product_data: {
                name: 'Art Saturated — Artist Membership',
              },
            },
            quantity: 1,
          }],
          customer_email: data.customerEmail || undefined,
          // client_reference_id survives onto the subscription's checkout session,
          // and metadata is copied to the subscription itself so the reconciler
          // can map a subscription back to a user without a lookup table.
          client_reference_id: data.uid,
          subscription_data: { metadata: { uid: data.uid, type: 'artist_subscription' } },
          success_url: `${CLIENT_URL}/account?acctab=artist&subscribed=1`,
          cancel_url:  `${CLIENT_URL}/account?acctab=artist`,
          metadata: { uid: data.uid, type: 'artist_subscription' },
        })
        await safeUpdate({ status: 'ready', url: session.url })
        return
      }

      // ── Blog / magazine article submission fee ──────────────────────────────
      if (type === 'blog') {
        const configSnap = await admin.firestore().doc('settings/storeConfig').get()
        const blogFee = configSnap.exists ? (configSnap.data().blogSubmissionFee ?? 0) : 0

        if (!blogFee || Number(blogFee) <= 0) {
          // No fee — mark as pending_review immediately
          if (data.submissionId) {
            await admin.firestore().collection('blogSubmissions').doc(data.submissionId).update({
              status: 'pending_review', feePaid: true,
            }).catch(() => {})
          }
          await safeUpdate({ status: 'ready', url: `${CLIENT_URL}/payment-success?type=blog` })
          return
        }

        const session = await s.checkout.sessions.create({
          payment_method_types: ['card'],
          mode: 'payment',
          line_items: [{
            price_data: {
              currency: 'usd',
              unit_amount: Math.round(Number(blogFee) * 100),
              product_data: { name: `Article Submission — Art Saturated Magazine` },
            },
            quantity: 1,
          }],
          customer_email: data.customerEmail || undefined,
          success_url: `${CLIENT_URL}/payment-success?type=blog`,
          cancel_url:  `${CLIENT_URL}/blog-submit`,
          metadata: { submissionId: data.submissionId || '', type: 'blog_submission' },
        })
        await safeUpdate({ status: 'ready', url: session.url })
        return
      }

      if (type === 'preorder') {
        const albumSlug = data.albumSlug || 'enigma'
        const albumName = data.albumName || 'Album'
        const artistName = data.artistName || ''

        // Look up authoritative price from Firestore
        let albumPrice = 1000 // fallback $10.00 in cents
        try {
          const albumSnap = await admin.firestore().doc(`albumPreorders/${albumSlug}`).get()
          if (albumSnap.exists) {
            albumPrice = Math.round((albumSnap.data().price ?? 10) * 100)
          }
        } catch (e) { /* use fallback */ }

        const lineItemLabel = artistName
          ? `${albumName} — Album Preorder (${artistName})`
          : `${albumName} — Album Preorder`

        const lineItems = [{
          price_data: {
            currency: 'usd',
            unit_amount: albumPrice,
            product_data: { name: lineItemLabel },
          },
          quantity: 1,
        }]

        const shipCost = Number(data.shippingCost) || 0
        if (data.shippingMethod === 'ship' && shipCost > 0) {
          lineItems.push({
            price_data: {
              currency: 'usd',
              unit_amount: Math.round(shipCost * 100),
              product_data: { name: 'Shipping & Handling' },
            },
            quantity: 1,
          })
        }

        const sessionParams = {
          payment_method_types: ['card'],
          mode: 'payment',
          line_items: lineItems,
          customer_email: data.customerEmail || undefined,
          success_url: `${CLIENT_URL}/payment-success?type=preorder`,
          cancel_url:  `${CLIENT_URL}/preorder/${albumSlug}`,
          metadata: {
            type:           'preorder',
            albumSlug,
            uid:            data.uid || '',
            shippingMethod: data.shippingMethod || 'digital',
          },
        }

        if (data.shippingMethod === 'ship') {
          sessionParams.shipping_address_collection = { allowed_countries: ['US'] }
        }

        const session = await s.checkout.sessions.create(sessionParams)
        await safeUpdate({ status: 'ready', url: session.url })
        return
      }

      if (type === 'workshop_deposit') {
        const session = await s.checkout.sessions.create({
          payment_method_types: ['card'],
          mode: 'payment',
          line_items: [{
            price_data: {
              currency: 'usd',
              unit_amount: 2500,
              product_data: { name: '1:1 Deep Consciousness Session — Deposit' },
            },
            quantity: 1,
          }],
          customer_email: customerEmail,
          success_url: `${CLIENT_URL}/workshop?deposit=success`,
          cancel_url:  `${CLIENT_URL}/workshop`,
          metadata: { type: 'workshop_deposit', bookingName: data.bookingName || '' },
        })
        console.log('Workshop deposit session created:', session.id)
        await safeUpdate({ status: 'ready', url: session.url })
        return
      }

      if (type === 'deposit') {
        // Validate deposit amount server-side — never trust the client value
        if (!data.productId) {
          await safeUpdate({ status: 'error', error: 'Missing productId.' })
          return
        }
        const productSnap = await admin.firestore().collection('products').doc(data.productId).get()
        if (!productSnap.exists) {
          await safeUpdate({ status: 'error', error: 'Product not found.' })
          return
        }
        const depositAmount = productSnap.data().depositAmount
        if (!depositAmount || Number(depositAmount) <= 0) {
          await safeUpdate({ status: 'error', error: 'No deposit configured for this product.' })
          return
        }

        const session = await s.checkout.sessions.create({
          payment_method_types: ['card'],
          mode: 'payment',
          line_items: [{
            price_data: {
              currency: 'usd',
              unit_amount: Math.round(Number(depositAmount) * 100),
              product_data: { name: `Deposit — ${data.productName}` },
            },
            quantity: 1,
          }],
          customer_email: customerEmail,
          success_url: `${CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&type=deposit&orderId=${orderId}`,
          cancel_url:  `${CLIENT_URL}/shop`,
          metadata: { orderId, type: 'deposit' },
        })
        console.log('Deposit session created:', session.id)
        await safeUpdate({ status: 'ready', url: session.url })
        return
      }

      // ── Availability pre-check + server price capture ───────────────────
      const serverPrices     = {}   // id → verified price from Firestore
      const serverCategories = {}   // id → category string
      for (const item of (items || [])) {
        if (!item.id) continue
        const pSnap = await admin.firestore().collection('products').doc(item.id).get()
        if (!pSnap.exists || pSnap.data().sold) {
          await safeUpdate({ status: 'error', error: `"${item.name || 'An item'}" is no longer available.` })
          return
        }
        const p     = pSnap.data()
        const stock = p.stock
        if (stock != null && stock !== '' && Number(stock) < (item.qty || 1)) {
          await safeUpdate({ status: 'error', error: `"${item.name || 'An item'}" doesn't have enough stock (only ${stock} left).` })
          return
        }
        serverPrices[item.id]     = Number(p.price)      // always use DB price, not client
        serverCategories[item.id] = p.category || ''
      }

      // Standard order — price comes from Firestore, not client payload
      const lineItems = (items || []).map(item => ({
        price_data: {
          currency: 'usd',
          unit_amount: Math.round((serverPrices[item.id] ?? Number(item.price)) * 100),
          product_data: { name: String(item.name || 'Item') },
        },
        quantity: Number(item.qty) || 1,
      }))

      if (shippingMethod !== 'pickup' && Number(shippingCost) > 0) {
        lineItems.push({
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(Number(shippingCost) * 100),
            product_data: { name: 'Shipping & Handling' },
          },
          quantity: 1,
        })
      }

      if (Number(taxAmount) > 0) {
        lineItems.push({
          price_data: {
            currency: 'usd',
            unit_amount: Math.round(Number(taxAmount) * 100),
            product_data: { name: 'Sales Tax (7%)' },
          },
          quantity: 1,
        })
      }

      // ── Bundle deal — validate server-side, create Stripe coupon ────────
      let sessionDiscounts = []
      if (data.bundleDiscount && Number(data.bundleDiscount) > 0) {
        try {
          const configSnap = await admin.firestore().doc('settings/storeConfig').get()
          const bundleDeal = configSnap.exists ? configSnap.data().bundleDeal : null
          if (bundleDeal?.enabled && bundleDeal?.minQty && bundleDeal?.discountPct) {
            // Count Physical Media qty from server-verified categories
            const physQty = (items || []).reduce((sum, item) =>
              serverCategories[item.id] === 'Physical Media' ? sum + (Number(item.qty) || 1) : sum, 0)
            if (physQty >= bundleDeal.minQty) {
              const physSubtotal = (items || []).reduce((sum, item) =>
                serverCategories[item.id] === 'Physical Media'
                  ? sum + (serverPrices[item.id] ?? 0) * (Number(item.qty) || 1)
                  : sum, 0)
              const serverDiscount = parseFloat((physSubtotal * bundleDeal.discountPct / 100).toFixed(2))
              if (serverDiscount > 0) {
                const coupon = await s.coupons.create({
                  amount_off: Math.round(serverDiscount * 100),
                  currency: 'usd',
                  duration: 'once',
                  name: `Bundle Deal (${bundleDeal.discountPct}% off Physical Media)`,
                })
                sessionDiscounts = [{ coupon: coupon.id }]
                console.log('Bundle coupon created:', coupon.id, 'amount_off:', serverDiscount)
              }
            }
          }
        } catch (bundleErr) {
          console.error('Bundle deal error (non-fatal):', bundleErr.message)
          // Non-fatal — proceed without discount rather than blocking checkout
        }
      }

      console.log('Creating Stripe session, lineItems:', lineItems.length)
      const session = await s.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        line_items: lineItems,
        customer_email: customerEmail,
        ...(sessionDiscounts.length ? { discounts: sessionDiscounts } : {}),
        success_url: `${CLIENT_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&type=order&orderId=${orderId}`,
        cancel_url:  `${CLIENT_URL}/payment-cancelled`,
        metadata: { orderId, type: 'order', shippingMethod: shippingMethod || 'ship' },
      })

      console.log('Session created:', session.id, 'url:', !!session.url)
      await safeUpdate({ status: 'ready', url: session.url })
    } catch (err) {
      console.error('onCheckoutRequestCreated error:', err.message, err.stack)
      await safeUpdate({ status: 'error', error: err.message || 'Unknown error' })
    }
  })


// ── Stripe: Webhook ───────────────────────────────────────────────────────────
// NOTE: this endpoint currently returns 403 to Stripe. The project cannot grant
// `allUsers` invoker (deploy fails with "Failed to set the IAM Policy" — an org
// policy blocks public bindings, which is why every other HTTP path here was
// rewritten as a Firestore trigger). Until that policy is lifted, payments are
// captured by the scheduled reconcileStripePayments function below instead.
// Both routes call the same handlePaidSession(), so this starts working the
// moment the endpoint becomes reachable — no code change needed.
// Settlement path for one paid Checkout Session. Idempotent — the webhook and the
// scheduled reconciler may both call it for the same session.
async function handlePaidSession(session) {
    const meta = session.metadata || {}
    const db   = admin.firestore()

    // The event can fire before funds settle on some payment methods — never
    // mark anything paid (or raise an orphan alert) until Stripe says it is.
    if (!['paid', 'no_payment_required'].includes(session.payment_status)) {
      console.log(`Session ${session.id} not settled (payment_status=${session.payment_status}) — ignoring.`)
      return
    }

    // Idempotency lock. The webhook and the reconciler can both deliver the same
    // session, and the reconciler re-scans a rolling window every run. Without
    // this, stock would decrement twice and customers would get repeat emails.
    const lockRef = db.doc(`stripeSessions/${session.id}`)
    const isFirst = await db.runTransaction(async (txn) => {
      if ((await txn.get(lockRef)).exists) return false
      txn.set(lockRef, {
        type:        meta.type || null,
        amount:      (session.amount_total || 0) / 100,
        email:       session.customer_details?.email || session.customer_email || '',
        processedAt: FieldValue.serverTimestamp(),
      })
      return true
    })
    if (!isFirst) {
      console.log(`Session ${session.id} already processed — skipping.`)
      return
    }

    // Stripe Payment Links (and dashboard-created invoices) arrive with no
    // metadata.type, so every branch below skips them and the sale leaves no
    // trace on the site. Catch that case explicitly rather than silently 200-ing.
    const KNOWN_TYPES = ['order', 'deposit', 'blog_submission', 'workshop_deposit', 'preorder', 'artist_subscription']

    // The magazine article fee still goes through a Stripe Payment Link, which
    // carries no metadata — only client_reference_id. Infer the type so it isn't
    // treated as an orphan.
    //
    // The $1 art-listing fee was retired in August 2026. It is deliberately NOT
    // inferred any more: a payment arriving through the old (now deactivated)
    // link falls through to the orphan handler, which records it and emails the
    // shop — far better than silently marking a submission paid for a fee that
    // no longer exists.
    let effectiveType = meta.type
    if (!KNOWN_TYPES.includes(effectiveType) && session.client_reference_id) {
      const refId = session.client_reference_id
      if ((await db.doc(`blogSubmissions/${refId}`).get()).exists) {
        effectiveType = 'blog_submission'
      }
    }

    if (!KNOWN_TYPES.includes(effectiveType)) {
      const email = session.customer_details?.email || session.customer_email || ''
      const addr  = session.shipping_details?.address || session.customer_details?.address || null
      let lineItems = []
      try {
        const li = await stripe().checkout.sessions.listLineItems(session.id, { limit: 20 })
        lineItems = li.data.map(i => `${i.description} x${i.quantity} — $${((i.amount_total || 0) / 100).toFixed(2)}`)
      } catch (e) { console.error('listLineItems failed:', e.message) }

      console.warn(`Webhook: unrecognised paid session ${session.id} (type=${meta.type || 'none'}, link=${session.payment_link || 'none'})`)

      await db.collection('orphanedPayments').doc(session.id).set({
        reason:          'no-metadata-type',
        source:          session.payment_link ? 'payment_link' : 'unknown',
        paymentLink:     session.payment_link || null,
        email,
        name:            session.customer_details?.name || '',
        amount:          (session.amount_total || 0) / 100,
        items:           lineItems,
        shippingAddress: addr,
        stripeSessionId: session.id,
        fulfilled:       false,
        createdAt:       FieldValue.serverTimestamp(),
      }).catch(e => console.error('orphanedPayments write failed:', e.message))

      await sendEmail(OWNER_EMAIL,
        `⚠ Payment received outside the shop — $${((session.amount_total || 0) / 100).toFixed(2)}`,
        [
          'Someone paid through a Stripe Payment Link (or another off-site route).',
          'This did NOT create an order in the admin panel — fulfil it manually.',
          '',
          `Customer:  ${session.customer_details?.name || '—'}`,
          `Email:     ${email || '—'}`,
          `Amount:    $${((session.amount_total || 0) / 100).toFixed(2)}`,
          '',
          lineItems.length ? `Items:\n  ${lineItems.join('\n  ')}` : 'Items: (could not read line items)',
          '',
          addr ? `Ship to:\n  ${addr.line1 || ''}${addr.line2 ? ' ' + addr.line2 : ''}\n  ${addr.city || ''}, ${addr.state || ''} ${addr.postal_code || ''}` : 'No shipping address collected.',
          '',
          `Stripe session: ${session.id}`,
        ].join('\n'),
      ).catch(e => console.error('Orphan payment alert failed:', e.message))

      return
    }

    // ── Product order paid ──────────────────────────────────────────────────
    if (effectiveType === 'order' && meta.orderId) {
      const orderRef = db.doc(`orders/${meta.orderId}`)

      // A missing order doc can never be fixed by a retry — record the payment
      // so the sale is not lost silently, alert the shop, and still 200 Stripe.
      if (!(await orderRef.get()).exists) {
        console.error(`Webhook: order ${meta.orderId} not found for paid session ${session.id}`)
        await db.collection('orphanedPayments').doc(session.id).set({
          orderId: meta.orderId,
          email:   session.customer_details?.email || session.customer_email || '',
          amount:  (session.amount_total || 0) / 100,
          stripeSessionId: session.id,
          createdAt: FieldValue.serverTimestamp(),
        }).catch(e => console.error('orphanedPayments write failed:', e.message))
        await sendEmail(OWNER_EMAIL,
          `⚠ Paid order with no record — ${session.id}`,
          [
            'A Stripe payment succeeded but the matching order document is missing.',
            '',
            `Order ID:  ${meta.orderId}`,
            `Customer:  ${session.customer_details?.email || session.customer_email || '—'}`,
            `Amount:    $${(session.amount_total || 0) / 100}`,
            `Session:   ${session.id}`,
            '',
            'Fulfil this manually and refund if it cannot be reconstructed.',
          ].join('\n'),
        ).catch(e => console.error('Orphan alert email failed:', e.message))
        return
      }

      await orderRef.update({
        paymentStatus: 'paid',
        stripeSessionId: session.id,
        paidAt: FieldValue.serverTimestamp(),
      })

      // Decrement stock + mark sold when stock hits 0 (atomic per item)
      try {
        const orderSnap = await db.doc(`orders/${meta.orderId}`).get()
        const orderData = orderSnap.data()
        if (orderData?.items?.length) {
          for (const item of orderData.items) {
            if (!item.id) continue
            await db.runTransaction(async (txn) => {
              const pRef  = db.doc(`products/${item.id}`)
              const pSnap = await txn.get(pRef)
              if (!pSnap.exists) return
              const pd      = pSnap.data()
              const updates = {}
              const hasStock = pd.stock != null && pd.stock !== ''
              if (hasStock) {
                const newStock = Number(pd.stock) - (item.qty || 1)
                updates.stock = newStock
                if (newStock <= 0) updates.sold = true
              } else if (pd.unique) {
                // No stock field but flagged unique — mark sold
                updates.sold = true
              }
              if (Object.keys(updates).length) txn.update(pRef, updates)
            })
          }
        }
      } catch (stockErr) {
        console.error('Stock decrement error:', stockErr)
      }
    }

    // ── Deposit paid ────────────────────────────────────────────────────────
    if (effectiveType === 'deposit' && meta.orderId) {
      await db.doc(`orders/${meta.orderId}`).update({
        paymentStatus: 'deposit_paid',
        stripeSessionId: session.id,
        depositPaidAt: FieldValue.serverTimestamp(),
      })
    }

    // ── Blog submission fee paid ─────────────────────────────────────────────
    if (effectiveType === 'blog_submission') {
      const blogId = meta.submissionId || session.client_reference_id
      if (blogId) {
        await db.doc(`blogSubmissions/${blogId}`).update({
          feePaid: true,
          stripeSessionId: session.id,
          paidAt: FieldValue.serverTimestamp(),
          status: 'pending_review',
        }).catch(() => {})
      }
    }

    // ── Workshop 1:1 deposit paid ─────────────────────────────────────────────
    if (effectiveType === 'workshop_deposit') {
      initSG()
      const customerEmail = session.customer_details?.email || session.customer_email || ''
      const bookingName   = meta.bookingName || session.customer_details?.name || ''

      await db.collection('workshopBookings').add({
        name:            bookingName,
        email:           customerEmail,
        amount:          (session.amount_total || 0) / 100,
        stripeSessionId: session.id,
        status:          'deposit_paid',
        paidAt:          FieldValue.serverTimestamp(),
      })

      if (customerEmail) {
        await sendEmail(
          customerEmail,
          'Workshop Deposit Received — Art Saturated',
          fmtEmail(bookingName || undefined, [
            'Your $25 deposit for a 1:1 Deep Consciousness Session has been received.',
            '',
            'Zion will confirm your session within 24 hours and collect the remaining $25 at that time.',
            'Your Google Meet link will be sent 10–15 minutes before your session.',
            '',
            'If you have any questions, reply to this email.',
          ]),
        ).catch(e => console.error('Workshop deposit customer email error:', e.message))
      }

      await sendEmail(
        OWNER_EMAIL,
        `Workshop 1:1 Deposit — ${bookingName || customerEmail || 'Unknown'}`,
        [
          'New workshop 1:1 deposit received!',
          '',
          `Name:    ${bookingName || '—'}`,
          `Email:   ${customerEmail || '—'}`,
          `Amount:  $${(session.amount_total || 0) / 100}`,
          '',
          'Action needed: confirm their session and collect the remaining $25.',
        ].join('\n'),
      ).catch(e => console.error('Workshop deposit admin email error:', e.message))
    }

    // ── Enigma album preorder paid ───────────────────────────────────────────
    // ── Artist membership started ────────────────────────────────────────────
    // The hourly sync would catch this eventually, but a new subscriber should
    // get access within the reconciler's 5 minutes, not up to an hour.
    if (effectiveType === 'artist_subscription') {
      const subId = typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id
      if (!subId) {
        console.error(`Subscription session ${session.id} has no subscription id.`)
        return
      }
      try {
        const sub = await stripe().subscriptions.retrieve(subId)
        await syncArtistSubscription(sub)
      } catch (err) {
        console.error(`Could not activate membership for session ${session.id}:`, err.message)
        await sendEmail(OWNER_EMAIL,
          `⚠ Artist membership paid but not activated — ${session.id}`,
          [
            'A $7.99 artist membership was paid but could not be activated automatically.',
            '',
            `Customer: ${session.customer_details?.email || session.customer_email || '—'}`,
            `Subscription: ${subId}`,
            '',
            'The hourly membership sync should recover this. If it does not, grant',
            'access manually by setting artistSubActive on their user document.',
          ].join('\n'),
        ).catch(() => {})
      }
      return
    }

    if (effectiveType === 'preorder') {
      initSG()
      const customerEmail = session.customer_details?.email || session.customer_email || ''
      const customerName  = session.customer_details?.name  || ''
      const shippingAddr  = session.shipping_details?.address || null

      await db.collection('preorders').doc(session.id).set({
        uid:             meta.uid || '',
        email:           customerEmail,
        name:            customerName,
        albumSlug:       meta.albumSlug || 'enigma',
        albumName:       'Enigma',
        stripeSessionId: session.id,
        amount:          (session.amount_total || 0) / 100,
        shippingMethod:  meta.shippingMethod || 'digital',
        shippingAddress: shippingAddr,
        status:          'confirmed',
        paidAt:          FieldValue.serverTimestamp(),
      })

      if (customerEmail) {
        const shipMethod = meta.shippingMethod || 'digital'
        const deliveryLine = shipMethod === 'ship'
          ? "A physical copy will be shipped to you when the album drops. We'll email you tracking info."
          : shipMethod === 'pickup'
          ? "Your physical copy will be ready for pickup when the album drops. We'll reach out with details."
          : "You'll receive a download link as soon as the album is released."

        await sendEmail(
          customerEmail,
          'Enigma Preorder Confirmed — Art Saturated',
          fmtEmail(customerName || undefined, [
            'Your preorder for Enigma by Zionomari is confirmed.',
            '',
            deliveryLine,
            '',
            'Thank you for supporting the music.',
          ])
        ).catch(e => console.error('Preorder email error:', e.message))
      }

      await sendEmail(
        OWNER_EMAIL,
        `New Preorder — ${meta.albumSlug || 'enigma'} (${customerName || customerEmail || 'Unknown'})`,
        [
          'New album preorder!',
          '',
          `Name:      ${customerName || '—'}`,
          `Email:     ${customerEmail || '—'}`,
          `Amount:    $${(session.amount_total || 0) / 100}`,
          `Delivery:  ${meta.shippingMethod || 'digital'}`,
          ...(shippingAddr ? ['', 'Ship to:', `  ${shippingAddr.line1 || ''}`, `  ${shippingAddr.city || ''}, ${shippingAddr.state || ''} ${shippingAddr.postal_code || ''}`] : []),
          '',
          `Manage: ${CLIENT_URL}/admin`,
        ].join('\n'),
      ).catch(e => console.error('Preorder admin email error:', e.message))
    }
}

// Exposed to the test suite only. Guarded so the deploy-time export scan never
// sees a non-trigger export (FUNCTIONS_TEST is set by vitest, never by deploy).
if (process.env.FUNCTIONS_TEST) {
  exports.handlePaidSession = handlePaidSession
  exports.notifyOrderPaid   = notifyOrderPaid
  exports.__sentMail        = _sentMail
  exports.__setStripeStub   = (stub) => { _stripeStub = stub }
}

exports.stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig    = req.headers['stripe-signature']
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  let event

  try {
    event = stripe().webhooks.constructEvent(req.rawBody, sig, secret)
  } catch (err) {
    console.error('Webhook signature error:', err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  if (event.type === 'checkout.session.completed') {
    try {
      await handlePaidSession(event.data.object)
    } catch (err) {
      // 500 so Stripe retries rather than dropping the payment on the floor.
      console.error('handlePaidSession failed:', err.message, err.stack)
      return res.status(500).send('Handler error')
    }
  }

  return res.json({ received: true })
})

// ── Artist membership state ──────────────────────────────────────────────────
// Subscription *lifecycle* (renewal, failed card, cancellation) only ever
// arrives as webhook events, and this project's webhook is unreachable. So
// access is driven by polling Stripe's subscription objects instead, which
// carry current state rather than a change feed. syncArtistSubscription is the
// single place that writes membership fields onto a user.
//
// Access rule: uploads require an active membership, but work already listed
// stays live when a membership lapses — see canArtistUpload().
async function syncArtistSubscription(sub) {
  const uid = sub.metadata?.uid
  if (!uid) {
    console.warn(`Subscription ${sub.id} has no uid metadata — cannot map to a user.`)
    return null
  }

  // 'trialing' and 'active' grant access. 'past_due' does not: the card already
  // failed, and Stripe keeps retrying, so treat it as lapsed until it recovers.
  const active = ['active', 'trialing'].includes(sub.status)

  const patch = {
    artistSubStatus:       sub.status,
    artistSubActive:       active,
    artistSubId:           sub.id,
    artistSubCurrentEnd:   sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
    artistSubCancelAtEnd:  !!sub.cancel_at_period_end,
    artistSubSyncedAt:     FieldValue.serverTimestamp(),
  }

  const ref  = admin.firestore().doc(`users/${uid}`)
  const snap = await ref.get()
  if (!snap.exists) {
    console.warn(`Subscription ${sub.id} references missing user ${uid}.`)
    return null
  }
  const before = snap.data().artistSubActive === true

  await ref.set(patch, { merge: true })

  // Only email on an actual transition, never on every poll.
  if (before !== active) {
    const email = snap.data().email
    if (email && active) {
      await sendEmail(email, 'Artist Membership Active — Art Saturated',
        fmtEmail(snap.data().name, [
          `Your artist membership is active (${ARTIST_PLAN.label}).`,
          '',
          'You can now upload work to your artist profile and the shop.',
          '',
          `Start here: ${CLIENT_URL}/gallery-upload`,
        ]),
      ).catch(e => console.error('Membership start email failed:', e.message))
    } else if (email && !active) {
      await sendEmail(email, 'Artist Membership Ended — Art Saturated',
        fmtEmail(snap.data().name, [
          'Your artist membership has ended, so new uploads are paused.',
          '',
          'Everything you have already listed stays up and stays for sale —',
          'nothing has been removed.',
          '',
          `Resubscribe any time: ${CLIENT_URL}/account?acctab=artist`,
        ]),
      ).catch(e => console.error('Membership end email failed:', e.message))
    }
    console.log(`Artist membership for ${uid}: ${before} → ${active} (${sub.status})`)
  }

  return { uid, active }
}

// ── Self-service billing (cancel / resume / manage) ──────────────────────────
// Callable functions are unreachable in this project (403), so the client writes
// a request document and reads the answer back off it — the same pattern as
// checkoutRequests. Never trust the client for identity here: the subscription
// id is read from the caller's own user document, never from the request.
exports.onBillingRequestCreated = functions
  .runWith({ timeoutSeconds: 60 })
  .firestore
  .document('billingRequests/{docId}')
  .onCreate(async (snap) => {
    const { uid, action } = snap.data() || {}

    const done = (payload) => snap.ref.update(payload).catch(e => console.error('billing update failed:', e.message))

    try {
      if (!uid) return done({ status: 'error', error: 'Missing user.' })

      const userSnap = await admin.firestore().doc(`users/${uid}`).get()
      const subId = userSnap.exists ? userSnap.data().artistSubId : null
      if (!subId) return done({ status: 'error', error: 'No membership found on this account.' })

      const s = stripe()

      if (action === 'cancel') {
        // Cancel at period end, never immediately — they paid through the
        // current month and should keep uploading until it runs out.
        const sub = await s.subscriptions.update(subId, { cancel_at_period_end: true })
        await syncArtistSubscription(sub)
        return done({ status: 'done', cancelAtPeriodEnd: true })
      }

      if (action === 'resume') {
        const sub = await s.subscriptions.update(subId, { cancel_at_period_end: false })
        await syncArtistSubscription(sub)
        return done({ status: 'done', cancelAtPeriodEnd: false })
      }

      if (action === 'portal') {
        // Full self-service (card updates, invoices, cancellation). Requires the
        // Customer Portal to be enabled once in the Stripe dashboard; if it is
        // not, say so plainly rather than surfacing a raw Stripe error.
        const sub = await s.subscriptions.retrieve(subId)
        try {
          const portal = await s.billingPortal.sessions.create({
            customer: sub.customer,
            return_url: `${CLIENT_URL}/account?acctab=artist`,
          })
          return done({ status: 'done', url: portal.url })
        } catch (portalErr) {
          console.error('Billing portal error:', portalErr.message)
          return done({
            status: 'error',
            error: 'Billing management is not set up yet. Use Cancel Membership, or email us.',
          })
        }
      }

      return done({ status: 'error', error: 'Unknown billing action.' })
    } catch (err) {
      console.error('onBillingRequestCreated failed:', err.message)
      return done({ status: 'error', error: err.message || 'Something went wrong.' })
    }
  })

// ── Scheduled: keep artist memberships in sync with Stripe ───────────────────
// Hourly is enough: a lapse costs at most an hour of extra upload access, and
// polling every subscription every 5 minutes would be wasteful.
exports.syncArtistMemberships = functions
  .runWith({ timeoutSeconds: 300 })
  .pubsub.schedule('every 60 minutes')
  .onRun(async () => {
    let seen = 0, changed = 0
    try {
      for await (const sub of stripe().subscriptions.list({
        status: 'all',
        limit: 100,
        expand: ['data.metadata'],
      })) {
        if (sub.metadata?.type !== 'artist_subscription') continue
        seen++
        try {
          const before = (await admin.firestore().doc(`users/${sub.metadata.uid}`).get()).data()?.artistSubActive
          const result = await syncArtistSubscription(sub)
          if (result && result.active !== before) changed++
        } catch (err) {
          console.error(`[memberships] ${sub.id} failed:`, err.message)
        }
      }
    } catch (err) {
      console.error('[memberships] Stripe list failed:', err.message)
      return null
    }
    console.log(`[memberships] ${seen} subscription(s) checked, ${changed} changed.`)
    return null
  })

// ── Scheduled: pull paid Stripe sessions (the webhook can't be reached) ───────
// Stripe cannot POST to stripeWebhook — this project can't grant public invoker,
// so the endpoint 403s. This polls instead: every 5 minutes it asks Stripe for
// recently-paid sessions and runs each through the same handlePaidSession().
// The idempotency lock means overlap with a (future) working webhook is harmless.
//
// Lookback is deliberately wider than the interval so a failed run self-heals.
exports.reconcileStripePayments = functions
  .runWith({ timeoutSeconds: 300 })
  .pubsub.schedule('every 5 minutes')
  .onRun(async () => {
    const LOOKBACK_HOURS = 6
    const since = Math.floor(Date.now() / 1000) - LOOKBACK_HOURS * 3600

    let scanned = 0, settled = 0
    try {
      for await (const session of stripe().checkout.sessions.list({
        created: { gte: since },
        limit: 100,
      })) {
        scanned++
        if (!['paid', 'no_payment_required'].includes(session.payment_status)) continue
        try {
          await handlePaidSession(session)
          settled++
        } catch (err) {
          console.error(`[reconcile] session ${session.id} failed:`, err.message)
        }
      }
    } catch (err) {
      console.error('[reconcile] Stripe list failed:', err.message)
      return null
    }

    console.log(`[reconcile] scanned ${scanned} session(s), ${settled} paid handled.`)
    return null
  })

// ── Order paid → confirm buyer + notify shop ──────────────────────────────────
// Called once payment actually lands, never on order creation: the client writes
// the order doc BEFORE redirecting to Stripe, so an abandoned cart also creates a
// doc. Emailing on create told customers their unpaid cart was confirmed.
const PAID_STATUSES = ['paid', 'deposit_paid']

// ── Digital delivery ─────────────────────────────────────────────────────────
// A product with a `downloadPath` is a digital good. The file lives under
// releases/ in Storage, which no client can read; buyers get a signed URL in
// their confirmation email. Links are delivered by email rather than a download
// button because this project's callable functions are unreachable (403) — see
// the note on stripeWebhook.
const DOWNLOAD_LINK_DAYS = 30

async function downloadLinksFor(items = []) {
  const db = admin.firestore()
  const links = []
  for (const item of items) {
    if (!item.id) continue
    const snap = await db.doc(`products/${item.id}`).get()
    if (!snap.exists) continue
    const { downloadPath, name } = snap.data()
    if (!downloadPath) continue
    try {
      const [url] = await admin.storage().bucket().file(downloadPath).getSignedUrl({
        action:  'read',
        expires: Date.now() + DOWNLOAD_LINK_DAYS * 24 * 60 * 60 * 1000,
      })
      links.push({ name: item.name || name || 'Download', url })
    } catch (err) {
      // Signing needs iam.serviceAccountTokenCreator on the runtime account.
      // Never fail the order over it — flag it so the file can be sent by hand.
      console.error(`Signed URL failed for ${downloadPath}:`, err.message)
      links.push({ name: item.name || name || 'Download', url: null })
    }
  }
  return links
}

async function notifyOrderPaid(orderId, order) {
  const ref = `#${orderId.slice(-6).toUpperCase()}`
  const isDeposit = order.paymentStatus === 'deposit_paid'

  const downloads = await downloadLinksFor(order.items).catch(err => {
    console.error('downloadLinksFor failed:', err.message)
    return []
  })
  const usable = downloads.filter(d => d.url)
  const failed = downloads.filter(d => !d.url)

  await sendEmail(order.email,
    `Order Confirmed — Art Saturated ${ref}`,
    fmtEmail(order.name, [
      isDeposit ? 'Your deposit is confirmed!' : 'Your order is confirmed!',
      '',
      itemList(order.items),
      '',
      `Total: $${order.total}`,
      // A fully digital order has nothing to ship — don't promise delivery.
      ...(usable.length && usable.length === (order.items || []).length
        ? []
        : order.shippingMethod === 'pickup'
          ? ["We'll let you know as soon as it's ready for pickup."]
          : [`Estimated delivery: ${shippingWindow()}`, '', "We'll notify you when your order ships."]),
      ...(usable.length
        ? ['', 'Your download links (good for 30 days):',
           ...usable.map(d => `  ${d.name}\n  ${d.url}`),
           '', 'Save the files somewhere safe — the links expire.']
        : []),
      ...(failed.length
        ? ['', "One or more downloads couldn't be prepared automatically — we'll email them to you shortly."]
        : []),
    ]),
  ).catch(e => console.error('Buyer confirmation email failed:', e.message))

  if (failed.length) {
    await sendEmail(OWNER_EMAIL,
      `⚠ Download link failed — order ${ref}`,
      [
        'A paid order contains a digital item whose download link could not be generated.',
        'The buyer has been told links are coming — send the files manually.',
        '',
        `Buyer: ${order.email}`,
        ...failed.map(d => `  • ${d.name}`),
        '',
        'Likely cause: the functions service account lacks iam.serviceAccountTokenCreator,',
        'which Storage needs to sign URLs.',
      ].join('\n'),
    ).catch(e => console.error('Download failure alert failed:', e.message))
  }

  await sendEmail(OWNER_EMAIL,
    `New Order ${ref} — ${order.shippingMethod === 'pickup' ? 'Pickup' : 'Ship Required'}`,
    [
      isDeposit ? 'New deposit paid!' : 'New paid order!',
      '',
      `Customer: ${order.name || order.email}`,
      `Email: ${order.email}`,
      `Phone: ${order.phone || 'Not provided'}`,
      `Fulfilment: ${order.shippingMethod || 'ship'}`,
      '',
      itemList(order.items),
      '',
      `Total: $${order.total}`,
      '',
      `Manage: ${CLIENT_URL}/admin`,
    ].join('\n'),
  ).catch(e => console.error('Admin order email failed:', e.message))
}

// ── Firestore: New order → only notify if it was already paid at creation ─────
exports.onOrderCreated = functions.firestore
  .document('orders/{orderId}')
  .onCreate(async (snap, ctx) => {
    const order   = snap.data()
    const orderId = ctx.params.orderId

    // Normal web checkout lands here unpaid — the webhook flips paymentStatus to
    // 'paid' and onOrderStatusChanged sends the emails then. Only admin-created
    // or already-settled orders notify at creation time.
    if (!PAID_STATUSES.includes(order.paymentStatus)) {
      console.log(`Order ${orderId} created unpaid (${order.paymentStatus || 'none'}) — deferring emails until payment.`)
      return null
    }

    await notifyOrderPaid(orderId, order)
    return null
  })

// ── Firestore: Order status changed → notify buyer ────────────────────────────
exports.onOrderStatusChanged = functions.firestore
  .document('orders/{orderId}')
  .onUpdate(async (change, ctx) => {
    const before = change.before.data(), after = change.after.data()
    const orderId = ctx.params.orderId

    // Payment just landed (Stripe webhook flipped paymentStatus) → send the
    // confirmation pair that onOrderCreated deliberately held back.
    if (!PAID_STATUSES.includes(before.paymentStatus) && PAID_STATUSES.includes(after.paymentStatus)) {
      await notifyOrderPaid(orderId, after)
    }

    if (before.status === after.status) return null

    if (after.status === 'ready') {
      await sendEmail(after.email,
        `Your Order Is Ready — #${orderId.slice(-6).toUpperCase()}`,
        fmtEmail(after.name, [
          'Your order is ready for pickup!',
          '',
          itemList(after.items),
        ]),
      ).catch(console.error)
    }

    if (after.status === 'shipped') {
      await sendEmail(after.email,
        `Your Order Has Shipped — #${orderId.slice(-6).toUpperCase()}`,
        fmtEmail(after.name, [
          'Your order is on its way!',
          '',
          after.trackingNumber ? `Tracking: ${after.trackingNumber}` : 'Tracking coming soon.',
          `Est. arrival: ${shippingWindow()}`,
          '',
          itemList(after.items),
        ]),
      ).catch(console.error)
    }

    if (after.status === 'completed' && after.sellerId) {
      const [sellerSnap, configSnap] = await Promise.all([
        admin.firestore().doc(`users/${after.sellerId}`).get(),
        admin.firestore().doc('settings/storeConfig').get(),
      ])
      const seller         = sellerSnap.data()
      if (!seller?.email) return null
      const cfg = configSnap.exists ? configSnap.data() : {}
      // Local drop-off items earn 5% commission (Art Saturated handles the physical item)
      const isLocal        = after.isLocalDropoff ||
        (after.items || []).some(i => i.localDropoff)
      const commissionRate = isLocal
        ? (cfg.localCommissionRate ?? 0.05)
        : (cfg.commissionRate ?? after.commission ?? 0.10)
      const commissionPct  = Math.round(commissionRate * 100)
      const commissionAmt  = (after.total * commissionRate).toFixed(2)
      const payout         = (after.total * (1 - commissionRate)).toFixed(2)
      await sendEmail(seller.email,
        `Sale Complete — $${payout} Payout Scheduled`,
        fmtEmail(seller.name, [
          'Your sale is complete!',
          '',
          `Order total: $${after.total}`,
          `Commission (${commissionPct}%): -$${commissionAmt}`,
          `Your payout: $${payout}`,
          '',
          'Payouts release 7 days after order completion.',
        ]),
      ).catch(console.error)
    }

    return null
  })

// ── Firestore: New event published → notify opted-in users ───────────────────
exports.onEventPublished = functions
  .runWith({ timeoutSeconds: 120 })
  .firestore
  .document('events/{eventId}')
  .onCreate(async (snap) => {
    initSG()
    const ev = snap.data()
    if (!ev.approved) return null          // safety check — only notify for live events

    const db    = admin.firestore()
    const users = await db.collection('users').where('notifyEvents', '==', true).get()
    if (users.empty) return null

    const dateStr = ev.date
      ? new Date(ev.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      : ''
    const timeStr = ev.startTime ? ` · ${ev.startTime}${ev.endTime ? ' – ' + ev.endTime : ''}` : ''
    const subject = `New Event: ${ev.title} — Art Saturated`
    const body    = [
      `A new event has been added to the Art Saturated calendar!`,
      ``,
      `${ev.title}`,
      dateStr ? `${dateStr}${timeStr}` : '',
      ev.eventType ? `Type: ${ev.eventType}` : '',
      ev.location  ? `Where: ${ev.location}` : '',
      ev.entryFee  ? `Entry: ${ev.entryFee}` : '',
      ev.description ? `\n${ev.description}` : '',
      ``,
      `View the full calendar: ${CLIENT_URL}/events`,
      ``,
      `— Art Saturated`,
      ``,
      `To stop receiving event notifications, visit your account settings at ${CLIENT_URL}/account`,
    ].filter(l => l !== null && l !== undefined).join('\n')

    const sends = users.docs.map(doc => {
      const u = doc.data()
      if (!u.email) return Promise.resolve()
      return sendEmail(u.email, subject, body)
        .catch(e => console.error(`Failed to notify ${u.email}:`, e))
    })

    await Promise.all(sends)
    return null
  })

// ── Firestore: Submission approved/rejected → notify artist ───────────────────
exports.onSubmissionStatusChanged = functions.firestore
  .document('submissions/{submissionId}')
  .onUpdate(async (change) => {
    initSG()
    const before = change.before.data(), after = change.after.data()
    if (before.status === after.status) return null

    if (after.status === 'approved') {
      await sendEmail(after.artistEmail,
        `Approved — "${after.title}" is live on Art Saturated`,
        fmtEmail(after.artistName, [
          `"${after.title}" is approved and live in the shop!`,
          '',
          'Reminder:',
          '  • Ship within 3 business days',
          '  • Art Saturated takes 10% commission',
          '  • Payouts release 7 days after completion',
        ]),
      ).catch(console.error)
    }

    if (after.status === 'rejected') {
      const feedbackLines = after.rejectionFeedback
        ? ['Feedback from our team:', '', `  ${after.rejectionFeedback}`, '', 'Feel free to revise and resubmit at any time.']
        : ["We weren't able to approve this listing right now.", '', 'Want to know why? You can request feedback from your submissions page.']
      await sendEmail(after.artistEmail,
        `Submission Update — ${after.submissionNumber ? `[${after.submissionNumber}] ` : ''}Art Saturated`,
        fmtEmail(after.artistName, [
          `Thank you for submitting "${after.title}".`,
          '',
          ...feedbackLines,
        ]),
      ).catch(console.error)
    }

    // Artist requested feedback on a rejection — notify admin
    if (after.feedbackRequested && !before.feedbackRequested) {
      const subRef = `${after.submissionNumber || after.title} by ${after.artistName}`
      await sendEmail(OWNER_EMAIL,
        `Feedback Requested — ${subRef}`,
        [
          `An artist is requesting feedback on a rejected submission.`,
          ``,
          `Submission: ${subRef}`,
          `Artist email: ${after.artistEmail}`,
          ``,
          `Review and respond at: ${CLIENT_URL}/admin?tab=submissions`,
        ].join('\n'),
      ).catch(console.error)
    }

    // Admin sent feedback — notify artist
    if (after.feedbackAnswered && !before.feedbackAnswered && after.adminFeedback) {
      await sendEmail(after.artistEmail,
        `Feedback on Your Submission — Art Saturated`,
        fmtEmail(after.artistName, [
          `Here's feedback from our team on your submission "${after.title}":`,
          '',
          `  ${after.adminFeedback}`,
          '',
          "You're welcome to revise and resubmit at any time.",
        ]),
      ).catch(console.error)
    }

    return null
  })

// ── Firestore: Event submission approved/denied → notify organizer ────────────
exports.onEventSubmissionChanged = functions.firestore
  .document('eventSubmissions/{subId}')
  .onUpdate(async (change) => {
    initSG()
    const before = change.before.data(), after = change.after.data()
    if (before.status === after.status) return null
    if (!after.submitterEmail) return null

    if (after.status === 'approved') {
      const dateStr = after.date
        ? new Date(after.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
        : ''
      const timeStr = after.startTime
        ? ` · ${after.startTime}${after.endTime ? ' – ' + after.endTime : ''}`
        : ''
      await sendEmail(
        after.submitterEmail,
        `Your Event Was Approved — "${after.title}"`,
        [
          `Hey ${after.submittedBy || 'there'},`,
          ``,
          `Great news — your event has been approved and is now live on the Art Saturated calendar!`,
          ``,
          `  ${after.title}`,
          dateStr ? `  ${dateStr}${timeStr}` : '',
          after.location ? `  Where: ${after.location}` : '',
          ``,
          `View it here: ${CLIENT_URL}/events`,
          ``,
          `— Art Saturated`,
        ].filter(l => l !== null && l !== undefined).join('\n'),
      ).catch(console.error)
    }

    if (after.status === 'denied') {
      await sendEmail(
        after.submitterEmail,
        `Event Submission Update — Art Saturated`,
        [
          `Hey ${after.submittedBy || 'there'},`,
          ``,
          `Thank you for submitting "${after.title}" to the Art Saturated calendar.`,
          ``,
          `We weren't able to approve this event at this time. Feel free to reach out if you have questions.`,
          ``,
          `— Art Saturated`,
        ].join('\n'),
      ).catch(console.error)
    }

    return null
  })

// ── Firestore: Commission request from collector → notify artist ──────────────
exports.onCommissionRequestCreated = functions.firestore
  .document('commissionRequests/{reqId}')
  .onCreate(async (snap) => {
    initSG()
    const req = snap.data()
    if (!req.artistEmail) return null

    await sendEmail(
      req.artistEmail,
      `New Commission Inquiry — Art Saturated`,
      fmtEmail(req.artistName, [
        `You have a new commission inquiry from ${req.collectorName || 'a collector'}!`,
        '',
        `Contact: ${req.collectorEmail}`,
        req.budget   ? `Budget:   ${req.budget}`   : '',
        req.timeline ? `Timeline: ${req.timeline}` : '',
        '',
        'Project description:',
        req.description || '(No description provided)',
        '',
        'Reach out to the collector directly to discuss terms and pricing.',
        'Art Saturated does not take a fee on custom commissions — this transaction is entirely between you and the collector.',
        '',
        `Manage your inquiries at: ${CLIENT_URL}/account`,
      ].filter(l => l !== null)),
    ).catch(console.error)

    return null
  })

// ── Firestore: New commission thread message → notify the other party ─────────
exports.onCommissionMessage = functions.firestore
  .document('commissionRequests/{reqId}/messages/{msgId}')
  .onCreate(async (snap, ctx) => {
    initSG()
    const msg = snap.data()
    const reqSnap = await admin.firestore().doc(`commissionRequests/${ctx.params.reqId}`).get()
    if (!reqSnap.exists) return null
    const req = reqSnap.data()

    // Auto-mark as responded when artist sends first message
    if (msg.role === 'artist' && req.status === 'new') {
      await reqSnap.ref.update({ status: 'responded' }).catch(() => {})
    }

    // Notify the OTHER party
    if (msg.role === 'collector' && req.artistEmail) {
      // Collector messaged → email the artist
      await sendEmail(
        req.artistEmail,
        `New message from ${msg.senderName || 'a collector'} — Art Saturated`,
        fmtEmail(req.artistName, [
          `${msg.senderName || 'A collector'} sent you a message about their commission inquiry:`,
          '',
          `  "${msg.text}"`,
          '',
          `Open the thread: ${CLIENT_URL}/account?acctab=commissions`,
        ]),
      ).catch(console.error)
    } else if (msg.role === 'artist' && req.collectorEmail) {
      // Artist messaged → email the collector
      await sendEmail(
        req.collectorEmail,
        `${req.artistName || 'An artist'} replied to your commission inquiry`,
        fmtEmail(req.collectorName, [
          `${req.artistName || 'An artist'} sent you a message about your commission inquiry:`,
          '',
          `  "${msg.text}"`,
          '',
          `Open the thread: ${CLIENT_URL}/account?acctab=requests`,
        ]),
      ).catch(console.error)
    }

    return null
  })

// ── Shippo: Shared helpers ────────────────────────────────────────────────────
// Art Saturated ship-from address. Override via storeConfig.shipFromAddress.
const DEFAULT_SHIP_FROM = {
  name:    'Art Saturated',
  street1: '3945 Parnell Ave',
  city:    'Fort Wayne',
  state:   'IN',
  zip:     '46809',
  country: 'US',
  email:   OWNER_EMAIL,
}

async function shippoFetch(path, method, body) {
  const key = process.env.SHIPPO_API_KEY
  if (!key) throw new Error('SHIPPO_API_KEY is not configured in Firebase Functions environment.')
  const res = await fetch(`https://api.goshippo.com${path}`, {
    method,
    headers: {
      Authorization:  `ShippoToken ${key}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Shippo ${res.status}: ${text}`)
  }
  return res.json()
}

// ── Shippo: Get shipping rates for an order ───────────────────────────────────
exports.getShippingRates = functions
  .runWith({ timeoutSeconds: 120 })
  .https.onCall(async (data, context) => {
  // Admin-only: reads order PII and hits the paid Shippo API.
  if (context.auth?.token?.email !== OWNER_EMAIL) {
    throw new functions.https.HttpsError('permission-denied', 'Admins only.')
  }

  const { orderId } = data
  if (!orderId) throw new functions.https.HttpsError('invalid-argument', 'orderId required.')

  const orderSnap = await admin.firestore().doc(`orders/${orderId}`).get()
  if (!orderSnap.exists) throw new functions.https.HttpsError('not-found', 'Order not found.')

  const order = orderSnap.data()
  if (!order.shippingAddress) {
    throw new functions.https.HttpsError('failed-precondition', 'No shipping address on this order.')
  }

  // Total weight in lbs (min 0.1 lb)
  const weightOz = (order.items || []).reduce((s, i) => s + (Number(i.weightOz) || 2) * (Number(i.qty) || 1), 0)
  const weightLb = Math.max(weightOz / 16, 0.1).toFixed(3)

  // Allow from-address override via storeConfig
  const configSnap = await admin.firestore().doc('settings/storeConfig').get()
  const fromAddr   = (configSnap.exists && configSnap.data().shipFromAddress) || DEFAULT_SHIP_FROM

  try {
    const shipment = await shippoFetch('/shipments/', 'POST', {
      address_from: fromAddr,
      address_to: {
        name:    order.shippingAddress.name,
        street1: order.shippingAddress.street1,
        street2: order.shippingAddress.street2 || '',
        city:    order.shippingAddress.city,
        state:   order.shippingAddress.state,
        zip:     order.shippingAddress.zip,
        country: order.shippingAddress.country || 'US',
        phone:   order.shippingAddress.phone   || '',
        email:   order.email || '',
      },
      parcels: [{
        length:        '12',
        width:         '9',
        height:        '6',
        distance_unit: 'in',
        weight:        weightLb,
        mass_unit:     'lb',
      }],
      async: false,
    })

    const rates = (shipment.rates || []).map(r => ({
      objectId: r.object_id,
      carrier:  r.provider,
      service:  r.servicelevel?.name || '',
      days:     r.estimated_days     || null,
      amount:   r.amount,
      currency: r.currency,
    }))

    // Sort by price ascending
    rates.sort((a, b) => parseFloat(a.amount) - parseFloat(b.amount))
    return rates
  } catch (err) {
    console.error('getShippingRates error:', err.message)
    throw new functions.https.HttpsError('internal', err.message)
  }
})

// ── Shippo: Purchase a label for an order ────────────────────────────────────
exports.purchaseShippingLabel = functions
  .runWith({ timeoutSeconds: 120 })
  .https.onCall(async (data, context) => {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Login required.')

  // Admin-only: this BUYS a real shipping label (spends money) and mutates any order.
  if (context.auth?.token?.email !== OWNER_EMAIL) {
    throw new functions.https.HttpsError('permission-denied', 'Admins only.')
  }

  const { orderId, rateObjectId } = data
  if (!orderId || !rateObjectId) {
    throw new functions.https.HttpsError('invalid-argument', 'orderId and rateObjectId required.')
  }

  const orderSnap = await admin.firestore().doc(`orders/${orderId}`).get()
  if (!orderSnap.exists) throw new functions.https.HttpsError('not-found', 'Order not found.')

  try {
    const transaction = await shippoFetch('/transactions/', 'POST', {
      rate:            rateObjectId,
      label_file_type: 'PDF',
      async:           false,
    })

    if (transaction.status !== 'SUCCESS') {
      const msg = (transaction.messages || []).map(m => m.text).join('; ') || 'Label purchase failed.'
      throw new Error(msg)
    }

    await admin.firestore().doc(`orders/${orderId}`).update({
      status:         'shipped',
      trackingNumber: transaction.tracking_number || '',
      labelUrl:       transaction.label_url        || '',
      carrier:        transaction.provider          || '',
      shippedAt:      FieldValue.serverTimestamp(),
    })

    return {
      trackingNumber: transaction.tracking_number,
      labelUrl:       transaction.label_url,
    }
  } catch (err) {
    console.error('purchaseShippingLabel error:', err.message)
    throw new functions.https.HttpsError('internal', err.message)
  }
})

// ── Gemini via @google/genai (Vertex, global endpoint) ───────────────────────
// One shared call site. The new SDK properly supports the `global` endpoint and
// current Gemini models — the old @google-cloud/vertexai SDK did not (it built
// a bad `global-aiplatform…` URL and returned HTML). Default model: gemini-2.0-flash.
function genAI() {
  const { GoogleGenAI } = require('@google/genai')
  return new GoogleGenAI({
    vertexai: true,
    project:  process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'art-saturated',
    location: 'global',
  })
}
async function geminiText({ contents, config, model = 'gemini-2.0-flash' }) {
  const result = await genAI().models.generateContent({ model, contents, config })
  return (result.text || '').trim()
}

// ── AI listing assistant ─────────────────────────────────────────────────────
async function suggestListingFields({ text, imageUrl }) {
  if (!text && !imageUrl) { const e = new Error('Provide text or imageUrl.'); e.code = 'invalid'; throw e }

  const parts = []
  if (text)     parts.push({ text: `Seller notes: ${text}` })
  if (imageUrl) {
    // SSRF guard: only fetch from our own Storage bucket over https. Prevents a crafted
    // imageUrl from making the function hit internal/metadata endpoints (e.g. 169.254.169.254).
    let allowed = false
    try {
      const u = new URL(imageUrl)
      allowed = u.protocol === 'https:' && (
        u.hostname === 'firebasestorage.googleapis.com' ||
        u.hostname === 'storage.googleapis.com'
      )
    } catch { allowed = false }

    if (!allowed) {
      console.warn('suggestListingFields: rejected non-allowlisted imageUrl host')
    } else {
      try {
        const imgRes  = await fetch(imageUrl)
        const buf     = await imgRes.arrayBuffer()
        if (buf.byteLength > 8 * 1024 * 1024) throw new Error('image too large')
        const base64  = Buffer.from(buf).toString('base64')
        const mime    = imgRes.headers.get('content-type') || 'image/jpeg'
        parts.push({ inlineData: { data: base64, mimeType: mime } })
      } catch (e) {
        console.warn('suggestListingFields: could not fetch image:', e.message)
      }
    }
  }

  const raw = await geminiText({
    contents: [{ role: 'user', parts }],
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 512,
      temperature: 0.2,
      systemInstruction: `You are a listing assistant for Art Saturated, an art and collectibles marketplace in Fort Wayne, Indiana.

Given the seller's rough notes and/or a product photo, return listing details as JSON.

Valid categories: Art, Physical Media, Vintage Tech, Get On The Flora, Plants
Valid conditions: New, Like New, Very Good, Good, Fair, Poor
Valid art mediums: Pen, Crayon, Mixed, Ink, Paint, Digital, Photography
Valid genres (Physical Media): Hip-Hop, Jazz, Soul, R&B, Funk, Blues, Rock, Pop, Electronic, Other

Return ONLY valid JSON — no markdown, no explanation. Include only fields you can confidently fill:
{
  "name": "concise title, max 60 chars",
  "description": "2-3 engaging sentences",
  "price": 35,
  "category": "Art",
  "condition": "Very Good",
  "medium": "Ink",
  "artist": "artist name if Physical Media",
  "albumTitle": "album name if Physical Media",
  "genre": "genre if Physical Media",
  "size": "dimensions if visible, e.g. 8x10",
  "weightOz": 6
}`,
    },
  })
  return JSON.parse(raw)
}

// ── AI: Batch photo triage — group a pile of photos into per-item listings ─────
// Zion dumps a whole stack of record/item photos (fronts, backs, detail shots)
// at once; this single multimodal pass groups the shots that belong to the same
// physical item, drafts listing fields per group, and FLAGS anything it isn't
// sure about (an orphan photo, a front/back that disagree, a blurry scan). One
// Gemini call reasons across the whole batch — cheaper than per-photo, and lets
// the model actually pair fronts with backs. The client then reviews and
// publishes group-by-group.
const BATCH_MAX_PHOTOS = 20
async function batchListingFromPhotos({ imageUrls }) {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    const e = new Error('Provide at least one photo.'); e.code = 'invalid'; throw e
  }
  const urls = imageUrls.slice(0, BATCH_MAX_PHOTOS)

  // Same SSRF allowlist as suggestListingFields — only our own Storage over https.
  const isAllowed = (u) => {
    try {
      const url = new URL(u)
      return url.protocol === 'https:' && (
        url.hostname === 'firebasestorage.googleapis.com' ||
        url.hostname === 'storage.googleapis.com'
      )
    } catch { return false }
  }

  const parts = []
  let included = 0
  for (let i = 0; i < urls.length; i++) {
    if (!isAllowed(urls[i])) { console.warn('batchListingFromPhotos: skipped non-allowlisted url at index', i); continue }
    try {
      const res = await fetch(urls[i])
      const buf = await res.arrayBuffer()
      if (buf.byteLength > 8 * 1024 * 1024) { console.warn('batch: image too large at index', i); continue }
      // Label each image with its index so the model can refer back to it by number.
      parts.push({ text: `Photo index ${i}:` })
      parts.push({ inlineData: { data: Buffer.from(buf).toString('base64'), mimeType: res.headers.get('content-type') || 'image/jpeg' } })
      included++
    } catch (e) { console.warn('batch: could not fetch image', i, e.message) }
  }
  if (included === 0) { const e = new Error('None of the photos could be read.'); e.code = 'invalid'; throw e }

  const raw = await geminiText({
    contents: [{ role: 'user', parts }],
    config: {
      responseMimeType: 'application/json',
      maxOutputTokens: 2048,
      temperature: 0.2,
      systemInstruction: `You are a cataloging assistant for Art Saturated, an art and collectibles marketplace in Fort Wayne, Indiana.

You are given a batch of product photos, each prefixed with its "Photo index N". The batch usually contains MULTIPLE distinct items, often with several photos of each item (e.g. the front cover, back cover, and detail shots of the same record).

Your job:
1. GROUP the photos by the physical item they show. Front + back + detail shots of the SAME item go in ONE group.
2. For each group, draft listing fields from what is visible.
3. FLAG uncertainty: a photo you cannot confidently place, a group whose photos seem to disagree (e.g. a front and back that look like different albums), or anything too blurry to read.

Valid categories: Art, Physical Media, Vintage Tech, Get On The Flora, Plants
Valid conditions: New, Like New, Very Good, Good, Fair, Poor
Valid genres (Physical Media only): Hip-Hop, Jazz, Soul, R&B, Funk, Blues, Rock, Pop, Electronic, Other

Return ONLY valid JSON, no markdown:
{
  "groups": [
    {
      "imageIndexes": [0, 1],
      "category": "Physical Media",
      "name": "Artist - Album",
      "artist": "...",
      "albumTitle": "...",
      "genre": "...",
      "year": 1982,
      "condition": "Very Good",
      "associatedArtists": ["producer / featured / label names you can read"],
      "confidence": "high",
      "flag": "short reason this group is uncertain (omit when confident)"
    }
  ],
  "ungrouped": [3],
  "notes": "one short sentence about the batch overall (omit if nothing to say)"
}

Rules:
- "confidence" must be exactly "high" or "low".
- Include only fields you can confidently fill; omit the rest.
- Every photo index you were given must appear in exactly one group's imageIndexes OR in "ungrouped" — never both, never neither.`,
    },
  })
  const parsed = JSON.parse(raw)
  // Normalize to a shape the client can rely on without defensive checks.
  return {
    groups:    Array.isArray(parsed.groups)    ? parsed.groups    : [],
    ungrouped: Array.isArray(parsed.ungrouped) ? parsed.ungrouped : [],
    notes:     typeof parsed.notes === 'string' ? parsed.notes : '',
    photoCount: included,
  }
}

// ── AI: Generate interview draft from artist responses ────────────────────────
// Called from AdminPage "Interviews" tab after the artist submits their answers.
// Uses Vertex AI (Gemini) to produce a first-person blog-post draft.
// The draft is written to blogSubmissions so it flows through the existing
// review pipeline — Zion edits and approves before anything goes live.
// Core logic — shared by the dispatcher. Drafts an interview-based feature.
async function generateInterviewDraftDoc(interviewId, db) {
  const snap = await db.collection('interviews').doc(interviewId).get()
  if (!snap.exists) { const e = new Error('Interview not found.'); throw e }

  const interview = snap.data()
  if (!interview.responses || Object.keys(interview.responses).length === 0) {
    throw new Error('No responses to draft from.')
  }

  const questions = interview.questions || []
  const responses = interview.responses || {}
  const qaPairs = questions
    .map((q, i) => responses[i]?.trim() ? `Q: ${q}\nA: ${responses[i].trim()}` : null)
    .filter(Boolean)
    .join('\n\n')
  const artistName = interview.artistName || 'the artist'

  const prompt = `You are an editorial assistant for Art Saturated, an independent art platform. Write a warm, personal artist feature based on the Q&A below. Rules:
- Write in THIRD PERSON (e.g. "Zion says..." not "I say...")
- 350–600 words
- Open with a compelling sentence about the artist or their work, not a generic introduction
- Weave the Q&A answers naturally into flowing prose — do NOT use question headers
- Preserve the artist's exact phrasing and voice where possible; do not paraphrase into corporate language
- End with a short paragraph directing readers to their work on the site
- Do NOT invent facts, quotes, or details not present in the answers
- Plain text only — no markdown, no asterisks, no bullet points

Artist: ${artistName}

Q&A:
${qaPairs}`

  const draftText = await geminiText({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { temperature: 0.7, maxOutputTokens: 1024 },
  })

  // Write draft to blogSubmissions. body+excerpt so it renders in the magazine.
  const blogRef = db.collection('blogSubmissions').doc()
  await blogRef.set({
    title:       `Artist Feature: ${artistName}`,
    slug:        `${seoSlugify('artist-feature-' + artistName)}-${Math.random().toString(36).slice(2, 6)}`,
    authorName:  artistName,
    body:        draftText,
    excerpt:     draftText.slice(0, 160),
    category:    'artist-feature',
    status:      'pending_review',
    source:      'interview',
    interviewId,
    feePaid:     true,
    submittedAt: FieldValue.serverTimestamp(),
    uid:         null,
  })

  await snap.ref.update({
    status:    'drafted',
    draftedAt: FieldValue.serverTimestamp(),
    blogDocId: blogRef.id,
  })

  return { success: true, blogDocId: blogRef.id, preview: draftText.slice(0, 200) }
}

// ── AI: SEO article generation ────────────────────────────────────────────────
// Shared generator used by both the admin on-demand button and the weekly cron.
// Enforces a monthly article quota stored in settings/seoConfig, generates an
// SEO-oriented article with Gemini, and drops it into blogSubmissions as a
// pending_review draft so it flows through the existing magazine review queue.

const SEO_MONTH = () => new Date().toISOString().slice(0, 7)  // 'YYYY-MM'

function seoSlugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60)
}

// Returns { ok, reason, used, quota } — does NOT generate, just checks/reserves.
async function checkSeoQuota(db) {
  const ref  = db.doc('settings/seoConfig')
  const snap = await ref.get()
  const cfg  = snap.exists ? snap.data() : {}
  const quota = Number(cfg.monthlyQuota) || 8
  const month = SEO_MONTH()
  const used  = (cfg.usage && cfg.usage.month === month) ? Number(cfg.usage.count) || 0 : 0
  if (used >= quota) return { ok: false, reason: `Monthly quota reached (${used}/${quota}).`, used, quota }
  return { ok: true, used, quota, ref }
}

async function incrementSeoUsage(db) {
  const ref   = db.doc('settings/seoConfig')
  const month = SEO_MONTH()
  await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    const cfg  = snap.exists ? snap.data() : {}
    const used = (cfg.usage && cfg.usage.month === month) ? Number(cfg.usage.count) || 0 : 0
    txn.set(ref, { usage: { month, count: used + 1 } }, { merge: true })
  })
}

// ── AI credit governance ──────────────────────────────────────────────────────
// Rough per-call cost estimates for Gemini 1.5 Flash (USD). Good enough to keep
// credit spend visible and capped; not billing-grade accounting.
const AI_COST = { quickfill: 0.0015, seo: 0.0009, spotlight: 0.0009, interview: 0.0007, qa: 0.0010, ideas: 0.0005 }

// Block new AI jobs if paused or the monthly budget ceiling is hit.
async function checkAiBudget(db) {
  const snap = await db.doc('settings/aiUsage').get()
  const u = snap.exists ? snap.data() : {}
  if (u.paused === true) return { ok: false, reason: 'AI is paused in admin (AI Usage tab).' }
  const month  = SEO_MONTH()
  const spent  = (u.month === month) ? Number(u.estCostUsd) || 0 : 0
  const budget = Number(u.monthlyBudgetUsd) || 0   // 0 = no ceiling
  if (budget > 0 && spent >= budget) {
    return { ok: false, reason: `Monthly AI budget reached ($${spent.toFixed(2)} / $${budget.toFixed(2)}).` }
  }
  return { ok: true }
}

async function recordAiUsage(db, type) {
  const ref   = db.doc('settings/aiUsage')
  const month = SEO_MONTH()
  const cost  = AI_COST[type] || 0.001
  await db.runTransaction(async (txn) => {
    const snap = await txn.get(ref)
    const u = snap.exists ? snap.data() : {}
    const fresh  = u.month === month
    const counts = fresh ? { ...(u.counts || {}) } : {}
    counts[type] = (Number(counts[type]) || 0) + 1
    const estCostUsd = (fresh ? Number(u.estCostUsd) || 0 : 0) + cost
    txn.set(ref, { month, counts, estCostUsd, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  })
}

// Core generator — topic in, blogSubmissions draft out.
async function generateSeoArticleDoc(topic, db, sourceLabel = 'seo-ai') {
  const quota = await checkSeoQuota(db)
  if (!quota.ok) {
    const e = new Error(quota.reason); e.code = 'quota'; throw e
  }

  const prompt = `You are an editorial writer for Art Saturated, an independent art, music, and culture platform based in Fort Wayne, Indiana. Write an original, genuinely useful magazine article on the topic below, optimized for search without being spammy.

Topic: ${topic}

Rules:
- 600–900 words of real, specific, substantive content. No filler, no fluff, no keyword stuffing.
- Ground it in the local Fort Wayne / independent-artist context where natural.
- Warm, knowledgeable, human editorial voice — not corporate, not robotic.
- Plain prose paragraphs only. No markdown, asterisks, headers, or bullet lists.
- Do NOT invent specific events, names, dates, prices, or quotes. Keep claims general and true.

Return ONLY valid JSON with this exact shape:
{
  "title": "compelling, specific, search-friendly title under 65 characters",
  "metaDescription": "120–155 character meta description that earns clicks",
  "excerpt": "1–2 sentence standfirst shown above the article",
  "body": "the full article as plain text with paragraphs separated by blank lines"
}`

  let parsed
  try {
    const raw = await geminiText({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: { responseMimeType: 'application/json', temperature: 0.7, maxOutputTokens: 2048 },
    })
    parsed = JSON.parse(raw)
  } catch (err) {
    console.error('generateSeoArticleDoc Vertex error:', err.message)
    const e = new Error('Article generation failed: ' + err.message); e.code = 'internal'; throw e
  }

  const title = (parsed.title || topic).trim()
  const slug  = `${seoSlugify(title)}-${Math.random().toString(36).slice(2, 6)}`

  const ref = db.collection('blogSubmissions').doc()
  await ref.set({
    title,
    slug,
    body:            (parsed.body || '').trim(),
    excerpt:         (parsed.excerpt || '').trim(),
    metaDescription: (parsed.metaDescription || parsed.excerpt || '').trim().slice(0, 160),
    authorName:      'Art Saturated',
    category:        'feature',
    status:          'pending_review',
    source:          sourceLabel,
    seoTopic:        topic,
    feePaid:         true,
    submittedAt:     FieldValue.serverTimestamp(),
    uid:             null,
  })

  await incrementSeoUsage(db)
  return { id: ref.id, title, slug, used: quota.used + 1, quota: quota.quota }
}

// Admin-triggered on-demand generation.
// (On-demand SEO generation is dispatched via onAiRequestCreated below.)

// Weekly scheduled generation — rotates through settings/seoConfig.topics.
exports.generateScheduledSeoArticle = functions
  .runWith({ timeoutSeconds: 120 })
  .pubsub
  .schedule('0 10 * * 1')          // Mondays 10 AM
  .timeZone('America/Chicago')
  .onRun(async () => {
    const db   = admin.firestore()
    const ref  = db.doc('settings/seoConfig')
    const snap = await ref.get()
    const cfg  = snap.exists ? snap.data() : {}
    const topics = Array.isArray(cfg.topics) ? cfg.topics.filter(t => (t || '').trim()) : []

    if (topics.length === 0) { console.log('[seo cron] no topics configured — skipping'); return null }

    const quota = await checkSeoQuota(db)
    if (!quota.ok) { console.log(`[seo cron] ${quota.reason} — skipping`); return null }

    const budget = await checkAiBudget(db)
    if (!budget.ok) { console.log(`[seo cron] ${budget.reason} — skipping`); return null }

    const cursor = Number(cfg.topicCursor) || 0
    const topic  = topics[cursor % topics.length]

    try {
      const res = await generateSeoArticleDoc(topic, db, 'seo-ai-scheduled')
      await recordAiUsage(db, 'seo')
      await ref.set({ topicCursor: (cursor + 1) % topics.length }, { merge: true })
      console.log(`[seo cron] generated draft "${res.title}" (${res.used}/${res.quota})`)
    } catch (err) {
      console.error('[seo cron] generation failed:', err.message)
    }
    return null
  })

// ── AI: Artist Spotlight generator ────────────────────────────────────────────
// Admin picks a public artist; we pull their profile + work and draft a warm
// feature for the magazine review queue. Each becomes a crawlable landing page
// the artist can share. Review-gated — nothing publishes without approval.
async function generateArtistSpotlightDoc(uid, db) {
  const profSnap = await db.doc(`users/${uid}`).get()
  if (!profSnap.exists) { throw new Error('Artist not found.') }
  const prof = profSnap.data()
  const name = prof.name || 'this artist'

  // Gather their work (approved submissions + admin products) for context + a cover image
  const [subSnap, prodSnap] = await Promise.all([
    db.collection('submissions').where('uid', '==', uid).where('status', '==', 'approved').get().catch(() => ({ docs: [] })),
    db.collection('products').where('artistUid', '==', uid).get().catch(() => ({ docs: [] })),
  ])

  const works = []
  let coverURL = null
  subSnap.docs.forEach(d => {
    const s = d.data()
    works.push(`${s.title || 'Untitled'} (${s.category || s.medium || 'mixed'})`)
    if (!coverURL && s.imageURL) coverURL = s.imageURL
  })
  prodSnap.docs.forEach(d => {
    const p = d.data()
    if (p.source === 'submission') return
    works.push(`${p.name || 'Untitled'} (${p.medium || 'mixed'})`)
    const img = Array.isArray(p.imageURLs) ? p.imageURLs[0] : (p.imageURL || p.image || null)
    if (!coverURL && img) coverURL = img
  })
  if (!coverURL && prof.photoURL) coverURL = prof.photoURL

  const prompt = `You are an editorial writer for Art Saturated, an independent art platform in Fort Wayne, Indiana. Write a warm, genuine artist spotlight feature.

Artist: ${name}
${prof.artistBio ? `Bio in their words: ${prof.artistBio}` : ''}
${prof.instagram ? `Instagram: ${prof.instagram}` : ''}
Known works on the platform: ${works.length ? works.slice(0, 12).join('; ') : 'a growing body of work'}

Rules:
- 400–650 words, third person.
- Open with something specific about the artist or their work — never a generic intro.
- Build from the bio and the titles/mediums of their actual work. Do NOT invent biographical facts, sales, quotes, awards, or dates.
- Warm, human, editorial voice. Plain prose only — no markdown, headers, or bullets.
- End by inviting readers to explore their work on Art Saturated.

Return ONLY valid JSON: { "title": "spotlight title under 65 chars", "metaDescription": "120–155 char meta description", "excerpt": "1–2 sentence standfirst", "body": "full article, paragraphs separated by blank lines" }`

  const raw = await geminiText({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: { responseMimeType: 'application/json', temperature: 0.7, maxOutputTokens: 2048 },
  })
  const parsed = JSON.parse(raw)

  const title = (parsed.title || `Artist Spotlight: ${name}`).trim()
  const slug  = `${seoSlugify(title)}-${Math.random().toString(36).slice(2, 6)}`

  const ref = db.collection('blogSubmissions').doc()
  await ref.set({
    title,
    slug,
    body:            (parsed.body || '').trim(),
    excerpt:         (parsed.excerpt || '').trim(),
    metaDescription: (parsed.metaDescription || parsed.excerpt || '').trim().slice(0, 160),
    coverURL:        coverURL || null,
    authorName:      'Art Saturated',
    category:        'artist-feature',
    status:          'pending_review',
    source:          'artist-spotlight',
    artistUid:       uid,
    feePaid:         true,
    submittedAt:     FieldValue.serverTimestamp(),
    uid:             null,
  })

  return { id: ref.id, title, slug }
}

// ── Discogs lookup — identify a release by barcode / catalog # / text ──────────
// Returns authoritative metadata to auto-fill a Physical Media listing.
async function discogsLookup({ query, barcode, catno } = {}) {
  const token = process.env.DISCOGS_TOKEN
  if (!token) throw new Error('Discogs token not configured.')
  const headers = { 'User-Agent': 'ArtSaturated/1.0 +https://artsaturated.com' }
  const params  = new URLSearchParams({ token, type: 'release', per_page: '5' })
  if      (barcode) params.set('barcode', String(barcode).trim())
  else if (catno)   params.set('catno',   String(catno).trim())
  else if (query)   params.set('q',       String(query).trim())
  else throw new Error('Provide a barcode, catalog number, or search text.')

  const searchRes = await fetch(`https://api.discogs.com/database/search?${params}`, { headers })
  if (!searchRes.ok) throw new Error(`Discogs search ${searchRes.status}`)
  const hit = ((await searchRes.json()).results || [])[0]
  if (!hit) return { found: false }

  // Pull full release detail for clean artist/title/genre/label fields.
  let rel = {}
  try {
    const relRes = await fetch(`https://api.discogs.com/releases/${hit.id}?token=${token}`, { headers })
    if (relRes.ok) rel = await relRes.json()
  } catch {}

  const titleParts = (hit.title || '').split(' - ')
  const artist     = (rel.artists && rel.artists[0] && rel.artists[0].name) || titleParts[0] || ''
  const albumTitle = (rel.title) || titleParts.slice(1).join(' - ') || ''
  const genre      = (rel.genres && rel.genres[0]) || (hit.genre && hit.genre[0]) || ''
  const label      = (rel.labels && rel.labels[0] && rel.labels[0].name) || (hit.label && hit.label[0]) || ''
  const catnoOut   = (rel.labels && rel.labels[0] && rel.labels[0].catno) || hit.catno || ''
  const format     = (hit.format && hit.format[0]) || (rel.formats && rel.formats[0] && rel.formats[0].name) || ''
  const cover      = (rel.images && rel.images[0] && rel.images[0].uri) || hit.cover_image || ''

  // Pricing — marketplace signals (best-effort; never blocks the lookup).
  let pricing = null
  try { pricing = await discogsPricing(hit.id, token, headers) }
  catch (e) { console.error('discogs pricing failed:', e && e.message) }

  return {
    found:      true,
    discogsId:  hit.id,
    artist,
    albumTitle,
    name:       artist && albumTitle ? `${artist} - ${albumTitle}` : (albumTitle || artist),
    genre,
    label,
    catno:      catnoOut,
    format,
    year:       rel.year || hit.year || null,
    styles:     rel.styles || [],
    cover,
    pricing,
  }
}

// ── Discogs pricing — marketplace floor + condition-based suggestions ──────────
// Returns null on any failure so a pricing hiccup never breaks the metadata lookup.
//   lowestPrice / numForSale — current marketplace floor (works with any token).
//   suggestions — map of Discogs condition grade → USD value. Richer, but the
//   price_suggestions endpoint needs a Seller-enabled token, so it may 403; we
//   swallow that and fall back to the marketplace floor.
async function discogsPricing(releaseId, token, headers) {
  const out = { lowestPrice: null, numForSale: null, currency: 'USD', suggestions: null }

  // Marketplace stats — current lowest asking price + listing count.
  try {
    const r = await fetch(`https://api.discogs.com/marketplace/stats/${releaseId}?curr_abbr=USD&token=${token}`, { headers })
    if (r.ok) {
      const s = await r.json()
      if (s && s.lowest_price && typeof s.lowest_price.value === 'number') {
        out.lowestPrice = Math.round(s.lowest_price.value * 100) / 100
        out.currency    = s.lowest_price.currency || 'USD'
      }
      if (typeof s.num_for_sale === 'number') out.numForSale = s.num_for_sale
    }
  } catch {}

  // Price suggestions by condition — needs a Seller-enabled token (may 403).
  try {
    const r = await fetch(`https://api.discogs.com/marketplace/price_suggestions/${releaseId}?token=${token}`, { headers })
    if (r.ok) {
      const ps = await r.json()
      if (ps && typeof ps === 'object') {
        const map = {}
        for (const [grade, info] of Object.entries(ps)) {
          if (info && typeof info.value === 'number') map[grade] = Math.round(info.value * 100) / 100
        }
        if (Object.keys(map).length) out.suggestions = map
      }
    }
  } catch {}

  return (out.lowestPrice == null && !out.suggestions) ? null : out
}

// ── AI dispatcher: client writes aiRequests/{id}; we generate and write back ───
// Firestore-triggered (no public invoker needed) — sidesteps the Domain
// Restricted Sharing org policy that blocks callable functions on this domain.
exports.onAiRequestCreated = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .firestore.document('aiRequests/{id}')
  .onCreate(async (snap) => {
    const req = snap.data() || {}
    const db  = admin.firestore()
    const payload = req.payload || {}
    try {
      const AI_TYPES = ['quickfill', 'seo', 'spotlight', 'interview', 'batch']
      // Discogs lookup isn't AI — it doesn't count against the AI budget.
      if (AI_TYPES.includes(req.type)) {
        const budget = await checkAiBudget(db)
        if (!budget.ok) throw new Error(budget.reason)
      }

      let result
      switch (req.type) {
        case 'quickfill':  result = await suggestListingFields(payload); break
        case 'batch':      result = await batchListingFromPhotos(payload); break
        case 'seo':        result = await generateSeoArticleDoc((payload.topic || '').trim(), db, 'seo-ai-manual'); break
        case 'spotlight':  result = await generateArtistSpotlightDoc(payload.uid, db); break
        case 'interview':  result = await generateInterviewDraftDoc(payload.interviewId, db); break
        case 'discogs':    result = await discogsLookup(payload); break
        default: throw new Error('Unknown request type: ' + req.type)
      }
      if (AI_TYPES.includes(req.type)) {
        await recordAiUsage(db, req.type).catch(e => console.error('recordAiUsage failed:', e && e.message))
      }
      await snap.ref.update({ status: 'done', result: result || {}, completedAt: FieldValue.serverTimestamp() })
    } catch (err) {
      console.error('onAiRequestCreated error:', req.type, err && (err.stack || err.message))
      // Never leave the request hanging — always write a terminal status.
      try {
        await snap.ref.update({ status: 'error', error: (err && err.message) ? String(err.message) : 'AI request failed.' })
      } catch (e2) {
        console.error('onAiRequestCreated: could not write error status:', e2 && e2.message)
      }
    }
  })

// ── Owner notifications + daily content ideas ─────────────────────────────────
// (OWNER_EMAIL is declared at the top of this file.)

// New account created → ping Zion.
exports.notifyNewUser = functions.firestore.document('users/{uid}').onCreate(async (snap, ctx) => {
  try {
    initSG()
    const u = snap.data() || {}
    let email = u.email
    if (!email) { try { email = (await admin.auth().getUser(ctx.params.uid)).email } catch {} }
    const type = Array.isArray(u.accountType) ? u.accountType.join(', ') : (u.accountType || 'collector')
    await sendEmail(OWNER_EMAIL, 'New account — Art Saturated', fmtEmail('Zion', [
      'A new account was just created:',
      '',
      `  Name:  ${u.name || '—'}`,
      `  Email: ${email || '—'}`,
      `  Type:  ${type}`,
      '',
      `See all users: ${CLIENT_URL}/admin?tab=users`,
    ]))
  } catch (e) { console.error('notifyNewUser:', e.message) }
  return null
})

// Feedback / suggestion submitted → ping Zion.
exports.notifyFeedback = functions.firestore.document('feedback/{id}').onCreate(async (snap) => {
  try {
    initSG()
    const f = snap.data() || {}
    await sendEmail(OWNER_EMAIL, `New ${f.type || 'feedback'} — Art Saturated`, fmtEmail('Zion', [
      `Someone submitted ${f.type || 'feedback'}:`,
      '',
      `  "${f.message || ''}"`,
      f.email ? `  — ${f.email}` : '',
      '',
      `Review: ${CLIENT_URL}/admin?tab=feedback`,
    ]))
  } catch (e) { console.error('notifyFeedback:', e.message) }
  return null
})

// AI-generated draft landed in the review queue → ping Zion.
exports.notifyAiDraft = functions.firestore.document('blogSubmissions/{id}').onCreate(async (snap) => {
  try {
    const d = snap.data() || {}
    const isAi = d.source && (d.source.startsWith('seo-ai') || d.source === 'artist-spotlight' || d.source === 'interview')
    if (!isAi) return null
    initSG()
    await sendEmail(OWNER_EMAIL, 'AI draft ready to review — Art Saturated', fmtEmail('Zion', [
      'A new AI draft just landed in your Magazine review queue:',
      '',
      `  "${d.title || 'Untitled'}"  (${d.source})`,
      '',
      `Review & approve: ${CLIENT_URL}/admin?tab=blog`,
    ]))
  } catch (e) { console.error('notifyAiDraft:', e.message) }
  return null
})

// Interview invite — sent server-side via SendGrid (modern, reliable).
// Replaces the old client-side EmailJS send. Fires on create, and again when
// a resend is requested (resendAt bumped). Ignores the artist's own response edits.
exports.onInterviewWrite = functions.firestore.document('interviews/{token}').onWrite(async (change, ctx) => {
  const after = change.after.exists ? change.after.data() : null
  if (!after || after.status !== 'invited' || !after.artistEmail) return null
  const before = change.before.exists ? change.before.data() : null
  const isNew  = !before
  const tsVal  = t => (t && t.seconds != null) ? t.seconds : (t || 0)
  const resendBumped = before && tsVal(after.resendAt) !== tsVal(before.resendAt) && after.resendAt
  if (!isNew && !resendBumped) return null
  try {
    initSG()
    const firstName = (after.artistName || 'friend').split(' ')[0]
    const link = `${CLIENT_URL}/interview/${ctx.params.token}`
    await sendEmail(after.artistEmail, "You've been invited for an Art Saturated feature", fmtEmail(firstName, [
      `We'd love to feature you on Art Saturated. There are a few questions below — answer as much or as little as you'd like. Your own words are the whole point.`,
      after.notes ? `\nA note from us:\n${after.notes}\n` : '',
      `Fill out your interview here:`,
      `  ${link}`,
      ``,
      `There's no deadline — take your time with it.`,
    ]))
  } catch (e) { console.error('onInterviewWrite email failed:', e.message) }
  return null
})

// Daily push: 8 site-aligned content ideas (how-tos, SEO, content-filling).
exports.dailyContentIdeas = functions
  .runWith({ timeoutSeconds: 120, memory: '512MB' })
  .pubsub.schedule('0 8 * * *').timeZone('America/Chicago')
  .onRun(async () => {
    const db = admin.firestore()
    const budget = await checkAiBudget(db)
    if (!budget.ok) { console.log(`[ideas] ${budget.reason} — skipping`); return null }

    const prompt = `You are the content strategist for Art Saturated, an independent art shop & marketplace in Fort Wayne, Indiana — original local art, commissions, vinyl & physical media, vintage tech, handmade goods, a community events calendar, an artist directory, and a magazine.

Generate exactly 8 fresh content ideas for the magazine, balanced across:
- HOW-TOs (e.g. starting an art collection, caring for vinyl, framing work)
- SEO / local plays (target real searches like "Fort Wayne art", "buy original art Fort Wayne", "where to sell art locally")
- CONTENT-FILLING (artist features, behind-the-scenes, buying guides, scene roundups)

Every idea must be specific and genuinely useful — no vague filler, no repeats. Return ONLY valid JSON:
{ "ideas": [ { "title": "...", "type": "how-to|seo|content", "angle": "one-sentence hook" } ] }`

    let ideas = []
    try {
      const raw = await geminiText({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: { responseMimeType: 'application/json', temperature: 0.9, maxOutputTokens: 1024 },
      })
      ideas = (JSON.parse(raw).ideas) || []
    } catch (err) {
      console.error('[ideas] generation failed:', err.message)
      return null
    }
    if (ideas.length === 0) return null

    await recordAiUsage(db, 'ideas')
    const today = new Date().toISOString().slice(0, 10)
    await db.doc(`contentIdeas/${today}`).set({ ideas, createdAt: FieldValue.serverTimestamp() }).catch(() => {})

    initSG()
    const lines = ['Your 8 content ideas for today:', '']
    ideas.slice(0, 8).forEach((it, i) => {
      lines.push(`${i + 1}. [${(it.type || '').toUpperCase()}] ${it.title}`)
      if (it.angle) lines.push(`   ${it.angle}`)
      lines.push('')
    })
    lines.push(`Turn any into a draft in the Magazine tab: ${CLIENT_URL}/admin?tab=blog`)
    await sendEmail(OWNER_EMAIL, '8 content ideas — Art Saturated', fmtEmail('Zion', lines))
      .catch(e => console.error('[ideas] email:', e.message))
    return null
  })

// ── Scheduled: 3 AM nightly maintenance digest ────────────────────────────────
// Summarises pending items and surfaces the monthly dep-review reminder.
// Dep audits can't run in Cloud Functions (no npm); use `npm run check-deps`
// locally. This function just reminds you to do it on the 1st of each month.
exports.nightlyMaintenance = functions
  .runWith({ timeoutSeconds: 180 })
  .pubsub.schedule('0 3 * * *').timeZone('America/Chicago')
  .onRun(async () => {
    initSG()
    const db = admin.firestore()

    // Gather housekeeping counts in parallel
    const [ordersSnap, submissionsSnap, eventSubsSnap, commissionsSnap, feedbackSnap] = await Promise.all([
      db.collection('orders').where('status', '==', 'pending').get(),
      db.collection('submissions').where('status', '==', 'pending_review').get(),
      db.collection('eventSubmissions').where('status', '==', 'pending').get(),
      db.collection('commissions').where('status', '==', 'pending').get(),
      db.collection('feedback').where('status', '==', 'new').get(),
    ])

    // 'pending' includes abandoned checkouts (the order doc is written before the
    // Stripe redirect), so only paid ones are actually actionable.
    const pendingOrders = ordersSnap.docs.map(d => d.data()).filter(o => !o.archived)
    const paidPending   = pendingOrders.filter(o => o.paymentStatus === 'paid' || o.paymentStatus === 'deposit_paid')
    const unpaidPending = pendingOrders.length - paidPending.length

    const items = [
      paidPending.length   > 0 ? `  • ${paidPending.length} paid order(s) to fulfil — ship within 3 business days` : '',
      unpaidPending        > 0 ? `  • ${unpaidPending} abandoned checkout(s) — no payment taken, archive when convenient` : '',
      submissionsSnap.size > 0 ? `  • ${submissionsSnap.size} art submission(s) awaiting review` : '',
      eventSubsSnap.size   > 0 ? `  • ${eventSubsSnap.size} event submission(s) awaiting approval` : '',
      commissionsSnap.size > 0 ? `  • ${commissionsSnap.size} commission request(s) awaiting reply` : '',
      feedbackSnap.size    > 0 ? `  • ${feedbackSnap.size} feedback item(s) unread` : '',
    ].filter(Boolean)

    // Monthly dep-review reminder on the 1st of each month
    const today = new Date()
    const depReminder = today.getDate() === 1
      ? `\n📦 Monthly: run \`npm run check-deps\` to audit outdated packages.\n   Hold major bumps (React 19, Tailwind v4, Vite v6+, Stripe v9, firebase-admin v13).\n   Safe to update: patch/minor within current majors.\n`
      : ''

    if (items.length === 0 && !depReminder) {
      console.log('[nightly] All clear — no items, no dep reminder.')
      return null
    }

    const body = [
      `Nightly maintenance digest — ${today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
      ``,
      items.length > 0 ? `Action required:\n${items.join('\n')}` : `All clear — nothing pending.`,
      depReminder,
      `Manage at: ${CLIENT_URL}/admin`,
    ].filter(l => l !== null && l !== undefined).join('\n')

    await sendEmail(OWNER_EMAIL, `Art Saturated — Nightly Digest`, body).catch(console.error)
    console.log(`[nightly] digest sent. Items: ${items.length}, depReminder: ${!!depReminder}`)
    return null
  })

// ── Storage: Watermark artist submissions on upload ───────────────────────────
exports.watermarkSubmission = functions
  .runWith({ timeoutSeconds: 120, memory: '1GB' })
  .storage.bucket('art-saturated.firebasestorage.app').object().onFinalize(async (object) => {
  const { name: filePath, bucket: bucketName, contentType, metadata } = object

  // Only process images uploaded to submissions/
  if (!filePath?.startsWith('submissions/')) return null
  if (!contentType?.startsWith('image/')) return null
  // Avoid infinite loop — skip if already watermarked
  if (metadata?.watermarked === 'true') return null

  try {
    const bucket = admin.storage().bucket(bucketName)
    const file   = bucket.file(filePath)
    const [buffer] = await file.download()

    const { width = 1000, height = 1000 } = await sharp(buffer).metadata()

    // Scale watermark text relative to image width
    const fontSize = Math.max(14, Math.round(width * 0.025))
    const padding  = Math.round(fontSize * 0.75)
    const svgW     = Math.round(fontSize * 14)
    const svgH     = Math.round(fontSize * 2.5)

    const svg = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${svgW}" height="${svgH}">` +
      `<text x="${svgW - padding}" y="${svgH - padding}" ` +
      `font-family="monospace" font-size="${fontSize}" ` +
      `fill="rgba(255,255,255,0.45)" text-anchor="end">© Art Saturated</text>` +
      `</svg>`
    )

    const isJpeg = contentType === 'image/jpeg' || contentType === 'image/jpg'

    const watermarked = await sharp(buffer)
      .composite([{ input: svg, gravity: 'southeast' }])
      .toFormat(isJpeg ? 'jpeg' : 'png', { quality: 92 })
      .toBuffer()

    await file.save(watermarked, {
      contentType: isJpeg ? 'image/jpeg' : 'image/png',
      metadata: { watermarked: 'true' },
      resumable: false,
    })

    console.log(`Watermarked: ${filePath}`)
  } catch (err) {
    console.error('watermarkSubmission error:', err)
  }

  return null
})

// ── Firestore: Commission request (public form) → notify Zion + confirm customer ─
// Fires when CommissionForm writes to commissions/{commId}.
exports.onCommissionCreated = functions.firestore
  .document('commissions/{commId}')
  .onCreate(async (snap) => {
    initSG()
    const c = snap.data()
    if (!c.contactEmail) return null

    const shortId = snap.id.slice(-6).toUpperCase()

    // Notify Zion
    await sendEmail(
      OWNER_EMAIL,
      `New Commission Request #${shortId} — ${c.contactName || 'Unknown'}`,
      [
        `New commission request!`,
        ``,
        `From:       ${c.contactName || '?'} (${c.contactEmail})`,
        `Medium:     ${c.medium || '—'}`,
        `Size:       ${c.size || '—'}`,
        `Style:      ${c.abstractionLabel || c.abstraction || '—'}`,
        ``,
        `Estimate:   $${c.totalCostMin || '?'}–$${c.totalCostMax || '?'} total`,
        c.estimatedHrsMin != null ? `Hours:      ${c.estimatedHrsMin}–${c.estimatedHrsMax} hrs` : '',
        c.notes ? `\nNotes:\n${c.notes}` : '',
        ``,
        `Manage at: ${CLIENT_URL}/admin`,
      ].filter(l => l !== null && l !== undefined).join('\n'),
    ).catch(console.error)

    // Confirmation to customer
    await sendEmail(
      c.contactEmail,
      `Commission Request Received — Art Saturated #${shortId}`,
      fmtEmail(c.contactName, [
        `Your commission request has been received! Here's a summary:`,
        ``,
        `Medium:     ${c.medium || '—'}`,
        `Size:       ${c.size || '—'}`,
        `Style:      ${c.abstractionLabel || c.abstraction || '—'}`,
        `Estimate:   $${c.totalCostMin || '?'}–$${c.totalCostMax || '?'} total`,
        c.notes ? `\nYour notes:\n${c.notes}` : '',
        ``,
        `You'll hear back to confirm your slot and receive a deposit invoice.`,
      ].filter(l => l !== null && l !== undefined), '— Zionomari / Art Saturated'),
    ).catch(console.error)

    return null
  })

// ── Firestore: Single session booked → confirm customer + notify Zion ─────────
exports.onBookingCreated = functions.firestore
  .document('bookings/{bookingId}')
  .onCreate(async (snap) => {
    initSG()
    const b = snap.data()
    if (!b.email) return null

    const fmtTime = t => {
      if (!t) return ''
      const [h, m] = t.split(':').map(Number)
      const ampm = h >= 12 ? 'PM' : 'AM'
      return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
    }
    const fmtDate = ds => {
      if (!ds) return ''
      const [y, mo, d] = ds.split('-').map(Number)
      return new Date(y, mo - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    }

    // Confirmation to customer
    await sendEmail(
      b.email,
      `Booking Confirmed — Art Saturated`,
      fmtEmail(b.name, [
        `Your session is confirmed!`,
        ``,
        `Service:  ${b.service || '—'}`,
        b.date ? `Date:     ${fmtDate(b.date)}` : '',
        b.time ? `Time:     ${fmtTime(b.time)}` : '',
        ``,
        `See you then!`,
      ].filter(l => l !== null && l !== undefined), '— Zion'),
    ).catch(console.error)

    // Notification to Zion
    await sendEmail(
      OWNER_EMAIL,
      `New Booking — ${b.service || 'Session'}`,
      [
        `New booking!`,
        ``,
        `Client:   ${b.name || '?'}`,
        `Email:    ${b.email}`,
        `Phone:    ${b.phone || 'N/A'}`,
        `Service:  ${b.service || '—'}`,
        b.date ? `Date:     ${fmtDate(b.date)}` : '',
        b.time ? `Time:     ${fmtTime(b.time)}` : '',
        b.message ? `\nNotes: ${b.message}` : '',
      ].filter(l => l !== null && l !== undefined).join('\n'),
    ).catch(console.error)

    return null
  })

// ── Workshop confirmation email ───────────────────────────────────────────────
exports.sendWorkshopConfirmation = functions.https.onCall(async (data, context) => {
  initSG()
  const { rsvpId, level } = data
  if (!rsvpId || !level) throw new functions.https.HttpsError('invalid-argument', 'rsvpId and level are required')

  const snap = await admin.firestore().collection('workshopRsvps').doc(rsvpId).get()
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'RSVP not found')

  const rsvp = snap.data()

  await sendEmail(
    rsvp.email,
    `Workshop Confirmed — Level ${level} — Exploring Deep States of Consciousness`,
    fmtEmail(rsvp.name, [
      `You've been accepted into the Exploring Deep States of Consciousness Workshop!`,
      ``,
      `Your Level:  ${level}`,
      `Format:      Live on Google Meet`,
      `Schedule:    4:30 PM ET — 3 consecutive weeks`,
      `Length:      1 hour — 15-min Q&A within or after the session`,
      ``,
      `── Dates ──`,
      `Level 1:  Tuesday, July 1 — 4:30 PM ET`,
      `Level 2:  Wednesday, July 8 — 4:30 PM ET`,
      `Level 3:  Wednesday, July 15 — 4:30 PM ET`,
      ``,
      `── Google Meet Links ──`,
      `Level 1 (Jul 1):   https://meet.google.com/aty-fpji-tja`,
      `Level 2 (Jul 8):   https://meet.google.com/zgy-fcnt-msz`,
      `Level 3 (Jul 15):  https://meet.google.com/vxt-tgrs-ddz`,
      ``,
      `── Donation (pay what feels right) ──`,
      `Cash App:  https://cash.app/$artsaturated`,
      `Venmo:     https://venmo.com/zionomari`,
      ``,
      `If you have any questions, reply to this email.`,
    ], '— Art Saturated'),
  )

  await sendEmail(
    OWNER_EMAIL,
    `Workshop Level Assigned — ${rsvp.name || rsvp.email}`,
    [
      `Workshop RSVP assigned to Level ${level}:`,
      `Name:       ${rsvp.name || '—'}`,
      `Email:      ${rsvp.email}`,
      `Experience: ${(rsvp.experience || '—').slice(0, 500)}`,
    ].join('\n'),
  )

  return { success: true }
})

// ── Firestore: Workshop RSVP submitted → notify Zion ────────────────────────
exports.onWorkshopRsvpCreated = functions.firestore
  .document('workshopRsvps/{rsvpId}')
  .onCreate(async (snap) => {
    initSG()
    const r = snap.data()
    if (!r.email) return null

    // Duplicate detection — only the FIRST RSVP for a given email sends emails.
    // A repeat submission is flagged (duplicate: true) and skipped so nobody
    // gets a second confirmation and Zion isn't pinged twice.
    const emailNorm = String(r.email).trim().toLowerCase()
    try {
      const dupSnap = await admin.firestore()
        .collection('workshopRsvps')
        .where('email', '==', r.email)
        .get()
      const sameEmail = dupSnap.docs.filter(
        d => String(d.data().email || '').trim().toLowerCase() === emailNorm
      )
      if (sameEmail.length > 1) {
        const earliest = sameEmail.reduce((a, b) => {
          const ta = a.data().submittedAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER
          const tb = b.data().submittedAt?.toMillis?.() ?? Number.MAX_SAFE_INTEGER
          return tb < ta ? b : a
        })
        if (earliest.id !== snap.id) {
          console.log('Duplicate workshop RSVP, skipping emails:', r.email)
          await snap.ref.update({ duplicate: true }).catch(() => {})
          return null
        }
      }
    } catch (e) { console.warn('RSVP dup check failed (continuing):', e.message) }

    // 1. Confirmation + Google Meet links straight to the person who RSVP'd
    await sendEmail(
      r.email,
      `You're in — Exploring Deep States of Consciousness`,
      fmtEmail(r.name, [
        `You're confirmed for the Exploring Deep States of Consciousness workshop.`,
        ``,
        `Format:    Live on Google Meet`,
        `Length:    1 hour — 15-min Q&A within or after each session`,
        ``,
        `── Sessions & Google Meet Links ──`,
        `Session 1 — Tuesday, July 1 · 4:30 PM ET`,
        `https://meet.google.com/aty-fpji-tja`,
        ``,
        `Session 2 — Wednesday, July 8 · 4:30 PM ET`,
        `https://meet.google.com/zgy-fcnt-msz`,
        ``,
        `Session 3 — Wednesday, July 15 · 4:30 PM ET`,
        `https://meet.google.com/vxt-tgrs-ddz`,
        ``,
        `Save this email — the same links work for every session.`,
        ``,
        `── Donation (pay what feels right) ──`,
        `Cash App:  https://cash.app/$artsaturated`,
        `Venmo:     https://venmo.com/zionomari`,
        ``,
        `Questions? Just reply to this email.`,
      ], '— Art Saturated'),
    ).catch(e => console.error('RSVP confirmation error:', e.response?.body?.errors?.[0]?.message || e.message))

    // 2. Notify Zion (skip for attendees Zion added manually in the admin panel)
    if (!r.addedByAdmin) {
      await sendEmail(
        OWNER_EMAIL,
        `New Workshop RSVP — ${r.name || r.email}`,
        [
          'New workshop RSVP received!',
          '',
          `Name:   ${r.name || '—'}`,
          `Email:  ${r.email}`,
        ].join('\n'),
      ).catch(e => console.error('RSVP notification error:', e.message))
    }

    return null
  })
