// Inert Firebase SDK stub for the design-system preview bundle.
//
// Every `firebase/*` import in the bundle resolves here (see
// .design-sync/tsconfig.ds.json -> compilerOptions.paths). The app's real
// component code is bundled unchanged; only the external Firebase SDK is
// replaced, so the bundle initializes without a live backend instead of
// throwing `auth/invalid-api-key` at module-eval (which crashed the whole
// IIFE and left window.ArtSaturated empty).
//
// ESM with explicit named exports — esbuild links these directly (a CJS Proxy
// does not survive esbuild's interop). The set is the union of every
// `firebase/*` named import across the app's src/, so the bundled graph always
// resolves. A few names get render-friendly behavior so providers/components
// settle into a logged-out, empty state rather than hanging.

const unsub = () => {}
const inert = () => ({})
const emptySnap = { docs: [], empty: true, size: 0, forEach: () => {} }
const emptyDoc = { exists: () => false, data: () => ({}), id: 'stub' }

// ── firebase/app ───────────────────────────────────────────────────────────
export const initializeApp = inert
export const getApps = () => []
export const getApp = inert

// ── firebase/auth ──────────────────────────────────────────────────────────
export const getAuth = inert
export const connectAuthEmulator = () => {}
export function GoogleAuthProvider() {}
export function FacebookAuthProvider() {}
export function OAuthProvider() {}
// Resolve immediately with "no user" so AuthProvider's `{!loading && children}`
// gate opens and children render.
export const onAuthStateChanged = (_a, cb) => { try { if (typeof cb === 'function') cb(null) } catch (e) {} return unsub }
export const onIdTokenChanged = onAuthStateChanged
export const signInWithEmailAndPassword = () => Promise.resolve({ user: null })
export const createUserWithEmailAndPassword = () => Promise.resolve({ user: null })
export const signInWithPopup = () => Promise.resolve({ user: null })
export const signOut = () => Promise.resolve()
export const updateProfile = () => Promise.resolve()
export const sendEmailVerification = () => Promise.resolve()
export const sendPasswordResetEmail = () => Promise.resolve()

// ── firebase/firestore ─────────────────────────────────────────────────────
export const initializeFirestore = inert
export const getFirestore = inert
export const connectFirestoreEmulator = () => {}
export const doc = inert
export const collection = inert
export const collectionGroup = inert
export const query = inert
export const where = inert
export const orderBy = inert
export const limit = inert
export const serverTimestamp = inert
export const increment = inert
export const arrayUnion = inert
export const arrayRemove = inert
export const writeBatch = () => ({ set() {}, update() {}, delete() {}, commit: () => Promise.resolve() })
export const getDoc = () => Promise.resolve(emptyDoc)
export const getDocs = () => Promise.resolve(emptySnap)
export const getCountFromServer = () => Promise.resolve({ data: () => ({ count: 0 }) })
export const addDoc = () => Promise.resolve({ id: 'stub' })
export const setDoc = () => Promise.resolve()
export const updateDoc = () => Promise.resolve()
export const deleteDoc = () => Promise.resolve()
export const runTransaction = (_db, fn) => { try { return Promise.resolve(typeof fn === 'function' ? fn({ get: () => Promise.resolve(emptyDoc), set() {}, update() {}, delete() {} }) : undefined) } catch (e) { return Promise.resolve() } }
// One empty snapshot, then unsubscribe.
export const onSnapshot = (_q, cb) => { try { if (typeof cb === 'function') cb(emptySnap) } catch (e) {} return unsub }

// ── firebase/storage ───────────────────────────────────────────────────────
export const getStorage = inert
export const connectStorageEmulator = () => {}
export const ref = inert
export const uploadBytes = () => Promise.resolve({ ref: {}, metadata: {} })
export const getDownloadURL = () => Promise.resolve('')

// ── firebase/functions ─────────────────────────────────────────────────────
export const getFunctions = inert
export const connectFunctionsEmulator = () => {}
export const httpsCallable = () => () => Promise.resolve({ data: {} })

export default {}
