import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getSlots, getBookings, cancelBooking, isShopHour, loadShopHours,
         blockTime, unblockTime, getBlockedTimesForDate,
         DEFAULT_AVAIL_START, DEFAULT_AVAIL_END,
       } from '../data/booking'
import { getTasksForRange, TASK_TYPES } from '../data/tasks'
import ScheduleManager from './ScheduleManager'
import DailyPlanner from './DailyPlanner'

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December']

// All slots in the default availability window (8 AM – midnight), every 30 min
const ALL_SLOTS = Array.from({ length: DEFAULT_AVAIL_END - DEFAULT_AVAIL_START }, (_, i) => {
  const h = DEFAULT_AVAIL_START + i
  return [`${String(h).padStart(2,'0')}:00`, `${String(h).padStart(2,'0')}:30`]
}).flat()

function fmtTime(t) {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hr   = h % 12 || 12
  return `${hr}:${m.toString().padStart(2, '0')} ${ampm}`
}

function daysInMonth(year, month) { return new Date(year, month + 1, 0).getDate() }
function startDayOfMonth(year, month) { return new Date(year, month, 1).getDay() }

const SERVICE_LABELS = {
  'consultation': 'Creative Consultation',
  'piano':        'Piano',
  'beat-making':  'Beat Making',
  'dance':        'Dance',
}

