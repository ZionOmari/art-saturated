// Runs before every test file.
//
// Two jobs: point the Admin SDK at the Firestore emulator, and make sure no test
// can ever reach the real Stripe account or send a real email. The credentials in
// functions/.env are LIVE — a test that escaped the emulator would charge cards.
process.env.FUNCTIONS_TEST = '1'
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'art-saturated'
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080'

// Deliberately bogus — if a mock ever fails to intercept, the call errors out
// loudly instead of quietly hitting production.
process.env.STRIPE_SECRET_KEY   = 'sk_test_DUMMY_NOT_A_REAL_KEY'
process.env.GMAIL_USER          = 'test@example.invalid'
process.env.GMAIL_APP_PASSWORD  = 'not-a-real-password'
