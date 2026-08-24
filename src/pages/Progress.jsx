import React, { useEffect, useState } from 'react'
import { Clock, Activity, Award, Target } from 'lucide-react'
import { api } from '../api.js'
import { Card, Bar, Kpi, Spinner, levelColor } from '../components.jsx'

function BarChart({ data }) {
  const max = Math.max(1, ...data.map((d) => d.v))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 140 }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div className="faint small mono">{d.v || ''}</div>
          <div
            style={{ width: '100%', maxWidth: 26, height: Math.max(2, (d.v / max) * 100), background: d.v ? 'var(--grad)' : 'var(--surface-3)', borderRadius: '4px 4px 0 0', transition: 'height 0.4s' }}
            title={`${d.label}: ${d.v} min`}
          />
          <div className="faint" style={{ fontSize: 10 }}>{d.label}</div>
        </div>
      ))}
    </div>
  )
}

export default function Progress() {
  const [sessions, setSessions] = useState(null)
  const [skills, setSkills] = useState(null)
  const [goals, setGoals] = useState(null)

  useEffect(() => {
    api.sessions().then(setSessions)
    api.skills().then(setSkills)
    api.goals().then(setGoals)
  }, [])

  if (!sessions || !skills || !goals) return <Spinner />

  // last 14 days activity
  const days = []
  const byDay = {}
  for (const s of sessions) byDay[s.date] = (byDay[s.date] || 0) + (s.duration || 0)
  for (let i = 13; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    days.push({ label: d.toLocaleDateString('en', { weekday: 'short' }), v: byDay[key] || 0 })
  }

  const totalMin = sessions.reduce((a, s) => a + (s.duration || 0), 0)
  const avgConf = sessions.length ? (sessions.reduce((a, s) => a + (s.confidence || 0), 0) / sessions.length).toFixed(1) : '—'
  const avgMastery = Math.round(skills.reduce((a, s) => a + s.current_mastery, 0) / skills.length)
  const activeGoals = goals.filter((g) => g.status === 'active').length

  return (
    <div>
      <div className="grid cols-4 mb">
        <Kpi icon={<Clock size={18} />} value={Math.round((totalMin / 60) * 10) / 10} unit="hrs" label="Total learning time" />
        <Kpi icon={<Activity size={18} />} value={avgConf} unit="/5" label="Avg confidence" />
        <Kpi icon={<Award size={18} />} value={avgMastery} unit="%" label="Avg mastery" />
        <Kpi icon={<Target size={18} />} value={activeGoals} label="Active goals" />
      </div>

      <div className="grid cols-2 mb" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
        <Card title="Activity" sub="Minutes per day — last 14 days">
          <BarChart data={days} />
        </Card>
        <Card title="Goals" sub="Progress toward mastery">
          {goals.map((g) => (
            <div key={g.id} className="mb">
              <div className="flex-between small" style={{ marginBottom: 5 }}>
                <span style={{ fontWeight: 600 }}>{g.name}</span>
                <span className="mono faint">{Math.round(g.progress)}%</span>
              </div>
              <Bar value={g.progress} />
            </div>
          ))}
        </Card>
      </div>

      <div className="grid cols-2">
        <Card title="Skill mastery" sub="Weighted across lessons, assessments, projects & confidence">
          {skills.map((s) => (
            <div key={s.id} className="flex" style={{ padding: '7px 0', gap: 12 }}>
              <span className="small" style={{ width: 140, fontWeight: 600 }}>{s.name}</span>
              <Bar value={s.current_mastery} thin />
              <span className="mono small faint" style={{ width: 36, textAlign: 'right' }}>{Math.round(s.current_mastery)}%</span>
            </div>
          ))}
        </Card>
        <Card title="Recent sessions" sub="Your latest learning activity">
          {sessions.slice(0, 10).map((s) => (
            <div key={s.id} className="flex-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div className="small" style={{ fontWeight: 600 }}>{s.topic_name || 'Learning session'}</div>
                <div className="faint" style={{ fontSize: 11 }}>{s.date} · {s.kind}</div>
              </div>
              <div className="flex" style={{ gap: 12 }}>
                <span className="small faint">★ {s.confidence || '—'}/5</span>
                <span className="mono small faint">{s.duration}m</span>
              </div>
            </div>
          ))}
          {sessions.length === 0 && <div className="muted small">No sessions yet.</div>}
        </Card>
      </div>
    </div>
  )
}
