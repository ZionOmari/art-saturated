import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../lib/firebase'
import {
  getAllEvents, submitEventRequest, getMySubmissions,
  withdrawSubmission, updateSubmission, requestEventRemoval,
  requestEventEdit, setEventNotifyPref,
} from '../data/events'
import Footer from '../components/Footer'
import Spinner from '../components/Spinner'

const EMPTY_FORM = {
  title: '', subtitle: '', date: '', startTime: '', endTime: '',
  eventType: '', location: '', description: '',
  entryFee: '', allAges: true, alcohol: false, food: false, flyerURL: '',
}

const EVENT_TYPES = ['Concert', 'Workshop', 'Kickback', 'Crafting', 'Cook Session', 'Community', 'Pop-Up', 'Open Mic', 'Other']
const MONTHS   = ['January','February','March','April','May','June','July','August','September','October','November','December']
const MONTHS_S = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const DOW      = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const DOW_LONG = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const HOURS    = Array.from({ length: 19 }, (_, i) => i + 5) // 5 AM – 11 PM

function toYMD(y, m, d) {
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}
function dateToYMD(d) {
  return toYMD(d.getFullYear(), d.getMonth() + 1, d.getDate())
}
function todayYMD() { return dateToYMD(new Date()) }

function fmtHour(h) {
  if (h === 0)  return '12 AM'
  if (h < 12)   return `${h} AM`
  if (h === 12) return '12 PM'
  return `${h - 12} PM`
}

/** Parse time string → decimal hour (e.g. "7:30 PM" → 19.5). Returns null if unparseable. */
function parseHour(timeStr) {
  if (!timeStr) return null
  const s = timeStr.trim().toLowerCase().replace(/\./g,'')
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!m) return null
  let h = parseInt(m[1])
  const min = m[2] ? parseInt(m[2]) : 0
  const ap  = m[3]
  if (ap === 'pm' && h !== 12) h += 12
  if (ap === 'am' && h === 12) h = 0
  return h + min / 60
}

function getWeekStart(date) {
  const d = new Date(date)
  d.setDate(d.getDate() - d.getDay())
  d.setHours(0,0,0,0)
  return d
}

// ── Shared event pill ─────────────────────────────────────────────────────────
function EventPill({ ev, compact, selected, onClick }) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick?.(ev) }}
      style={{
        display: 'block', width: '100%', textAlign: 'left',
        background: selected ? '#d4b870' : 'rgba(36,20,8,0.75)',
        border: `1px solid ${selected ? '#d4b870' : 'rgba(212,184,112,0.35)'}`,
        padding: compact ? '2px 5px' : '5px 8px',
        cursor: 'pointer', marginBottom: '2px',
        transition: 'background 0.12s',
        borderRadius: '2px',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'rgba(36,20,8,0.92)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'rgba(36,20,8,0.75)' }}
    >
      <span style={{
        fontFamily: 'monospace', fontSize: compact ? '9px' : '11px',
        color: selected ? '#1a1814' : '#d4b870',
        /* Allow 2-line wrap then ellipsis */
        display: '-webkit-box', WebkitLineClamp: compact ? 1 : 2,
        WebkitBoxOrient: 'vertical', overflow: 'hidden',
        letterSpacing: '0.04em', lineHeight: '1.35',
      }}>
        {ev.time && !compact && <span style={{ opacity: 0.7 }}>{ev.time} · </span>}
        {ev.title}
      </span>
    </button>
  )
}

