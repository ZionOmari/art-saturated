import {
  collection, doc, getDocs, addDoc, updateDoc, deleteDoc,
  getDoc, setDoc, query, where, orderBy, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../lib/firebase'

// ── Default availability window ────────────────────────────────────────────────
export const DEFAULT_AVAIL_START  = 8   // 8 AM
export const DEFAULT_AVAIL_END    = 24  // midnight (last bookable slot = 23:00)
export const MIN_ADVANCE_HOURS    = 48  // bookings must be placed ≥48 hrs before the slot

// Services allowed to be booked during shop hours
export const SHOP_HOUR_SERVICE_IDS = ['consultation', 'creative-consult']

// ── Shop hours — blocked from booking ────────────────────────────────────────
// Defaults: Tuesday–Saturday (days 2–6), 12:00 PM – 5:00 PM
export const DEFAULT_SHOP_HOURS = { days: [2, 3, 4, 5, 6], start: 12, end: 17 }

// isShopHour accepts an optional config { days, start, end }; falls back to defaults
export function isShopHour(dateStr, timeStr, config = null) {
  const cfg   = config || DEFAULT_SHOP_HOURS
  const days  = new Set(cfg.days)
  const start = cfg.start
  const end   = cfg.end
  const [y, m, d] = dateStr.split('-').map(Number)
  const dow  = new Date(y, m - 1, d).getDay()
  const [h, mn]   = timeStr.split(':').map(Number)
  const hourVal   = h + (mn || 0) / 60
  return days.has(dow) && hourVal >= start && hourVal < end
}

// ── Shop hours persistence ────────────────────────────────────────────────────
export async function loadShopHours() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'shopHours'))
    if (snap.exists()) return snap.data()
  } catch (e) { console.error('loadShopHours:', e) }
  return { ...DEFAULT_SHOP_HOURS }
}

export async function saveShopHours(config) {
  await setDoc(doc(db, 'settings', 'shopHours'), config)
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}

function slotDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  const [h, mn]   = timeStr.split(':').map(Number)
  return new Date(y, m - 1, d, h, mn || 0, 0)
}

/**
 * Generate virtual available slots for a date based on the 8AM–midnight default.
 * - Shop-hour slots are included but marked `shopHour: true` (limited services only).
 * - Slots within 48 hours of now are excluded.
 * - Explicitly blocked times and already-booked times are excluded.
 */
export function getDefaultAvailableSlots(dateStr, shopConfig, blockedSet, bookedSet) {
  const cfg     = shopConfig || DEFAULT_SHOP_HOURS
  const cutoff  = new Date(Date.now() + MIN_ADVANCE_HOURS * 60 * 60 * 1000)
  const slots   = []
  for (let h = DEFAULT_AVAIL_START; h < DEFAULT_AVAIL_END; h++) {
    for (const mn of [0, 30]) {
      const time = `${String(h).padStart(2,'0')}:${mn === 0 ? '00' : '30'}`
      if (slotDateTime(dateStr, time) <= cutoff) continue   // enforce 48-hr minimum
      if (blockedSet?.has(`${dateStr}|${time}`))  continue  // explicitly blocked
      if (bookedSet?.has(`${dateStr}|${time}`))   continue  // already booked
      const shopHour = isShopHour(dateStr, time, cfg)
      slots.push({ id: `virtual_${dateStr}_${time}`, date: dateStr, time, booked: false, virtual: true, shopHour })
    }
  }
  return slots
}

// ── Blocked Times ─────────────────────────────────────────────────────────────
// Explicit unavailability that overrides the 8AM–midnight default.

