import { useState, useEffect } from 'react'
import { collection, getDocs, addDoc, deleteDoc, doc, serverTimestamp } from 'firebase/firestore'
import { db } from '../lib/firebase'
import { addSlot, getSlots, isShopHour, loadShopHours, saveShopHours, DEFAULT_SHOP_HOURS, blockTime, getAllBlockedTimes } from '../data/booking'
import { addTask, getTasksForRange } from '../data/tasks'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const TIME_SLOTS = (() => {
  const slots = []
  for (let h = 7; h <= 22; h++) {
    slots.push(`${String(h).padStart(2,'0')}:00`)
    if (h < 22) slots.push(`${String(h).padStart(2,'0')}:30`)
  }
  return slots
})()

// Representative dates for each day-of-week (Sun=0 … Sat=6) to check shop hours
// Week of 2026-03-29 (Sun) → 2026-04-04 (Sat)
const DOW_SAMPLE = [
  '2026-03-29', // Sun
  '2026-03-30', // Mon
  '2026-03-31', // Tue
  '2026-04-01', // Wed
  '2026-04-02', // Thu
  '2026-04-03', // Fri
  '2026-04-04', // Sat
]

function fmtTime(t) {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hr   = h % 12 || 12
  return `${hr}:${String(m).padStart(2,'0')} ${ampm}`
}

function addDays(date, n) {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}

function todayStr() { return toDateStr(new Date()) }

// Returns 'all' | 'some' | 'none' — how many of the selected days have this time as a shop hour
function shopHourStatus(timeStr, selectedDays, shopConfig) {
  if (!selectedDays.length) return 'none'
  const blocked = selectedDays.filter(dow => isShopHour(DOW_SAMPLE[dow], timeStr, shopConfig))
  if (blocked.length === 0)                   return 'none'
  if (blocked.length === selectedDays.length) return 'all'
  return 'some'
}

// pill style — active: selected, type: 'avail'|'unavail'|'admin'|null|'shop'
const pill = (active, type) => {
  const bg = active
    ? type === 'unavail' ? '#7a2020'
    : type === 'avail'   ? '#1a5c1a'
    : type === 'admin'   ? '#4a2a7a'
    : type === 'shop'    ? '#b97a20'
    : '#1a1208'
    : 'transparent'
  const border = active
    ? type === 'unavail' ? '#7a2020'
    : type === 'avail'   ? '#1a5c1a'
    : type === 'admin'   ? '#4a2a7a'
    : type === 'shop'    ? '#b97a20'
    : '#1a1208'
    : '#d4c9bb'
  return {
    fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.06em',
    padding: '5px 12px', border: '1px solid', cursor: 'pointer', transition: 'all 0.15s',
    background: bg, color: active ? '#fff' : '#8a5c3a', borderColor: border,
  }
}

const BLANK_TEMPLATE = {
  name: '',
  type: 'available',
  frequency: 'weekly',
  days: [],
  times: [],
  weeksAhead: 4,
  startDate: todayStr(),
}

