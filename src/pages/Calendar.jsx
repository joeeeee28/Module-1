import React, { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../api.js'
import { Spinner } from '../components.jsx'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function monthKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function pad(n) { return String(n).padStart(2, '0') }

export default function CalendarPage() {
  const today = new Date()
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1))
  const [events, setEvents] = useState(null)

  const mk = monthKey(cursor)
  useEffect(() => {
    setEvents(null)
    api.calendar(mk).then(setEvents)
  }, [mk])

  const byDate = {}
  for (const e of events || []) {
    if (!byDate[e.date]) byDate[e.date] = []
    byDate[e.date].push(e)
  }

  const year = cursor.getFullYear()
  const month = cursor.getMonth()
  const firstDow = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrev = new Date(year, month, 0).getDate()

  const cells = []
  for (let i = firstDow - 1; i >= 0; i--) cells.push({ d: new Date(year, month - 1, daysInPrev - i), out: true })
  for (let d = 1; d <= daysInMonth; d++) cells.push({ d: new Date(year, month, d), out: false })
  while (cells.length % 7 !== 0) cells.push({ d: new Date(year, month + 1, cells.length - daysInMonth - firstDow + 1), out: true })

  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
  const shift = (n) => setCursor(new Date(year, month + n, 1))

  return (
    <div>
      <div className="flex-between mb">
        <div>
          <h2 className="section-title">{cursor.toLocaleString('en', { month: 'long', year: 'numeric' })}</h2>
          <p className="muted small" style={{ margin: '-8px 0 0' }}>Sessions, deadlines, assessments & revision.</p>
        </div>
        <div className="flex">
          <button className="btn icon" onClick={() => shift(-1)}><ChevronLeft size={16} /></button>
          <button className="btn" onClick={() => setCursor(new Date(today.getFullYear(), today.getMonth(), 1))}>Today</button>
          <button className="btn icon" onClick={() => shift(1)}><ChevronRight size={16} /></button>
        </div>
      </div>

      <div className="legend mb">
        <span><i style={{ background: 'rgba(99,102,241,0.6)' }} /> Learning session</span>
        <span><i style={{ background: 'rgba(248,113,113,0.7)' }} /> Deadline</span>
        <span><i style={{ background: 'rgba(251,191,36,0.7)' }} /> Revision</span>
        <span><i style={{ background: 'rgba(248,113,113,0.4)' }} /> Missed</span>
      </div>

      {!events ? (
        <Spinner />
      ) : (
        <div className="cal">
          {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
          {cells.map((c, i) => {
            const key = `${c.d.getFullYear()}-${pad(c.d.getMonth() + 1)}-${pad(c.d.getDate())}`
            const evs = byDate[key] || []
            return (
              <div key={i} className={`cell ${c.out ? 'out' : ''} ${key === todayKey ? 'today' : ''}`}>
                <div className="num">{c.d.getDate()}</div>
                {evs.slice(0, 3).map((e, j) => (
                  <div key={j} className={`ev ${e.type}`} title={e.title}>{e.title}</div>
                ))}
                {evs.length > 3 && <div className="faint small">+{evs.length - 3} more</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
