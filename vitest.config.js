import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = dirname(fileURLToPath(import.meta.url))
const fromFunctions = (pkg) => resolve(root, 'functions/node_modules', pkg)

// Tests run against the Firebase emulator suite, not production. Launch them via
// `npm test`, which wraps this in `firebase emulators:exec` so the emulators are
// up (and torn down) around the run.
export default defineConfig({
  resolve: {
    // functions/ has its own node_modules; the test root cannot see them.
    alias: {
      'firebase-admin/firestore': fromFunctions('firebase-admin/lib/firestore'),
      'firebase-admin': fromFunctions('firebase-admin'),
      'firebase-functions/v1': fromFunctions('firebase-functions/lib/v1'),
      'firebase-functions': fromFunctions('firebase-functions'),
      nodemailer: fromFunctions('nodemailer'),
      stripe: fromFunctions('stripe'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // Emulator state is shared, so suites must not interleave writes.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
    setupFiles: ['tests/setup.js'],
  },
})