export default function ScheduleManager() {
  const [templates,  setTemplates]  = useState([])
  const [editing,    setEditing]    = useState(null)
  const [busy,       setBusy]       = useState(false)
  const [status,     setStatus]     = useState('')
  const [loading,    setLoading]    = useState(true)
  const [shopConfig, setShopConfig] = useState(DEFAULT_SHOP_HOURS)
  const [editingShop, setEditingShop] = useState(false)
  const [shopDraft,   setShopDraft]   = useState(null)
  const [shopSaving,  setShopSaving]  = useState(false)

  useEffect(() => {
    loadTemplates()
    loadShopHours().then(cfg => setShopConfig(cfg))
  }, [])

  async function loadTemplates() {
    try {
      const snap = await getDocs(collection(db, 'scheduleTemplates'))
      setTemplates(snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)))
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  async function handleSaveShopHours() {
    setShopSaving(true)
    try {
      await saveShopHours(shopDraft)
      setShopConfig(shopDraft)
      setEditingShop(false)
    } catch (e) { console.error(e) }
    setShopSaving(false)
  }

  function toggleDay(d) {
    setEditing(prev => ({
      ...prev,
      days: prev.days.includes(d) ? prev.days.filter(x => x !== d) : [...prev.days, d],
    }))
  }

  function toggleTime(t) {
    setEditing(prev => ({
      ...prev,
      times: prev.times.includes(t) ? prev.times.filter(x => x !== t) : [...prev.times, t],
    }))
  }

  async function saveTemplate() {
    if (!editing.name.trim())  { setStatus('Give this schedule a name.'); return }
    if (!editing.days.length)  { setStatus('Select at least one day.'); return }
    if (!editing.times.length) { setStatus('Select at least one time slot.'); return }
    setBusy(true); setStatus('')
    try {
      const data = {
        name: editing.name.trim(), type: editing.type, frequency: editing.frequency,
        days: editing.days, times: editing.times, weeksAhead: editing.weeksAhead,
        startDate: editing.startDate || todayStr(), createdAt: serverTimestamp(),
      }
      if (editing.id) await deleteDoc(doc(db, 'scheduleTemplates', editing.id))
      await addDoc(collection(db, 'scheduleTemplates'), data)
      await loadTemplates()
      setEditing(null)
      setStatus('Schedule saved.')
    } catch (e) { setStatus('Error saving.'); console.error(e) }
    setBusy(false)
  }

  async function deleteTemplate(id) {
    if (!window.confirm('Delete this schedule template?')) return
    await deleteDoc(doc(db, 'scheduleTemplates', id))
    await loadTemplates()
  }

  async function applyTemplate(tpl) {
    const isAvail = tpl.type === 'available'
    const isAdmin = tpl.type === 'admin'
    const lookaheadLabel = tpl.weeksAhead === 'permanent' ? '2 years' : `${tpl.weeksAhead} weeks`
    const verb = isAvail ? 'Generate availability slots' : isAdmin ? 'Create admin time blocks' : 'Block and remove slots'
    if (!window.confirm(`${verb} for "${tpl.name}" (${lookaheadLabel} ahead)?`)) return
    setBusy(true); setStatus(isAvail ? 'Generating slots…' : isAdmin ? 'Creating admin blocks…' : 'Removing slots…')

    try {
      const cfg        = await loadShopHours()
      const lookahead  = tpl.weeksAhead === 'permanent' ? 104 : tpl.weeksAhead
      const [sy,sm,sd] = (tpl.startDate || todayStr()).split('-').map(Number)
      const anchorDate = new Date(sy, sm - 1, sd)
      const today      = new Date()
      const startFrom  = anchorDate > today ? anchorDate : today
      const end        = addDays(startFrom, lookahead * 7)
      const biweek     = tpl.frequency === 'biweekly'

      let added = 0, skipped = 0
      let cur = new Date(startFrom)

      // For availability: track existing slots to skip duplicates
      let existingSet = new Set(), slotMap = {}
      if (isAvail) {
        const existing = await getSlots()
        existingSet = new Set(existing.map(s => `${s.date}|${s.time}`))
        for (const s of existing) slotMap[`${s.date}|${s.time}`] = s
      }

      // For unavailability: track existing blocked times to skip duplicates
      let blockedSet = new Set()
      if (!isAvail && !isAdmin) {
        const existing = await getAllBlockedTimes()
        blockedSet = new Set(existing.map(b => `${b.date}|${b.time}`))
      }

      // For admin: fetch existing task range to avoid duplicates
      let adminTaskSet = new Set()
      if (isAdmin) {
        const endStr   = toDateStr(end)
        const startStr = toDateStr(startFrom)
        const existing = await getTasksForRange(startStr, endStr)
        adminTaskSet   = new Set(existing.filter(t => t.type === 'admin').map(t => `${t.date}|${t.time || ''}`))
      }

      function getWeekParity(date) {
        const mon = new Date(date); mon.setDate(date.getDate() - ((date.getDay() + 6) % 7))
        const anchorMon = new Date(anchorDate); anchorMon.setDate(anchorDate.getDate() - ((anchorDate.getDay() + 6) % 7))
        return Math.round((mon - anchorMon) / (7 * 24 * 60 * 60 * 1000)) % 2
      }

      while (cur <= end) {
        const dow = cur.getDay()
        if (biweek && getWeekParity(cur) !== 0) { cur = addDays(cur, 1); continue }
        if (tpl.days.includes(dow)) {
          const ds = toDateStr(cur)
          for (const time of tpl.times) {
            const key = `${ds}|${time}`
            if (isAdmin) {
              if (adminTaskSet.has(key)) { skipped++; continue }
              await addTask({ date: ds, time, title: tpl.name, type: 'admin' })
              adminTaskSet.add(key); added++
            } else if (isAvail) {
              if (isShopHour(ds, time, cfg)) { skipped++; continue }
              if (existingSet.has(key))      { skipped++; continue }
              await addSlot(ds, time); existingSet.add(key); added++
            } else {
              // Unavailability — write to blockedTimes (overrides default availability)
              if (blockedSet.has(key)) { skipped++; continue }
              await blockTime(ds, time); blockedSet.add(key); added++
            }
          }
        }
        cur = addDays(cur, 1)
      }

      setStatus(
        isAdmin ? `Done — ${added} admin blocks created${skipped ? `, ${skipped} skipped (already exist)` : ''}.` :
        isAvail ? `Done — ${added} slots added${skipped ? `, ${skipped} skipped` : ''}.` :
                  `Done — ${added} times blocked${skipped ? `, ${skipped} skipped (already blocked)` : ''}.`
      )
    } catch (e) { setStatus('Error applying schedule.'); console.error(e) }
    setBusy(false)
  }

  // ── Editor ────────────────────────────────────────────────────────────────
  if (editing) {
    const isAvail = editing.type === 'available'
    const isAdmin = editing.type === 'admin'

    // For each time slot, compute shop-hour status against currently selected days
    const shopStatusFor = t => shopHourStatus(t, editing.days, shopConfig)

    // Selectable = times that are NOT shop hours on ALL selected days (for avail)
    // For unavail/admin, all times are selectable
    const selectableTimes = isAvail
      ? TIME_SLOTS.filter(t => shopStatusFor(t) !== 'all')
      : TIME_SLOTS
    const allSelected = selectableTimes.every(t => editing.times.includes(t))

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <button onClick={() => { setEditing(null); setStatus('') }}
          style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', background: 'none', border: 'none', cursor: 'pointer', color: '#8a5c3a', alignSelf: 'flex-start' }}>
          ← Back
        </button>

        <h3 style={{ fontFamily: 'serif', fontSize: '1.2rem', fontWeight: 'normal', color: '#1a1208', margin: 0 }}>
          {editing.id ? 'Edit Schedule' : 'New Schedule'}
        </h3>

        {/* Schedule type */}
        <div>
          <label style={labelStyle}>Schedule Type</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button onClick={() => setEditing(p => ({ ...p, type: 'available' }))} style={pill(editing.type === 'available', 'avail')}>✓ Availability</button>
            <button onClick={() => setEditing(p => ({ ...p, type: 'unavailable' }))} style={pill(editing.type === 'unavailable', 'unavail')}>✕ Unavailability</button>
            <button onClick={() => setEditing(p => ({ ...p, type: 'admin' }))} style={pill(editing.type === 'admin', 'admin')}>✦ Admin Time</button>
          </div>
          <p style={hintStyle}>
            {editing.type === 'available'   ? 'Opens these time slots for booking.' :
             editing.type === 'unavailable' ? 'Removes slots from availability. Booked appointments are never touched.' :
             'Blocks recurring admin time on your calendar. Shows as purple task entries — no booking slots affected.'}
          </p>
        </div>

        {/* Name */}
        <div>
          <label style={labelStyle}>Schedule Name</label>
          <input value={editing.name}
            onChange={e => setEditing(p => ({ ...p, name: e.target.value }))}
            placeholder={isAvail ? 'e.g. Standard Week, Teaching Nights…' : 'e.g. Shop Days, Holiday Block…'}
            style={inputStyle} />
        </div>

        {/* Frequency */}
        <div>
          <label style={labelStyle}>Frequency</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            {['weekly','biweekly'].map(f => (
              <button key={f} onClick={() => setEditing(p => ({ ...p, frequency: f }))} style={pill(editing.frequency === f)}>
                {f === 'weekly' ? 'Every Week' : 'Every Other Week'}
              </button>
            ))}
          </div>
        </div>

        {/* Start date */}
        <div>
          <label style={labelStyle}>
            Start Date
            <span style={{ textTransform: 'none', letterSpacing: 0, color: '#b0a898', marginLeft: '8px' }}>
              {editing.frequency === 'biweekly' ? '— anchors which weeks are "on" weeks' : '— slots generate from this date forward'}
            </span>
          </label>
          <input type="date" value={editing.startDate || todayStr()}
            onChange={e => setEditing(p => ({ ...p, startDate: e.target.value }))}
            style={inputStyle} />
        </div>

        {/* Days */}
        <div>
          <label style={labelStyle}>Days</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {DAYS.map((d, i) => (
              <button key={d} onClick={() => toggleDay(i)}
                style={{ ...pill(editing.days.includes(i), isAvail ? null : 'unavail'), minWidth: '44px' }}>
                {d}
              </button>
            ))}
          </div>
        </div>

        {/* Times */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' }}>
            <label style={{ ...labelStyle, margin: 0 }}>
              Time Slots
              {isAvail && editing.days.length > 0 && (
                <span style={{ color: '#b97a20', marginLeft: '8px', textTransform: 'none', letterSpacing: 0 }}>— amber = shop hours on selected days</span>
              )}
            </label>
            <button
              onClick={() => setEditing(p => ({ ...p, times: allSelected ? [] : selectableTimes }))}
              style={{ ...pill(allSelected, isAvail ? null : isAdmin ? 'admin' : 'unavail'), padding: '3px 10px', fontSize: '10px' }}>
              {allSelected ? 'Clear All' : 'All Day'}
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
            {TIME_SLOTS.map(t => {
              const status = isAvail ? shopStatusFor(t) : 'none'
              const active = editing.times.includes(t)

              // 'all': shop hour on every selected day — amber, non-clickable for avail
              if (status === 'all' && isAvail) return (
                <div key={t} style={{
                  fontFamily: 'monospace', fontSize: '11px', padding: '7px',
                  border: '1px solid #e8c87a', color: '#b97a20',
                  textAlign: 'center', background: 'rgba(185,122,32,0.08)',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                }}>
                  {fmtTime(t)}
                  <span style={{ fontSize: '8px', letterSpacing: '0.06em', color: '#b97a20', textTransform: 'uppercase' }}>shop</span>
                </div>
              )

              // 'some': shop hour on only some selected days — amber but clickable
              if (status === 'some' && isAvail) return (
                <button key={t} onClick={() => toggleTime(t)} style={{
                  ...pill(active, active ? null : null),
                  textAlign: 'center', padding: '7px',
                  background: active ? '#1a1208' : 'rgba(185,122,32,0.08)',
                  borderColor: active ? '#1a1208' : '#e8c87a',
                  color: active ? '#fff' : '#b97a20',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
                }}>
                  {fmtTime(t)}
                  <span style={{ fontSize: '8px', letterSpacing: '0.06em', opacity: 0.7, textTransform: 'uppercase' }}>partial</span>
                </button>
              )

              return (
                <button key={t} onClick={() => toggleTime(t)}
                  style={{ ...pill(active, isAvail ? null : 'unavail'), textAlign: 'center', padding: '7px' }}>
                  {fmtTime(t)}
                </button>
              )
            })}
          </div>

          {isAvail && editing.days.length > 0 && (
            <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'monospace', fontSize: '9px', color: '#b97a20', letterSpacing: '0.06em' }}>■ Shop (all selected days blocked)</span>
              <span style={{ fontFamily: 'monospace', fontSize: '9px', color: '#c8a850', letterSpacing: '0.06em' }}>■ Partial (blocked on some days only)</span>
            </div>
          )}
        </div>

        {/* Weeks ahead */}
        <div>
          <label style={labelStyle}>Apply How Far Ahead</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[2,4,6,8,12].map(w => (
              <button key={w} onClick={() => setEditing(p => ({ ...p, weeksAhead: w }))} style={pill(editing.weeksAhead === w)}>
                {w} weeks
              </button>
            ))}
            <button onClick={() => setEditing(p => ({ ...p, weeksAhead: 'permanent' }))}
              style={{ ...pill(editing.weeksAhead === 'permanent', isAvail ? 'avail' : 'unavail') }}>
              ∞ Permanent
            </button>
          </div>
          {editing.weeksAhead === 'permanent' && (
            <p style={hintStyle}>Generates 2 years of slots at once. Re-apply anytime to extend further.</p>
          )}
        </div>

        {status && <p style={{ fontFamily: 'monospace', fontSize: '11px', color: status.startsWith('Error') ? '#b94040' : '#8a5c3a' }}>{status}</p>}

        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <button onClick={saveTemplate} disabled={busy} style={{ ...pill(true), padding: '10px 24px', fontSize: '11px' }}>
            {busy ? '…' : 'Save Template'}
          </button>
          <button onClick={async () => { await saveTemplate(); if (!busy) await applyTemplate({ ...editing }) }}
            disabled={busy}
            style={{ ...pill(true, isAvail ? 'avail' : isAdmin ? 'admin' : 'unavail'), padding: '10px 24px', fontSize: '11px' }}>
            {busy ? 'Working…' : isAvail ? 'Save & Open Slots' : isAdmin ? 'Save & Create Blocks' : 'Save & Block Now'}
          </button>
        </div>
      </div>
    )
  }

  // ── Template list ─────────────────────────────────────────────────────────
  const availTemplates   = templates.filter(t => t.type === 'available')
  const unavailTemplates = templates.filter(t => t.type === 'unavailable')
  const adminTemplates   = templates.filter(t => t.type === 'admin')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

      {/* ── Shop Hours Settings ── */}
      <div style={{ border: '1px solid #e8c87a', padding: '14px 16px', background: 'rgba(185,122,32,0.04)', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <p style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#b97a20', margin: 0 }}>
            ⬛ Shop Hours
          </p>
          {!editingShop
            ? <button onClick={() => { setShopDraft({ ...shopConfig }); setEditingShop(true) }}
                style={{ fontFamily: 'monospace', fontSize: '10px', color: '#b97a20', background: 'none', border: '1px solid #e8c87a', cursor: 'pointer', padding: '3px 10px', letterSpacing: '0.06em' }}>
                Edit
              </button>
            : <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleSaveShopHours} disabled={shopSaving}
                  style={{ fontFamily: 'monospace', fontSize: '10px', color: '#fff', background: '#b97a20', border: '1px solid #b97a20', cursor: 'pointer', padding: '3px 10px' }}>
                  {shopSaving ? '…' : 'Save'}
                </button>
                <button onClick={() => setEditingShop(false)}
                  style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a5c3a', background: 'none', border: '1px solid #d4c9bb', cursor: 'pointer', padding: '3px 10px' }}>
                  Cancel
                </button>
              </div>
          }
        </div>

        {!editingShop ? (
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', margin: 0 }}>
            {shopConfig.days.sort((a,b)=>a-b).map(d => DAYS[d]).join(', ')}
            {' · '}
            {fmtTime(`${String(shopConfig.start).padStart(2,'0')}:00`)} – {fmtTime(`${String(shopConfig.end).padStart(2,'0')}:00`)}
            <span style={{ color: '#b0a898', marginLeft: '8px' }}>(blocked from booking)</span>
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div>
              <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a5c3a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Days</p>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {DAYS.map((d, i) => {
                  const active = shopDraft.days.includes(i)
                  return (
                    <button key={d} onClick={() => setShopDraft(p => ({
                      ...p,
                      days: active ? p.days.filter(x => x !== i) : [...p.days, i].sort((a,b)=>a-b),
                    }))} style={{ ...pill(active, 'shop'), minWidth: '40px', fontSize: '10px', padding: '4px 8px' }}>
                      {d}
                    </button>
                  )
                })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              <div>
                <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a5c3a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Start</p>
                <select value={shopDraft.start}
                  onChange={e => setShopDraft(p => ({ ...p, start: Number(e.target.value) }))}
                  style={{ fontFamily: 'monospace', fontSize: '12px', padding: '6px 10px', border: '1px solid #e8c87a', background: '#faf8f4', color: '#1a1208', outline: 'none' }}>
                  {Array.from({length: 14}, (_,i) => i + 7).map(h => (
                    <option key={h} value={h}>{fmtTime(`${String(h).padStart(2,'0')}:00`)}</option>
                  ))}
                </select>
              </div>
              <div>
                <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#8a5c3a', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>End</p>
                <select value={shopDraft.end}
                  onChange={e => setShopDraft(p => ({ ...p, end: Number(e.target.value) }))}
                  style={{ fontFamily: 'monospace', fontSize: '12px', padding: '6px 10px', border: '1px solid #e8c87a', background: '#faf8f4', color: '#1a1208', outline: 'none' }}>
                  {Array.from({length: 14}, (_,i) => i + 7).map(h => (
                    <option key={h} value={h}>{fmtTime(`${String(h).padStart(2,'0')}:00`)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontFamily: 'serif', fontSize: '1.1rem', fontWeight: 'normal', color: '#1a1208', margin: 0 }}>Recurring Schedules</h3>
        <button onClick={() => { setEditing({ ...BLANK_TEMPLATE }); setStatus('') }} style={pill(true)}>+ New Schedule</button>
      </div>

      <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', lineHeight: 1.7, margin: 0 }}>
        Availability schedules open booking slots. Unavailability schedules remove them. Shop hours are always skipped during availability generation.
      </p>

      {status && <p style={{ fontFamily: 'monospace', fontSize: '11px', color: status.startsWith('Error') ? '#b94040' : '#4a8c4a' }}>{status}</p>}
      {loading && <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#8a5c3a' }}>Loading…</p>}

      {/* ── Availability group ── */}
      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <p style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#1a5c1a', margin: 0, borderBottom: '1px solid #d4ecd4', paddingBottom: '6px' }}>✓ Availability</p>
          {availTemplates.length === 0 && <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b0a898' }}>No availability schedules yet.</p>}
          {availTemplates.map(tpl => <TemplateCard key={tpl.id} tpl={tpl} busy={busy} onEdit={() => { setEditing({ ...tpl }); setStatus('') }} onDelete={() => deleteTemplate(tpl.id)} onApply={() => applyTemplate(tpl)} />)}
        </div>
      )}

      {/* ── Unavailability group ── */}
      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
          <p style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#7a2020', margin: 0, borderBottom: '1px solid #ecdcd4', paddingBottom: '6px' }}>✕ Unavailability</p>
          {unavailTemplates.length === 0 && <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b0a898' }}>No unavailability schedules yet.</p>}
          {unavailTemplates.map(tpl => <TemplateCard key={tpl.id} tpl={tpl} busy={busy} onEdit={() => { setEditing({ ...tpl }); setStatus('') }} onDelete={() => deleteTemplate(tpl.id)} onApply={() => applyTemplate(tpl)} />)}
        </div>
      )}

      {/* ── Admin time group ── */}
      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '6px' }}>
          <p style={{ fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.12em', color: '#4a2a7a', margin: 0, borderBottom: '1px solid #d4c8ec', paddingBottom: '6px' }}>✦ Admin Time</p>
          {adminTemplates.length === 0 && <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#b0a898' }}>No admin time schedules yet.</p>}
          {adminTemplates.map(tpl => <TemplateCard key={tpl.id} tpl={tpl} busy={busy} onEdit={() => { setEditing({ ...tpl }); setStatus('') }} onDelete={() => deleteTemplate(tpl.id)} onApply={() => applyTemplate(tpl)} />)}
        </div>
      )}
    </div>
  )
}

function TemplateCard({ tpl, busy, onEdit, onDelete, onApply }) {
  const isAvail = tpl.type === 'available'
  const isAdmin = tpl.type === 'admin'
  const borderColor = isAvail ? '#c8dcc8' : isAdmin ? '#c8b8e8' : '#dcc8c8'
  const bgColor     = isAvail ? 'rgba(26,92,26,0.02)' : isAdmin ? 'rgba(74,42,122,0.02)' : 'rgba(122,32,32,0.02)'
  const dayBg       = isAvail ? '#1a5c1a' : isAdmin ? '#4a2a7a' : '#7a2020'
  const applyType   = isAvail ? 'avail' : isAdmin ? 'admin' : 'unavail'
  const applyLabel  = isAvail ? 'Open Slots' : isAdmin ? 'Create Blocks' : 'Block Slots'
  return (
    <div style={{ border: `1px solid ${borderColor}`, padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px', background: bgColor }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#1a1208', margin: 0, fontWeight: 'bold' }}>{tpl.name}</p>
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#8a5c3a', margin: 0 }}>
            {tpl.frequency === 'biweekly' ? 'Every other week' : 'Every week'} · {tpl.weeksAhead === 'permanent' ? '∞ permanent' : `${tpl.weeksAhead} weeks ahead`}
            {tpl.startDate && <span style={{ color: '#b0a898' }}> · from {tpl.startDate}</span>}
          </p>
        </div>
        <button onClick={onDelete} style={{ fontFamily: 'monospace', fontSize: '10px', color: '#b94040', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Delete</button>
      </div>
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {tpl.days.sort((a,b)=>a-b).map(d => (
          <span key={d} style={{ fontFamily: 'monospace', fontSize: '10px', padding: '3px 8px', background: dayBg, color: '#f2ebe0' }}>
            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d]}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
        {tpl.times.sort().map(t => (
          <span key={t} style={{ fontFamily: 'monospace', fontSize: '10px', padding: '3px 8px', border: `1px solid ${borderColor}`, color: '#8a5c3a' }}>
            {fmtTime(t)}
          </span>
        ))}
      </div>
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={onEdit} style={{ ...pill(false), padding: '6px 16px', fontSize: '10px' }}>Edit</button>
        <button onClick={onApply} disabled={busy} style={{ ...pill(true, applyType), padding: '6px 16px', fontSize: '10px' }}>
          {busy ? 'Working…' : applyLabel}
        </button>
      </div>
    </div>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const labelStyle = {
  fontFamily: 'monospace', fontSize: '10px', textTransform: 'uppercase',
  letterSpacing: '0.1em', color: '#8a5c3a', display: 'block', marginBottom: '8px',
}
const hintStyle = { fontFamily: 'monospace', fontSize: '10px', color: '#b0a898', marginTop: '6px' }
const inputStyle = {
  fontFamily: 'monospace', fontSize: '13px', padding: '10px 14px',
  border: '1px solid #d4c9bb', background: 'rgba(250,248,244,0.8)',
  color: '#1a1208', outline: 'none', width: '100%', boxSizing: 'border-box',
}