export default function AvailabilityManager() {
  const today = new Date()
  const [searchParams, setSearchParams] = useSearchParams()
  const [year, setYear]         = useState(today.getFullYear())
  const [month, setMonth]       = useState(today.getMonth())
  const [selectedDate, setSelectedDate] = useState(null)
  const [slots, setSlots]             = useState([])
  const [bookings, setBookings]       = useState([])
  const [blockedTimes, setBlockedTimes] = useState([])  // blocked times for selectedDate
  const [loading, setLoading]         = useState(true)
  const [shopConfig, setShopConfig]   = useState(null)
  // taskDots: { [dateStr]: string[] } — array of dot colors per day
  const [taskDots, setTaskDots] = useState({})

  const subview = searchParams.get('sub') || 'calendar'
  function setSubview(v) { setSearchParams(p => { const n = new URLSearchParams(p); n.set('sub', v); return n }, { replace: true }) }

  async function refresh() {
    try {
      const [s, b, cfg] = await Promise.all([getSlots(), getBookings(), loadShopHours()])
      setSlots(s); setBookings(b); setShopConfig(cfg)
    } catch (err) {
      console.error('Availability load error:', err)
    } finally {
      setLoading(false)
    }
  }

  async function refreshBlocked(date) {
    if (!date) return
    try {
      const bt = await getBlockedTimesForDate(date)
      setBlockedTimes(bt)
    } catch (e) { console.error(e) }
  }

  async function refreshTaskDots() {
    const y = year, m = month
    const start = `${y}-${String(m+1).padStart(2,'0')}-01`
    const end   = `${y}-${String(m+1).padStart(2,'0')}-${String(daysInMonth(y,m)).padStart(2,'0')}`
    try {
      const tasks = await getTasksForRange(start, end)
      const dots = {}
      for (const t of tasks) {
        if (!dots[t.date]) dots[t.date] = []
        const color = TASK_TYPES[t.type]?.dot || '#8a5c3a'
        if (!dots[t.date].includes(color)) dots[t.date].push(color)
      }
      setTaskDots(dots)
    } catch (e) { console.error(e) }
  }

  useEffect(() => { refresh() }, [])
  useEffect(() => { refreshTaskDots() }, [year, month])
  useEffect(() => { refreshBlocked(selectedDate) }, [selectedDate])

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) } else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) } else setMonth(m => m + 1)
  }

  function dateStr(day) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  function slotsForDate(ds) {
    return slots.filter(s => s.date === ds).sort((a, b) => a.time.localeCompare(b.time))
  }

  const withSlots = new Set(slots.map(s => s.date))
  const totalDays = daysInMonth(year, month)
  const startDay  = startDayOfMonth(year, month)

  async function handleBlockTime(time) {
    await blockTime(selectedDate, time)
    refreshBlocked(selectedDate)
  }

  async function handleUnblockTime(id) {
    await unblockTime(id)
    refreshBlocked(selectedDate)
  }

  async function handleCancelBooking(booking) {
    if (!window.confirm(`Cancel booking for ${booking.name}?`)) return
    await cancelBooking(booking.id, booking.slotId)
    refresh()
  }

  const activeBookings = bookings.filter(b => b.status !== 'cancelled')

  return (
    <div className="flex flex-col gap-5">

      {/* Sub-nav */}
      <div className="flex gap-0 border border-warm-gray-light">
        {['calendar', 'bookings', 'schedule'].map(v => (
          <button key={v} onClick={() => setSubview(v)}
            className={`flex-1 py-2 font-mono text-[10px] uppercase tracking-widest transition-colors ${subview === v ? 'bg-ink text-cream' : 'text-warm-gray'}`}>
            {v === 'bookings' ? `Bookings (${activeBookings.length})` : v === 'schedule' ? 'Schedule' : 'Availability'}
          </button>
        ))}
      </div>

      {loading && <p className="font-mono text-[12px] text-warm-gray">Loading...</p>}

      {/* ── CALENDAR ──────────────────────────────────────────────────────── */}
      {!loading && subview === 'calendar' && !selectedDate && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="font-mono text-[11px] text-warm-gray uppercase tracking-widest">← Prev</button>
            <span className="font-serif text-[1rem]">{MONTH_NAMES[month]} {year}</span>
            <button onClick={nextMonth} className="font-mono text-[11px] text-warm-gray uppercase tracking-widest">Next →</button>
          </div>

          <div className="grid grid-cols-7 mb-1">
            {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
              <div key={d} className="text-center font-mono text-[9px] text-warm-gray uppercase tracking-widest py-1">{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: startDay }).map((_, i) => <div key={`b${i}`} />)}
            {Array.from({ length: totalDays }, (_, i) => i + 1).map(day => {
              const ds       = dateStr(day)
              const hasSlot  = withSlots.has(ds)
              const dots     = taskDots[ds] || []
              return (
                <button key={day} onClick={() => setSelectedDate(ds)}
                  className={`aspect-square flex flex-col items-center justify-center font-mono text-[12px] transition-colors border relative
                    ${hasSlot ? 'border-ink bg-ink text-cream' : 'border-warm-gray-light text-ink hover:border-ink'}`}>
                  {day}
                  {/* Task type dots */}
                  {dots.length > 0 && (
                    <div style={{ display: 'flex', gap: '2px', position: 'absolute', bottom: '3px', justifyContent: 'center' }}>
                      {dots.slice(0,4).map((c, i) => (
                        <div key={i} style={{ width: '4px', height: '4px', borderRadius: '50%', background: hasSlot ? '#fff' : c }} />
                      ))}
                    </div>
                  )}
                </button>
              )
            })}
          </div>

          {/* Legend */}
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '12px' }}>
            <span className="font-mono text-[9px] text-warm-gray flex items-center gap-1">
              <span style={{ display: 'inline-block', width: '10px', height: '10px', background: '#1a1208' }} /> Booking slots
            </span>
            {Object.entries(TASK_TYPES).map(([k, v]) => (
              <span key={k} className="font-mono text-[9px] flex items-center gap-1" style={{ color: v.color }}>
                <span style={{ display: 'inline-block', width: '7px', height: '7px', borderRadius: '50%', background: v.dot }} /> {v.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── DAY VIEW: slots + daily planner ───────────────────────────────── */}
      {!loading && subview === 'calendar' && selectedDate && (
        <div className="flex flex-col gap-5">
          <button onClick={() => setSelectedDate(null)} className="font-mono text-[11px] text-warm-gray uppercase tracking-widest self-start">← Back</button>
          <h2 className="font-serif text-[1rem]">
            {new Date(...selectedDate.split('-').map((v,i) => i===1 ? v-1 : +v))
              .toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' })}
          </h2>

          {/* Availability grid — 8 AM to midnight */}
          <div className="flex flex-col gap-2">
            <p className="eyebrow">Availability (8 AM – Midnight)</p>
            <div className="grid grid-cols-4 gap-2">
              {(() => {
                const bookedTimes  = new Set(slotsForDate(selectedDate).filter(s => s.booked).map(s => s.time))
                const blockedSet   = new Set(blockedTimes.map(b => b.time))
                const blockedById  = Object.fromEntries(blockedTimes.map(b => [b.time, b.id]))
                return ALL_SLOTS.map(t => {
                  const isShop    = isShopHour(selectedDate, t, shopConfig)
                  const isBooked  = bookedTimes.has(t)
                  const isBlocked = blockedSet.has(t)

                  if (isShop) return (
                    <div key={t} className="border py-2 font-mono text-[11px] text-center select-none flex flex-col items-center gap-[2px]"
                      style={{ borderColor: 'rgba(185,122,32,0.3)', color: '#b97a20', background: 'rgba(185,122,32,0.06)' }}>
                      {fmtTime(t)}
                      <span style={{ fontSize: '8px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>shop</span>
                    </div>
                  )

                  if (isBooked) return (
                    <div key={t} className="border border-ink bg-ink text-cream py-2 font-mono text-[11px] text-center flex flex-col items-center gap-[2px]">
                      {fmtTime(t)}
                      <span style={{ fontSize: '8px', letterSpacing: '0.06em', textTransform: 'uppercase', opacity: 0.6 }}>booked</span>
                    </div>
                  )

                  if (isBlocked) return (
                    <button key={t} onClick={() => handleUnblockTime(blockedById[t])}
                      className="border py-2 font-mono text-[11px] text-center flex flex-col items-center gap-[2px] transition-colors"
                      style={{ borderColor: '#7a2020', background: 'rgba(122,32,32,0.08)', color: '#7a2020' }}
                      title="Click to unblock">
                      {fmtTime(t)}
                      <span style={{ fontSize: '8px', letterSpacing: '0.06em', textTransform: 'uppercase' }}>blocked</span>
                    </button>
                  )

                  return (
                    <button key={t} onClick={() => handleBlockTime(t)}
                      className="border border-warm-gray-light py-2 font-mono text-[11px] text-center flex flex-col items-center gap-[2px] transition-colors hover:border-red-400 hover:text-red-400 group"
                      title="Click to block">
                      {fmtTime(t)}
                      <span style={{ fontSize: '8px', letterSpacing: '0.06em', textTransform: 'uppercase' }} className="text-warm-gray/40 group-hover:text-red-400">avail</span>
                    </button>
                  )
                })
              })()}
            </div>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginTop: '4px' }}>
              <span className="font-mono text-[9px] flex items-center gap-1" style={{ color: '#b97a20' }}>■ Shop hours</span>
              <span className="font-mono text-[9px] flex items-center gap-1 text-ink">■ Booked</span>
              <span className="font-mono text-[9px] flex items-center gap-1" style={{ color: '#7a2020' }}>■ Blocked — click to unblock</span>
              <span className="font-mono text-[9px] flex items-center gap-1 text-warm-gray">■ Available — click to block</span>
            </div>
          </div>

          {/* Divider */}
          <div style={{ borderTop: '1px solid #ece6dc' }} />

          {/* Daily Planner */}
          <DailyPlanner date={selectedDate} onTaskChange={refreshTaskDots} />
        </div>
      )}

      {/* ── SCHEDULE MANAGER ──────────────────────────────────────────────── */}
      {subview === 'schedule' && <ScheduleManager />}

      {/* ── BOOKINGS LIST ─────────────────────────────────────────────────── */}
      {!loading && subview === 'bookings' && (
        <div className="flex flex-col gap-3">
          {activeBookings.length === 0
            ? <p className="font-mono text-[13px] text-warm-gray text-center py-8">No bookings yet.</p>
            : activeBookings.map(b => (
              <div key={b.id} className="border border-warm-gray-light p-4 flex flex-col gap-1">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[13px] text-ink">{b.name}</span>
                  <span className="font-mono text-[11px] text-warm-gray">
                    {new Date(...b.date.split('-').map((v,i) => i===1?v-1:+v))
                      .toLocaleDateString('en-US',{month:'short',day:'numeric'})} · {fmtTime(b.time)}
                  </span>
                </div>
                <p className="font-mono text-[11px] text-warm-gray">{SERVICE_LABELS[b.service] || b.service}</p>
                <p className="font-mono text-[11px] text-warm-gray">{b.email}{b.phone ? ` · ${b.phone}` : ''}</p>
                {b.message && <p className="font-mono text-[11px] text-ink/60 mt-1 italic">"{b.message}"</p>}
                <button onClick={() => handleCancelBooking(b)}
                  className="font-mono text-[10px] uppercase tracking-widest text-red-400 self-start mt-1">
                  Cancel booking
                </button>
              </div>
            ))
          }
        </div>
      )}
    </div>
  )
}
