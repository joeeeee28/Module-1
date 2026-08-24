import React, { useEffect, useState } from 'react'
import { Save, User, Bell, Sparkle } from 'lucide-react'
import { api } from '../api.js'
import { Card, Spinner } from '../components.jsx'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TIMEZONES = ['UTC', 'Asia/Kolkata', 'America/New_York', 'America/Los_Angeles', 'America/Chicago', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Asia/Singapore', 'Asia/Tokyo', 'Asia/Dubai', 'Australia/Sydney', 'Pacific/Auckland']

export default function SettingsPage() {
  const [user, setUser] = useState(null)
  const [settings, setSettings] = useState(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.user().then(setUser)
    api.settings().then(setSettings)
  }, [])

  if (!user || !settings) return <Spinner />

  const set = (k) => (e) => setUser({ ...user, [k]: e.target.value })
  const toggleDay = (d) => {
    const days = typeof user.preferred_days === 'string' ? JSON.parse(user.preferred_days) : user.preferred_days || []
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d]
    setUser({ ...user, preferred_days: next })
  }
  const toggleNotif = (k) => setSettings({ ...settings, notifications: { ...settings.notifications, [k]: !settings.notifications[k] } })

  const saveProfile = async () => {
    await api.saveUser(user)
    flash()
  }
  const saveNotif = async () => {
    await api.saveSettings({ notifications: settings.notifications, timezone: user.timezone, channel: settings.channel })
    flash()
  }
  const flash = () => { setSaved(true); setTimeout(() => setSaved(false), 1500) }

  const days = typeof user.preferred_days === 'string' ? JSON.parse(user.preferred_days) : user.preferred_days || []

  return (
    <div className="grid cols-2" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
      <Card title="Profile" sub="Everything here personalizes the AI's plans and briefings" actions={<User size={18} className="faint" />}>
        <div className="row2">
          <div className="field"><label>Name</label><input className="input" value={user.name} onChange={set('name')} /></div>
          <div className="field"><label>Current role</label><input className="input" value={user.role} onChange={set('role')} /></div>
        </div>
        <div className="field"><label>Career goal</label><input className="input" value={user.career_goal} onChange={set('career_goal')} /></div>
        <div className="field"><label>Target role</label><input className="input" value={user.target_role} onChange={set('target_role')} /></div>
        <div className="row2">
          <div className="field"><label>Experience level</label>
            <select className="select" value={user.experience_level} onChange={set('experience_level')}>
              {['Beginner', 'Intermediate', 'Advanced', 'Expert'].map((l) => <option key={l}>{l}</option>)}
            </select>
          </div>
          <div className="field"><label>Daily learning time (minutes)</label>
            <input className="input" type="number" value={user.daily_learning_minutes} onChange={set('daily_learning_minutes')} min={10} />
          </div>
        </div>
        <div className="field"><label>Learning style</label>
          <select className="select" value={user.learning_style} onChange={set('learning_style')}>
            {['Hands-on / project-based', 'Video courses', 'Reading / documentation', 'Practice-driven', 'Mentorship / pairing'].map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Preferred learning days</label>
          <div className="flex" style={{ gap: 6, flexWrap: 'wrap' }}>
            {DAYS.map((d) => (
              <button key={d} className="btn sm" style={{ background: days.includes(d) ? 'var(--surface-2)' : 'transparent', color: days.includes(d) ? '#fff' : 'var(--text-muted)' }} onClick={() => toggleDay(d)}>{d}</button>
            ))}
          </div>
        </div>
        <div className="row2">
          <div className="field"><label>Morning briefing time</label><input className="input" type="time" value={user.briefing_time} onChange={set('briefing_time')} /></div>
          <div className="field"><label>Timezone</label>
            <select className="select" value={user.timezone || 'UTC'} onChange={set('timezone')}>
              {TIMEZONES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div className="field"><label>Bio / notes</label><textarea className="textarea" value={user.bio || ''} onChange={set('bio')} /></div>
        <button className="btn primary" onClick={saveProfile}><Save size={15} /> {saved ? 'Saved ✓' : 'Save profile'}</button>
      </Card>

      <div>
        <Card title="Notifications" sub="Choose what the agent sends you, and how" actions={<Bell size={18} className="faint" />}>
          <div className="field">
            <label>Delivery channel</label>
            <select className="select" value={settings.channel || 'in-app'} onChange={(e) => setSettings({ ...settings, channel: e.target.value })}>
              <option value="in-app">In-app only</option>
              <option value="webhook">Webhook (configure WEBHOOK_URL)</option>
              <option value="telegram">Telegram (configure bot)</option>
              <option value="email">Email (configure SMTP)</option>
              <option value="all">All available</option>
            </select>
            <div className="faint" style={{ fontSize: 11, marginTop: 4 }}>
              Delivery status is recorded per message — nothing is marked "sent" unless the channel accepted it.
            </div>
          </div>
          {[
            { k: 'morningBriefing', l: 'Morning briefing', d: 'Daily AI learning plan each morning' },
            { k: 'learningReminder', l: 'Learning reminder', d: "Nudge if today's session hasn't started" },
            { k: 'deadlineReminder', l: 'Deadline reminder', d: 'Upcoming goal deadlines' },
            { k: 'revisionReminder', l: 'Revision reminder', d: 'Topic due for spaced revision' },
            { k: 'weeklyReview', l: 'Weekly review', d: 'Weekly progress summary' },
          ].map((n) => (
            <div key={n.k} className="flex-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
              <div>
                <div className="small" style={{ fontWeight: 600 }}>{n.l}</div>
                <div className="faint" style={{ fontSize: 12 }}>{n.d}</div>
              </div>
              <Toggle on={settings.notifications[n.k]} onClick={() => toggleNotif(n.k)} />
            </div>
          ))}
          <button className="btn primary mt" onClick={saveNotif}><Save size={15} /> Save</button>
        </Card>

        <Card className="mt" title="Automation" sub="How the morning briefing works" actions={<Sparkle size={18} className="faint" />}>
          <div className="small muted" style={{ display: 'grid', gap: 6 }}>
            <span>1. Scheduler triggers the Learning Agent</span>
            <span>2. Reads your profile, goals, roadmap & progress</span>
            <span>3. Evaluates performance & weak areas</span>
            <span>4. Generates a fresh plan from the latest data</span>
            <span>5. Sends your morning briefing</span>
          </div>
          <p className="small faint mt">Your briefing time: <b style={{ color: 'var(--text)' }}>{user.briefing_time}</b> (demo: plan is generated on demand).</p>
        </Card>
      </div>
    </div>
  )
}

function Toggle({ on, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{ width: 44, height: 24, borderRadius: 99, border: 'none', position: 'relative', background: on ? 'var(--grad)' : 'var(--surface-3)', transition: 'background 0.2s' }}
    >
      <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
    </button>
  )
}