// ── Event detail panel ────────────────────────────────────────────────────────
function EventDetail({ ev, onClose, onViewPage }) {
  if (!ev) return null
  return (
    <div style={{ marginTop: '24px', background: 'rgba(36,20,8,0.82)', borderRadius: '6px', padding: '18px 20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <button
            onClick={() => onViewPage?.(ev.id)}
            style={{ fontFamily: 'serif', fontSize: '1.2rem', color: '#f5f0e8', margin: 0, lineHeight: 1.3, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', textDecoration: 'underline', textDecorationColor: 'rgba(212,184,112,0.45)', textUnderlineOffset: '3px' }}
          >
            {ev.title}
          </button>
          {ev.subtitle && (
            <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#d4b870', marginTop: '3px', opacity: 0.85 }}>{ev.subtitle}</p>
          )}
          <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#d4b870', marginTop: '5px', opacity: 0.7 }}>
            {MONTHS_S[parseInt(ev.date?.split('-')[1]) - 1]} {parseInt(ev.date?.split('-')[2])}
            {(ev.startTime || ev.time) && ` · ${ev.startTime || ev.time}`}
            {ev.location && ` · ${ev.location}`}
          </p>
        </div>
        <button onClick={onClose} style={{ fontFamily: 'monospace', fontSize: '11px', color: '#d4b870', background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0, marginLeft: '16px' }}>
          ✕ close
        </button>
      </div>
      <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {ev.flyerURL && (
          <img src={ev.flyerURL} alt="flyer" style={{ width: '120px', height: '120px', objectFit: 'cover', border: '1px solid rgba(212,184,112,0.3)', flexShrink: 0, borderRadius: '3px' }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {ev.description && (
            <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#ece6d9', lineHeight: 1.7, marginBottom: '12px' }}>{ev.description}</p>
          )}
          <button
            onClick={() => onViewPage?.(ev.id)}
            style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', color: '#d4b870', background: 'none', border: '1px solid rgba(212,184,112,0.45)', padding: '5px 12px', cursor: 'pointer', borderRadius: '2px' }}
          >
            View Event Page → Share · Recap Photos
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Time input with AM/PM toggle ──────────────────────────────────────────────
function TimeInput({ value, onChange, placeholder = '7:30', inputStyle }) {
  const initial = useMemo(() => {
    if (!value) return { t: '', a: 'PM' }
    const m = value.match(/^(\d{1,2}(?::\d{2})?)\s*(AM|PM)?$/i)
    return m ? { t: m[1], a: (m[2] || 'PM').toUpperCase() } : { t: '', a: 'PM' }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [rawTime, setRawTime] = useState(initial.t)
  const [ampm, setAmpm]       = useState(initial.a)

  function emit(t, a) { onChange(t ? `${t} ${a}` : '') }

  function handleTimeChange(e) {
    let v = e.target.value.replace(/[^\d:]/g, '')
    if (v.length === 2 && !v.includes(':') && rawTime.length < 2) v = v + ':'
    setRawTime(v)
    emit(v, ampm)
  }

  function handleAmpm(a) { setAmpm(a); emit(rawTime, a) }

  return (
    <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch' }}>
      <input
        type="text"
        placeholder={placeholder}
        value={rawTime}
        maxLength={5}
        onChange={handleTimeChange}
        style={{ ...inputStyle, width: '80px' }}
      />
      <div style={{ display: 'flex', overflow: 'hidden', border: '1px solid #a08060' }}>
        {['AM', 'PM'].map((a, i) => (
          <button key={a} type="button" onClick={() => handleAmpm(a)}
            style={{
              fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em',
              padding: '8px 14px', border: 'none', cursor: 'pointer',
              background: ampm === a ? '#1a1814' : 'rgba(237,232,224,0.6)',
              color: ampm === a ? '#f5f0e8' : '#7a5030',
              borderRight: i === 0 ? '1px solid #a08060' : 'none',
              transition: 'background 0.12s, color 0.12s',
            }}>
            {a}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Day (Today) view ──────────────────────────────────────────────────────────
function DayView({ date, events, selectedEv, onSelect }) {
  const ymd = dateToYMD(date)
  const dayEvts = events.filter(e => e.date === ymd)

  // Group by floor hour; null-time events → allDay bucket (-1)
  const byHour = {}
  dayEvts.forEach(ev => {
    const h = parseHour(ev.time)
    const slot = h != null ? Math.floor(h) : -1
    if (!byHour[slot]) byHour[slot] = []
    byHour[slot].push(ev)
  })

  const allDay = byHour[-1] || []

  return (
    <div>
      {allDay.length > 0 && (
        <div style={{ display: 'flex', gap: '8px', padding: '8px 0 12px', borderBottom: '1px solid #a08060', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'monospace', fontSize: '10px', color: '#a08060', letterSpacing: '0.1em', textTransform: 'uppercase', width: '60px', flexShrink: 0, textAlign: 'right', paddingRight: '12px' }}>All day</span>
          <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {allDay.map(ev => <EventPill key={ev.id} ev={ev} selected={selectedEv?.id === ev.id} onClick={onSelect} />)}
          </div>
        </div>
      )}

      {HOURS.map(h => {
        const evts = byHour[h] || []
        const isNow = h === new Date().getHours() && ymd === todayYMD()
        return (
          <div key={h} style={{
            display: 'flex', minHeight: '52px',
            borderBottom: '1px solid rgba(160,128,96,0.2)',
            background: isNow ? 'rgba(212,184,112,0.08)' : 'transparent',
          }}>
            <div style={{ width: '60px', flexShrink: 0, fontFamily: 'monospace', fontSize: '10px', color: isNow ? '#d4b870' : '#a08060', paddingTop: '6px', textAlign: 'right', paddingRight: '12px', letterSpacing: '0.05em', fontWeight: isNow ? 600 : 400 }}>
              {fmtHour(h)}
            </div>
            <div style={{ flex: 1, padding: '4px 10px', borderLeft: `1px solid ${isNow ? '#d4b870' : 'rgba(160,128,96,0.25)'}` }}>
              {evts.map(ev => (
                <EventPill key={ev.id} ev={ev} selected={selectedEv?.id === ev.id} onClick={onSelect} />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Week view ─────────────────────────────────────────────────────────────────
function WeekView({ weekStart, events, selectedEv, onSelect }) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return d
  })
  const today = todayYMD()

  // Index events by day
  const byDay = {}
  days.forEach(d => {
    const ymd = dateToYMD(d)
    byDay[ymd] = events.filter(e => e.date === ymd)
  })

  // All-day events per day
  const allDayByDay = {}
  days.forEach(d => {
    const ymd = dateToYMD(d)
    allDayByDay[ymd] = byDay[ymd].filter(e => parseHour(e.time) == null)
  })
  const hasAnyAllDay = days.some(d => allDayByDay[dateToYMD(d)].length > 0)

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ minWidth: '480px' }}>
        {/* Day headers */}
        <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', borderBottom: '2px solid rgba(160,128,96,0.4)', position: 'sticky', top: '60px', background: 'rgba(36,20,8,0.85)', zIndex: 2 }}>
          <div />
          {days.map(d => {
            const ymd = dateToYMD(d)
            const isTdy = ymd === today
            return (
              <div key={ymd} style={{ textAlign: 'center', padding: '8px 2px', borderLeft: '1px solid rgba(160,128,96,0.2)' }}>
                <p style={{ fontFamily: 'monospace', fontSize: '9px', color: isTdy ? '#d4b870' : '#a08060', textTransform: 'uppercase', letterSpacing: '0.1em', margin: 0 }}>{DOW[d.getDay()]}</p>
                <p style={{ fontFamily: 'monospace', fontSize: '15px', fontWeight: isTdy ? 700 : 400, color: isTdy ? '#d4b870' : '#ece6d9', margin: '2px 0 0', lineHeight: 1 }}>{d.getDate()}</p>
              </div>
            )
          })}
        </div>

        {/* All-day row */}
        {hasAnyAllDay && (
          <div style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', borderBottom: '1px solid rgba(160,128,96,0.25)', background: 'rgba(36,20,8,0.4)' }}>
            <div style={{ fontFamily: 'monospace', fontSize: '9px', color: '#a08060', textAlign: 'right', paddingRight: '8px', paddingTop: '6px', letterSpacing: '0.08em' }}>All day</div>
            {days.map(d => {
              const ymd = dateToYMD(d)
              return (
                <div key={ymd} style={{ borderLeft: '1px solid rgba(160,128,96,0.2)', padding: '3px 2px', minHeight: '28px' }}>
                  {allDayByDay[ymd].map(ev => <EventPill key={ev.id} ev={ev} compact selected={selectedEv?.id === ev.id} onClick={onSelect} />)}
                </div>
              )
            })}
          </div>
        )}

        {/* Hour rows */}
        {HOURS.map(h => (
          <div key={h} style={{ display: 'grid', gridTemplateColumns: '60px repeat(7, 1fr)', borderBottom: '1px solid rgba(160,128,96,0.15)', minHeight: '48px' }}>
            <div style={{ fontFamily: 'monospace', fontSize: '10px', color: '#a08060', paddingTop: '4px', textAlign: 'right', paddingRight: '8px', letterSpacing: '0.04em' }}>
              {fmtHour(h)}
            </div>
            {days.map(d => {
              const ymd = dateToYMD(d)
              const evts = (byDay[ymd] || []).filter(e => {
                const eh = parseHour(e.time)
                return eh != null && Math.floor(eh) === h
              })
              const isNow = h === new Date().getHours() && ymd === today
              return (
                <div key={ymd} style={{ borderLeft: `1px solid ${isNow ? '#d4b870' : 'rgba(160,128,96,0.2)'}`, padding: '2px 3px', background: isNow ? 'rgba(212,184,112,0.08)' : 'transparent' }}>
                  {evts.map(ev => <EventPill key={ev.id} ev={ev} compact selected={selectedEv?.id === ev.id} onClick={onSelect} />)}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Month view ────────────────────────────────────────────────────────────────
function MonthView({ year, month, events, selectedDay, onDaySelect }) {
  const today = todayYMD()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstDOW    = new Date(year, month, 1).getDay()
  const cells       = [...Array(firstDOW).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  const byDate = {}
  events.forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = []
    byDate[e.date].push(e)
  })

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: '6px' }}>
        {DOW.map(d => (
          <div key={d} style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.08em', textAlign: 'center', color: 'rgb(var(--color-warm-gray))', paddingBottom: '8px' }}>{d}</div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '3px' }}>
        {cells.map((day, i) => {
          if (!day) return <div key={`e-${i}`} style={{ minHeight: '72px' }} />
          const ds       = toYMD(year, month + 1, day)
          const evts     = byDate[ds] || []
          const isToday  = ds === today
          const isSel    = ds === selectedDay
          const isPast   = ds < today

          return (
            <button key={ds} onClick={() => onDaySelect(isSel ? null : ds)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                padding: '8px 6px', minHeight: '72px', gap: '3px',
                background: isSel ? '#d4b870' : 'rgb(var(--color-paper))',
                border: `1px solid ${isSel ? '#d4b870' : isToday ? '#a08060' : 'rgb(var(--color-warm-gray-light))'}`,
                borderRadius: '3px',
                cursor: 'pointer',
                textAlign: 'left', transition: 'background 0.1s',
              }}
            >
              <span style={{ fontFamily: 'monospace', fontSize: '12px', color: isSel ? '#1a1814' : isToday ? '#a08060' : 'rgb(var(--color-ink))', fontWeight: isToday ? 700 : 'normal', opacity: isPast && !isSel ? 0.55 : 1 }}>
                {day}
              </span>
              {evts.slice(0, 2).map((ev, j) => (
                <span key={j} style={{ fontFamily: 'monospace', fontSize: '9px', color: isSel ? '#1a1814' : '#d4b870', background: isSel ? 'rgba(26,24,20,0.15)' : 'rgba(36,20,8,0.78)', padding: '1px 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%', borderRadius: '2px' }}>
                  {ev.title}
                </span>
              ))}
              {evts.length > 2 && (
                <span style={{ fontFamily: 'monospace', fontSize: '9px', color: isSel ? '#1a1814' : '#a08060' }}>+{evts.length - 2} more</span>
              )}
            </button>
          )
        })}
      </div>
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function EventsPage() {
  const { user, profile } = useAuth()
  const navigate          = useNavigate()
  const now               = new Date()

  const [calView,      setCalView]      = useState('month')
  const [viewDate,     setViewDate]     = useState(new Date())
  const [year,         setYear]         = useState(now.getFullYear())
  const [month,        setMonth]        = useState(now.getMonth())
  const [events,       setEvents]       = useState([])
  const [loading,      setLoading]      = useState(true)
  const [selectedDay,  setSelectedDay]  = useState(null)
  const [selectedEv,   setSelectedEv]   = useState(null)
  const [showForm,     setShowForm]     = useState(false)
  const [editingId,    setEditingId]    = useState(null)   // submission id being edited
  const [editIsApproved, setEditIsApproved] = useState(false) // true = request edit on live event
  const [form,         setForm]         = useState(EMPTY_FORM)
  const [flyerFile,     setFlyerFile]     = useState(null)
  const [flyerPreview,  setFlyerPreview]  = useState(null)
  const [flyerUploading, setFlyerUploading] = useState(false)
  const [sent,         setSent]         = useState(false)
  const [busy,         setBusy]         = useState(false)
  const [mySubmissions,setMySubmissions]= useState([])
  const [notifyEvents, setNotifyEvents] = useState(false)

  useEffect(() => {
    getAllEvents().then(setEvents).catch(() => setEvents([])).finally(() => setLoading(false))
  }, [])

  // Load user's own submissions
  useEffect(() => {
    if (user) getMySubmissions(user.uid).then(setMySubmissions).catch(() => {})
  }, [user, sent])

  // Sync notification pref from profile
  useEffect(() => {
    if (profile?.notifyEvents !== undefined) setNotifyEvents(profile.notifyEvents)
  }, [profile?.notifyEvents])

  // ── Navigation helpers ──────────────────────────────────────────────
  function prevPeriod() {
    if (calView === 'today') setViewDate(d => { const n = new Date(d); n.setDate(n.getDate()-1); return n })
    if (calView === 'week')  setViewDate(d => { const n = new Date(d); n.setDate(n.getDate()-7); return n })
    if (calView === 'month') {
      if (month === 0) { setMonth(11); setYear(y => y - 1) }
      else setMonth(m => m - 1)
    }
  }
  function nextPeriod() {
    if (calView === 'today') setViewDate(d => { const n = new Date(d); n.setDate(n.getDate()+1); return n })
    if (calView === 'week')  setViewDate(d => { const n = new Date(d); n.setDate(n.getDate()+7); return n })
    if (calView === 'month') {
      if (month === 11) { setMonth(0); setYear(y => y + 1) }
      else setMonth(m => m + 1)
    }
  }
  function goToday() {
    const n = new Date()
    setViewDate(n)
    setYear(n.getFullYear())
    setMonth(n.getMonth())
  }

  // ── Period label ─────────────────────────────────────────────────────
  function periodLabel() {
    if (calView === 'today') {
      const isToday = dateToYMD(viewDate) === todayYMD()
      return isToday
        ? `Today · ${DOW_LONG[viewDate.getDay()]}, ${MONTHS_S[viewDate.getMonth()]} ${viewDate.getDate()}`
        : `${DOW_LONG[viewDate.getDay()]}, ${MONTHS_S[viewDate.getMonth()]} ${viewDate.getDate()}, ${viewDate.getFullYear()}`
    }
    if (calView === 'week') {
      const ws = getWeekStart(viewDate)
      const we = new Date(ws); we.setDate(ws.getDate() + 6)
      if (ws.getMonth() === we.getMonth()) return `${MONTHS[ws.getMonth()]} ${ws.getDate()}–${we.getDate()}, ${ws.getFullYear()}`
      return `${MONTHS_S[ws.getMonth()]} ${ws.getDate()} – ${MONTHS_S[we.getMonth()]} ${we.getDate()}, ${ws.getFullYear()}`
    }
    return `${MONTHS[month]} ${year}`
  }

  function handleChange(e) {
    const { name, type, value, checked } = e.target
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
  }

  async function handleFlyerFile(e) {
    const file = e.target.files[0]; if (!file) return
    setFlyerFile(file)
    setFlyerPreview(URL.createObjectURL(file))
    e.target.value = ''
    setFlyerUploading(true)
    try {
      const snap = await uploadBytes(storageRef(storage, `event-flyers/${Date.now()}_${file.name}`), file)
      const url  = await getDownloadURL(snap.ref)
      setForm(f => ({ ...f, flyerURL: url }))
    } finally { setFlyerUploading(false) }
  }

  function clearFlyer() {
    setFlyerFile(null); setFlyerPreview(null); setForm(f => ({ ...f, flyerURL: '' }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!user) return
    setBusy(true)
    try {
      if (editingId && editIsApproved) {
        await requestEventEdit(editingId, form)
      } else if (editingId) {
        await updateSubmission(editingId, form)
      } else {
        await submitEventRequest(form, user.uid, profile?.name || user.displayName || user.email, user.email)
      }
      // Save notification preference if changed
      if (notifyEvents !== (profile?.notifyEvents || false)) {
        await setEventNotifyPref(user.uid, notifyEvents)
      }
      setForm(EMPTY_FORM); setFlyerFile(null); setFlyerPreview(null)
      setEditingId(null); setEditIsApproved(false); setSent(true); setShowForm(false)
    } finally { setBusy(false) }
  }

  function handleEdit(sub, isApproved = false) {
    setForm({
      title:       sub.title       || '',
      subtitle:    sub.subtitle    || '',
      date:        sub.date        || '',
      startTime:   sub.startTime   || '',
      endTime:     sub.endTime     || '',
      eventType:   sub.eventType   || '',
      location:    sub.location    || '',
      description: sub.description || '',
      entryFee:    sub.entryFee    || '',
      allAges:     sub.allAges     ?? true,
      alcohol:     sub.alcohol     ?? false,
      food:        sub.food        ?? false,
    })
    setEditingId(sub.id)
    setEditIsApproved(isApproved)
    setShowForm(true)
    setSent(false)
  }

  async function handleWithdraw(id) {
    if (!confirm('Withdraw this event submission?')) return
    await withdrawSubmission(id)
    setMySubmissions(s => s.filter(x => x.id !== id))
  }

  async function handleRequestRemoval(sub) {
    if (!confirm('Request removal of this event from the calendar?')) return
    await requestEventRemoval(sub.id, sub.title)
    setMySubmissions(s => s.map(x => x.id === sub.id ? { ...x, status: 'removal_requested' } : x))
  }

  const inp = {
    fontFamily: 'monospace', fontSize: '13px', padding: '10px 12px',
    border: '1px solid #a08060', background: 'rgba(237,232,224,0.6)',
    color: '#1a1814', outline: 'none', width: '100%', boxSizing: 'border-box',
  }

  const lbl = {
    display: 'block', fontFamily: 'monospace', fontSize: '10px',
    letterSpacing: '0.12em', textTransform: 'uppercase', color: '#a08060',
    marginBottom: '6px',
  }

  // Month view selected-day events
  const byDate = {}
  events.forEach(e => { if (!byDate[e.date]) byDate[e.date] = []; byDate[e.date].push(e) })
  const dayEvents = selectedDay ? (byDate[selectedDay] || []) : []

  return (
    <main className="pt-[60px]">
      {/* Header */}
      <section className="max-w-4xl mx-auto px-6 pt-16 pb-10 border-b border-warm-gray-light">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap' }}>
          <div>
            <p className="eyebrow mb-4">Community</p>
            <h1 className="font-serif text-[clamp(2rem,6vw,3.5rem)] font-normal leading-tight text-ink mb-3">
              Upcoming Events
            </h1>
            <p className="font-mono text-[12px] tracking-wide" style={{ background: 'rgba(36,20,8,0.78)', color: '#ece6d9', padding: '6px 12px', display: 'inline-block', borderRadius: '6px' }}>
              Local happenings, shows, and cultural moments.
            </p>
          </div>
          <button
            onClick={() => navigate('/events/past')}
            style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgb(var(--color-warm-gray))', background: 'none', border: '1px solid rgb(var(--color-warm-gray-light))', padding: '8px 16px', cursor: 'pointer', whiteSpace: 'nowrap', marginTop: '8px', transition: 'all 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgb(var(--color-warm-gray))'; e.currentTarget.style.color = 'rgb(var(--color-ink))' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgb(var(--color-warm-gray-light))'; e.currentTarget.style.color = 'rgb(var(--color-warm-gray))' }}
          >
            Past Events →
          </button>
        </div>
      </section>

      {/* Calendar */}
      <section className="max-w-4xl mx-auto px-6 py-10">
        {loading ? (
          <div className="py-8 flex justify-center"><Spinner size={20} color="#3d2810" /></div>
        ) : (
          <>
            {/* ── Toolbar ── */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '24px' }}>
              {/* View toggle */}
              <div style={{ display: 'flex', border: '1px solid rgb(var(--color-warm-gray-light))', overflow: 'hidden' }}>
                {['today','week','month'].map((v, i) => (
                  <button key={v} onClick={() => setCalView(v)} style={{
                    fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase',
                    padding: '7px 14px', border: 'none', cursor: 'pointer',
                    borderRight: i < 2 ? '1px solid rgb(var(--color-warm-gray-light))' : 'none',
                    background: calView === v ? 'rgb(var(--color-ink))' : 'rgb(var(--color-paper))',
                    color:      calView === v ? 'rgb(var(--color-cream))' : 'rgb(var(--color-warm-gray))',
                    transition: 'background 0.15s, color 0.15s',
                  }}>
                    {v}
                  </button>
                ))}
              </div>

              {/* Period nav */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button onClick={prevPeriod} style={{ fontFamily: 'monospace', fontSize: '14px', background: 'none', border: 'none', cursor: 'pointer', color: 'rgb(var(--color-warm-gray))', padding: '4px 8px' }}>←</button>
                <p style={{ fontFamily: 'serif', fontSize: '1.1rem', color: 'rgb(var(--color-ink))', minWidth: '180px', textAlign: 'center' }}>
                  {periodLabel()}
                </p>
                <button onClick={nextPeriod} style={{ fontFamily: 'monospace', fontSize: '14px', background: 'none', border: 'none', cursor: 'pointer', color: 'rgb(var(--color-warm-gray))', padding: '4px 8px' }}>→</button>
              </div>

              {/* Today shortcut */}
              <button onClick={goToday} style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.1em', textTransform: 'uppercase', padding: '7px 14px', border: '1px solid rgb(var(--color-warm-gray-light))', background: 'rgb(var(--color-paper))', color: 'rgb(var(--color-warm-gray))', cursor: 'pointer' }}>
                Today
              </button>
            </div>

            {/* ── Views ── */}
            {calView === 'today' && (
              <>
                <DayView date={viewDate} events={events} selectedEv={selectedEv} onSelect={ev => setSelectedEv(prev => prev?.id === ev.id ? null : ev)} />
                <EventDetail ev={selectedEv} onClose={() => setSelectedEv(null)} onViewPage={id => navigate(`/events/${id}`)} />
              </>
            )}

            {calView === 'week' && (
              <>
                <WeekView weekStart={getWeekStart(viewDate)} events={events} selectedEv={selectedEv} onSelect={ev => setSelectedEv(prev => prev?.id === ev.id ? null : ev)} />
                <EventDetail ev={selectedEv} onClose={() => setSelectedEv(null)} onViewPage={id => navigate(`/events/${id}`)} />
              </>
            )}

            {calView === 'month' && (
              <>
                <MonthView year={year} month={month} events={events} selectedDay={selectedDay} onDaySelect={setSelectedDay} />

                {/* Selected day detail */}
                {selectedDay && (
                  <div style={{ marginTop: '28px', background: 'rgba(36,20,8,0.82)', borderRadius: '6px', padding: '20px 22px' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: '18px' }}>
                      <p style={{ fontFamily: 'serif', fontSize: '1.15rem', color: '#f5f0e8' }}>
                        {DOW_LONG[new Date(...selectedDay.split('-').map((v,i) => i===1 ? v-1 : +v)).getDay()]},&nbsp;
                        {MONTHS[parseInt(selectedDay.split('-')[1]) - 1]} {parseInt(selectedDay.split('-')[2])}, {selectedDay.split('-')[0]}
                      </p>
                      <button onClick={() => setSelectedDay(null)} style={{ fontFamily: 'monospace', fontSize: '11px', color: '#d4b870', background: 'none', border: 'none', cursor: 'pointer' }}>
                        ✕ close
                      </button>
                    </div>
                    {dayEvents.length === 0 ? (
                      <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#a08060' }}>No events on this day.</p>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                        {dayEvents.map(ev => (
                          <div key={ev.id} style={{ display: 'flex', gap: '16px', alignItems: 'flex-start' }}>
                            {ev.flyerURL && <img src={ev.flyerURL} alt="flyer" style={{ width: '96px', height: '96px', objectFit: 'cover', flexShrink: 0, border: '1px solid rgba(212,184,112,0.3)', borderRadius: '3px' }} />}
                            <div style={{ borderLeft: '2px solid #d4b870', paddingLeft: '16px', flex: 1, minWidth: 0 }}>
                              <button onClick={() => navigate(`/events/${ev.id}`)} style={{ fontFamily: 'serif', fontSize: '1.1rem', color: '#f5f0e8', marginBottom: '2px', lineHeight: 1.3, background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'left', textDecoration: 'underline', textDecorationColor: 'rgba(212,184,112,0.4)', textUnderlineOffset: '3px' }}>
                                {ev.title}
                              </button>
                              {ev.subtitle && <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#d4b870', marginBottom: '4px', opacity: 0.85 }}>{ev.subtitle}</p>}
                              {(ev.startTime || ev.time) && <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#d4b870' }}>{ev.startTime || ev.time}{ev.endTime ? ` – ${ev.endTime}` : ''}</p>}
                              {ev.location && <p style={{ fontFamily: 'monospace', fontSize: '11px', color: '#d4b870', letterSpacing: '0.08em', textTransform: 'uppercase', marginTop: '2px' }}>{ev.location}</p>}
                              {ev.description && <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#ece6d9', marginTop: '8px', lineHeight: 1.6 }}>{ev.description}</p>}
                              <button
                                onClick={() => navigate(`/events/${ev.id}`)}
                                style={{ marginTop: '10px', fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.08em', color: '#d4b870', background: 'none', border: '1px solid rgba(212,184,112,0.4)', padding: '4px 10px', cursor: 'pointer', borderRadius: '2px' }}
                              >
                                Event Page →
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </section>

      {/* Submit section */}
      <section className="max-w-4xl mx-auto px-6 pb-20 border-t border-warm-gray-light pt-12">

        {/* Not signed in */}
        {!user ? (
          <>
            <p className="font-serif text-[1.1rem] mb-3">Have an event to share?</p>
            <p className="font-mono text-[12px] text-warm-gray mb-6">Sign in to submit events and manage your listings. Free.</p>
            <button onClick={() => navigate('/login', { state: { from: '/events' } })} className="btn-outline">Sign in to Submit</button>
          </>
        ) : showForm ? (
          /* ── Submission form ── */
          <form onSubmit={handleSubmit} style={{ maxWidth: '520px' }}>
            <p className="font-serif text-[1.2rem] font-normal mb-1">
              {editingId && editIsApproved ? 'Request Event Edit' : editingId ? 'Edit Submission' : 'Submit an Event'}
            </p>
            {editingId && editIsApproved && (
              <p className="font-mono text-[11px] mb-3 leading-relaxed" style={{ background: 'rgba(106,106,175,0.08)', border: '1px solid rgba(106,106,175,0.25)', padding: '8px 12px', color: '#4a4a8a' }}>
                Changes will be sent to Art Saturated for review before updating the live calendar.
              </p>
            )}
            <p className="font-mono text-[12px] text-warm-gray mb-8">
              Submitting as <strong className="text-ink">{profile?.name || user.email}</strong>
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

              {/* Title */}
              <div>
                <label style={lbl}>Event Title * (shown on calendar)</label>
                <input type="text" name="title" value={form.title} onChange={handleChange} required style={inp} placeholder="e.g. Open Mic Night" />
              </div>

              {/* Subtitle */}
              <div>
                <label style={lbl}>Subtitle / Tagline (optional)</label>
                <input type="text" name="subtitle" value={form.subtitle} onChange={handleChange} style={inp} placeholder="e.g. Hosted by Zionomari · All genres welcome" />
              </div>

              {/* Date + Event Type */}
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '140px' }}>
                  <label style={lbl}>Date *</label>
                  <input type="date" name="date" value={form.date} onChange={handleChange} required style={inp} />
                </div>
                <div style={{ flex: 1, minWidth: '140px' }}>
                  <label style={lbl}>Event Type</label>
                  <select name="eventType" value={form.eventType} onChange={handleChange} style={inp}>
                    <option value="">Select type…</option>
                    {EVENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              {/* Start + End time */}
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '160px' }}>
                  <label style={lbl}>Start Time</label>
                  <TimeInput
                    value={form.startTime}
                    onChange={v => setForm(f => ({ ...f, startTime: v }))}
                    inputStyle={inp}
                  />
                </div>
                <div style={{ flex: 1, minWidth: '160px' }}>
                  <label style={lbl}>End Time</label>
                  <TimeInput
                    value={form.endTime}
                    onChange={v => setForm(f => ({ ...f, endTime: v }))}
                    placeholder="10:00"
                    inputStyle={inp}
                  />
                </div>
              </div>

              {/* Location + Entry fee */}
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ flex: 2, minWidth: '160px' }}>
                  <label style={lbl}>Location</label>
                  <input type="text" name="location" value={form.location} onChange={handleChange} style={inp} placeholder="Address or venue name" />
                </div>
                <div style={{ flex: 1, minWidth: '100px' }}>
                  <label style={lbl}>Entry Fee</label>
                  <input type="text" name="entryFee" value={form.entryFee} onChange={handleChange} style={inp} placeholder="Free / $5 / Donation" />
                </div>
              </div>

              {/* Flyer image */}
              <div>
                <label style={lbl}>Flyer Image (optional)</label>
                {(flyerPreview || form.flyerURL) && (
                  <div style={{ position: 'relative', marginBottom: '10px', maxWidth: '300px' }}>
                    <img
                      src={flyerPreview || form.flyerURL}
                      alt="Flyer preview"
                      style={{ width: '100%', maxHeight: '220px', objectFit: 'cover', border: '1px solid #a08060', display: 'block' }}
                    />
                    {flyerUploading && (
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#3d2810' }}>Uploading…</span>
                      </div>
                    )}
                    <button type="button" onClick={clearFlyer}
                      style={{ position: 'absolute', top: '6px', right: '6px', background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer', fontFamily: 'monospace', fontSize: '11px', padding: '3px 7px' }}>
                      ✕
                    </button>
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <label style={{ display: 'inline-block', cursor: 'pointer' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: '11px', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '8px 16px', border: '1px solid #a08060', background: 'transparent', color: '#3d2810', display: 'inline-block' }}>
                      {flyerFile ? '↺ Replace Image' : '↑ Upload Flyer'}
                    </span>
                    <input type="file" accept="image/*" onChange={handleFlyerFile} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
                  </label>
                  {!flyerPreview && (
                    <input
                      type="url"
                      placeholder="…or paste an image URL"
                      value={form.flyerURL || ''}
                      onChange={e => setForm(f => ({ ...f, flyerURL: e.target.value }))}
                      style={{ ...inp, fontSize: '12px', color: '#8a5c3a' }}
                    />
                  )}
                </div>
              </div>

              {/* Description */}
              <div>
                <label style={lbl}>Description</label>
                <textarea name="description" value={form.description} onChange={handleChange} rows={4} style={{ ...inp, resize: 'vertical', minHeight: '90px' }} />
              </div>

              {/* Checkboxes */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', paddingTop: '4px' }}>
                {[
                  { name: 'allAges', label: 'All ages welcome' },
                  { name: 'alcohol', label: 'Alcohol served' },
                  { name: 'food',    label: 'Food available' },
                ].map(({ name, label }) => (
                  <label key={name} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontFamily: 'monospace', fontSize: '12px', color: '#1a1814', cursor: 'pointer' }}>
                    <input type="checkbox" name={name} checked={form[name]} onChange={handleChange} style={{ accentColor: '#1a1814', cursor: 'pointer' }} />
                    {label}
                  </label>
                ))}
              </div>

              {/* Notify opt-in */}
              <div style={{ borderTop: '1px solid #a08060', paddingTop: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', fontFamily: 'monospace', fontSize: '11px', color: '#1a1814', cursor: 'pointer', lineHeight: 1.6 }}>
                  <input type="checkbox" checked={notifyEvents} onChange={e => setNotifyEvents(e.target.checked)} style={{ marginTop: '2px', accentColor: '#1a1814', cursor: 'pointer', flexShrink: 0 }} />
                  Notify me by email when new events are added to the calendar
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button type="submit" disabled={busy || flyerUploading} className="btn-outline" style={{ opacity: (busy || flyerUploading) ? 0.5 : 1 }}>
                {flyerUploading ? <span className="flex items-center justify-center gap-2"><Spinner />Uploading flyer…</span> : busy ? <span className="flex items-center justify-center gap-2"><Spinner />Sending…</span> : editingId && editIsApproved ? 'Send Edit Request' : editingId ? 'Save Changes' : 'Submit'}
              </button>
              <button type="button"
                onClick={() => { setShowForm(false); setForm(EMPTY_FORM); setEditingId(null); setEditIsApproved(false); setFlyerFile(null); setFlyerPreview(null) }}
                className="font-mono text-[12px] text-warm-gray hover:text-ink transition-colors">
                Cancel
              </button>
            </div>
          </form>

        ) : (
          /* ── Landing: submit CTA + my submissions ── */
          <>
            {sent && (
              <div style={{ marginBottom: '24px', background: 'rgba(36,20,8,0.78)', color: '#ece6d9', padding: '12px 16px', borderRadius: '6px', display: 'inline-block' }}>
                <p className="font-mono text-[12px]">
                  {editingId ? 'Changes saved.' : 'Submitted.'} We'll review it and add it to the calendar.
                </p>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: mySubmissions.length > 0 ? '32px' : '0' }}>
              <div>
                <p className="font-serif text-[1.1rem] mb-1">Have an event to share?</p>
                <p className="font-mono text-[12px] text-warm-gray">Submit for review — free for all account holders.</p>
              </div>
              <button onClick={() => { setSent(false); setShowForm(true) }} className="btn-outline">Submit an Event</button>
            </div>

            {/* My submissions */}
            {mySubmissions.length > 0 && (
              <div>
                <p style={{ fontFamily: 'monospace', fontSize: '10px', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#a08060', marginBottom: '12px' }}>Your Submissions</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {mySubmissions.map(sub => (
                    <div key={sub.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', padding: '12px 14px', border: '1px solid #a08060', background: 'rgba(245,240,232,0.6)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontFamily: 'monospace', fontSize: '12px', color: '#1a1814', marginBottom: '2px' }}>{sub.title}</p>
                        <p style={{ fontFamily: 'monospace', fontSize: '10px', color: '#a08060' }}>
                          {sub.date}{sub.startTime ? ` · ${sub.startTime}` : ''}{sub.eventType ? ` · ${sub.eventType}` : ''}
                        </p>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                        {/* Status badge */}
                        <span style={{
                          fontFamily: 'monospace', fontSize: '9px', letterSpacing: '0.1em', textTransform: 'uppercase',
                          padding: '3px 8px',
                          background: sub.status === 'approved' ? 'rgba(36,20,8,0.78)' : sub.status === 'denied' ? 'rgba(180,60,60,0.12)' : sub.status === 'edit_requested' ? 'rgba(106,106,175,0.12)' : sub.status === 'removal_requested' ? 'rgba(160,100,40,0.15)' : 'rgba(160,128,96,0.15)',
                          color: sub.status === 'approved' ? '#d4b870' : sub.status === 'denied' ? '#c05050' : sub.status === 'edit_requested' ? '#5a5a9a' : '#a08060',
                          borderRadius: '3px',
                        }}>
                          {sub.status === 'removal_requested' ? 'Removal Requested' : sub.status === 'edit_requested' ? 'Edit Pending Review' : sub.status}
                        </span>
                        {/* Actions */}
                        {sub.status === 'pending' && (
                          <>
                            <button onClick={() => handleEdit(sub, false)} style={{ fontFamily: 'monospace', fontSize: '10px', color: '#1a1814', background: 'none', border: '1px solid #a08060', padding: '4px 10px', cursor: 'pointer' }}>Edit</button>
                            <button onClick={() => handleWithdraw(sub.id)} style={{ fontFamily: 'monospace', fontSize: '10px', color: '#c05050', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>Withdraw</button>
                          </>
                        )}
                        {(sub.status === 'approved' || sub.status === 'edit_requested') && sub.eventId && (
                          <button onClick={() => navigate(`/events/${sub.eventId}`)} style={{ fontFamily: 'monospace', fontSize: '10px', color: '#1a1814', background: 'none', border: '1px solid #a08060', padding: '4px 10px', cursor: 'pointer' }}>View Page</button>
                        )}
                        {sub.status === 'approved' && (
                          <>
                            <button onClick={() => handleEdit(sub, true)} style={{ fontFamily: 'monospace', fontSize: '10px', color: '#1a1814', background: 'none', border: '1px solid #a08060', padding: '4px 10px', cursor: 'pointer' }}>Request Edit</button>
                            <button onClick={() => handleRequestRemoval(sub)} style={{ fontFamily: 'monospace', fontSize: '10px', color: '#c05050', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0' }}>Remove</button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>

      <Footer />
    </main>
  )
}
