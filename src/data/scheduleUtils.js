/**
 * Schedule-aware commission completion calculator.
 *
 * Logic:
 *  - Each shop day contributes (shopEnd - shopStart) hours toward commission work.
 *  - Booked booking slots inside shop hours are subtracted (you're with a client).
 *  - Unbooked booking slots OUTSIDE shop hours add extra hours (evening / morning slots
 *    you've opened that nobody has taken — fair game for studio work).
 *  - There is a hard minimum of MIN_DAYS before the piece could be ready.
 *  - We walk forward day-by-day accumulating available hours until the total
 *    commission hours are covered, then return that date.
 */

import { loadShopHours, isShopHour, DEFAULT_AVAIL_START, DEFAULT_AVAIL_END, getAllBlockedTimes } from './booking'
import { getSlots } from './booking'

const MIN_DAYS = 5

function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

/**
 * Returns available working hours on a given date.
 * Base = 8 AM–midnight default window, minus shop hours, minus booked, minus blocked.
 *
 * @param {string} ds          - YYYY-MM-DD
 * @param {object} shopConfig  - { days: number[], start: number, end: number }
 * @param {Set}    bookedSet   - Set of "date|HH:00" strings for booked appointments
 * @param {Set}    blockedSet  - Set of "date|HH:00" strings for explicitly blocked times
 */
function hoursAvailableOnDay(ds, shopConfig, bookedSet, blockedSet) {
  let hours = 0
  for (let h = DEFAULT_AVAIL_START; h < DEFAULT_AVAIL_END; h++) {
    const t = `${String(h).padStart(2,'0')}:00`
    if (isShopHour(ds, t, shopConfig))   continue  // shop hours = working in store
    if (bookedSet.has(`${ds}|${t}`))     continue  // booked appointment
    if (blockedSet.has(`${ds}|${t}`))    continue  // explicitly blocked
    hours++
  }
  return hours
}

/**
 * Walk forward from startDate and accumulate available hours until
 * hoursNeeded is covered. Returns the date string when done.
 */
function walkToCompletion(hoursNeeded, startDate, shopConfig, bookedSet, blockedSet) {
  let accumulated = 0
  let cur = new Date(startDate)
  const limit = addDays(startDate, 730)   // safety: never go beyond 2 years

  while (accumulated < hoursNeeded && cur <= limit) {
    const ds = toDateStr(cur)
    accumulated += hoursAvailableOnDay(ds, shopConfig, bookedSet, blockedSet)
    if (accumulated < hoursNeeded) cur = addDays(cur, 1)
  }

  return toDateStr(cur)
}

/**
 * Main export — call from CommissionForm when size/medium changes.
 *
 * Returns:
 * {
 *   optimisticDate: string   — using hMin hours
 *   realisticDate:  string   — using hMax hours
 *   hoursPerWeek:   number   — avg weekly shop hours (for display)
 *   ready:          boolean  — false while loading
 * }
 */
export async function calcRealisticCompletion(hMin, hMax) {
  const [shopConfig, allSlots, allBlocked] = await Promise.all([
    loadShopHours(),
    getSlots(),
    getAllBlockedTimes(),
  ])

  const bookedSet  = new Set(allSlots.filter(s => s.booked).map(s => `${s.date}|${s.time}`))
  const blockedSet = new Set(allBlocked.map(b => `${b.date}|${b.time}`))

  const today     = new Date()
  const startDate = addDays(today, MIN_DAYS)

  const optimisticDate = walkToCompletion(hMin, startDate, shopConfig, bookedSet, blockedSet)
  const realisticDate  = walkToCompletion(hMax, startDate, shopConfig, bookedSet, blockedSet)

  // Weekly shop hours (for human-readable context)
  const hoursPerWeek = shopConfig.days.length * (shopConfig.end - shopConfig.start)

  return {
    optimisticDate,
    realisticDate,
    optimisticLabel: fmtDate(optimisticDate),
    realisticLabel:  fmtDate(realisticDate),
    hoursPerWeek,
    ready: true,
  }
}