export async function blockTime(date, time) {
  const ref = await addDoc(collection(db, 'blockedTimes'), {
    date, time, createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function unblockTime(id) {
  await deleteDoc(doc(db, 'blockedTimes', id))
}

export async function getBlockedTimesForDate(date) {
  const snap = await getDocs(query(collection(db, 'blockedTimes'), where('date', '==', date)))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.time.localeCompare(b.time))
}

export async function getAllBlockedTimes() {
  const snap = await getDocs(collection(db, 'blockedTimes'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

// ── Slots ───────────────────────────────────────────────────────────────────

export async function getSlots() {
  const snap = await getDocs(collection(db, 'slots'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))
}

export async function addSlot(date, time) {
  const ref = await addDoc(collection(db, 'slots'), {
    date, time, booked: false, createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function removeSlot(id) {
  await deleteDoc(doc(db, 'slots', id))
}

/**
 * Returns all slots for a date: booked real slots + virtual available slots.
 * Virtual slots represent the default 8AM–midnight availability minus
 * shop hours and explicitly blocked times.
 */
export async function getSlotsForDate(date) {
  const [slotsSnap, blockedSnap, shopCfg] = await Promise.all([
    getDocs(query(collection(db, 'slots'), where('date', '==', date))),
    getDocs(query(collection(db, 'blockedTimes'), where('date', '==', date))),
    loadShopHours(),
  ])

  const existingSlots = slotsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
  const blockedSet    = new Set(blockedSnap.docs.map(d => `${date}|${d.data().time}`))
  const bookedSlots   = existingSlots.filter(s => s.booked)
  const bookedSet     = new Set(bookedSlots.map(s => `${date}|${s.time}`))

  const virtualSlots = getDefaultAvailableSlots(date, shopCfg, blockedSet, bookedSet)

  return [...bookedSlots, ...virtualSlots]
    .sort((a, b) => a.time.localeCompare(b.time))
}

/**
 * Returns all dates within the next `daysAhead` days that have at least one
 * available slot under the 8AM–midnight default.
 */
export async function getAvailableDates(daysAhead = 90) {
  const [blockedSnap, slotsSnap, shopCfg] = await Promise.all([
    getDocs(collection(db, 'blockedTimes')),
    getDocs(collection(db, 'slots')),
    loadShopHours(),
  ])

  const blockedSet = new Set(blockedSnap.docs.map(d => `${d.data().date}|${d.data().time}`))
  const bookedSet  = new Set(
    slotsSnap.docs.map(d => d.data()).filter(s => s.booked).map(s => `${s.date}|${s.time}`)
  )

  const today = new Date()
  const dates = []

  for (let i = 0; i < daysAhead; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() + i)
    const ds = toDateStr(d)
    if (getDefaultAvailableSlots(ds, shopCfg, blockedSet, bookedSet).length > 0) {
      dates.push(ds)
    }
  }

  return dates
}

// ── Bookings ─────────────────────────────────────────────────────────────────

export async function getBookings() {
  const snap = await getDocs(collection(db, 'bookings'))
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
}

/**
 * Save a booking. If slotId is a virtual slot (prefixed "virtual_"), creates
 * the real slot in Firestore first. Accepts optional date/time overrides for
 * virtual slots.
 */
export async function saveBooking({ slotId, date, time, service, name, email, phone, message }) {
  let realSlotId = slotId
  let slotDate   = date
  let slotTime   = time

  if (slotId?.startsWith('virtual_')) {
    // Parse date and time from virtual ID: virtual_YYYY-MM-DD_HH:MM
    const match = slotId.match(/^virtual_(\d{4}-\d{2}-\d{2})_(\d{2}:\d{2})$/)
    if (match) { slotDate = match[1]; slotTime = match[2] }
    const ref = await addDoc(collection(db, 'slots'), {
      date: slotDate, time: slotTime, booked: true, createdAt: serverTimestamp(),
    })
    realSlotId = ref.id
  } else {
    await updateDoc(doc(db, 'slots', realSlotId), { booked: true })
    // Fallback: fetch slot date/time if not provided
    if (!slotDate || !slotTime) {
      const snap = await getDoc(doc(db, 'slots', realSlotId))
      if (snap.exists()) { slotDate = snap.data().date; slotTime = snap.data().time }
    }
  }

  const ref = await addDoc(collection(db, 'bookings'), {
    slotId: realSlotId,
    date:   slotDate   || '',
    time:   slotTime   || '',
    service, name, email,
    phone:   phone   || '',
    message: message || '',
    status:  'confirmed',
    createdAt: serverTimestamp(),
  })
  return ref.id
}

export async function cancelBooking(bookingId, slotId) {
  await updateDoc(doc(db, 'slots', slotId), { booked: false })
  await updateDoc(doc(db, 'bookings', bookingId), { status: 'cancelled' })
}
