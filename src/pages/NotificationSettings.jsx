import React, { useEffect, useState } from 'react'
import { Mail, Bell, Moon, Send, Save, ShieldCheck } from 'lucide-react'
import { api } from '../api.js'
import { Card, Spinner } from '../components.jsx'

function Toggle({ on, onClick }) {
  return (
    <button onClick={onClick} style={{ width: 44, height: 24, borderRadius: 99, border: 'none', position: 'relative', background: on ? 'var(--grad)' : 'var(--surface-3)', transition: 'background 0.2s', flexShrink: 0 }}>
      <span style={{ position: 'absolute', top: 3, left: on ? 23 : 3, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'left 0.2s' }} />
    </button>
  )
}

const EMAIL_TOGGLES = [
  { k: 'morning', l: 'Morning learning plan', d: 'Daily AI learning plan each morning' },
  { k: 'taskReminder', l: 'Task reminders', d: 'Remind about tasks not yet started' },
  { k: 'missedTask', l: 'Missed task notifications', d: 'Notify when a task remains incomplete' },
  { k: 'revision', l: 'Revision reminders', d: 'Topic due for spaced revision' },
  { k: 'assessment', l: 'Assessment reminders', d: 'When an assessment becomes ready' },
  { k: 'deadline', l: 'Goal deadline reminders', d: 'Approaching goal deadlines' },
  { k: 'weekly', l: 'Weekly learning summary', d: 'Weekly progress report' },
  { k: 'monthly', l: 'Monthly learning summary', d: 'Monthly learning report' },
]

const INAPP_TOGGLES = [
  { k: 'taskReminder', l: 'Task reminders' },
  { k: 'learningPlan', l: 'Learning plan' },
  { k: 'revision', l: 'Revision reminders' },
  { k: 'assessment', l: 'Assessments' },
  { k: 'missedTask', l: 'Missed tasks' },
  { k: 'deadline', l: 'Goal deadlines' },
  { k: 'aiRecommendation', l: 'AI recommendations' },
]

export default function NotificationSettings() {
  const [prefs, setPrefs] = useState(null)
  const [saved, setSaved] = useState(false)
  const [verificationCode, setVerificationCode] = useState('')
  const [verifyMsg, setVerifyMsg] = useState('')
  const [testMsg, setTestMsg] = useState('')
  const [testErr, setTestErr] = useState('')

  useEffect(() => { api.notificationPrefs().then(setPrefs) }, [])

  if (!prefs) return <Spinner />
  const email = prefs.email
  const inApp = prefs.inApp
  const quiet = prefs.quietHours

  const patch = (fn) => setPrefs((p) => fn(p))
  const flash = (setter, msg) => { setter(msg); setTimeout(() => setter(''), 3000) }

  const save = async () => {
    await api.saveNotificationPrefs(prefs)
    setSaved(true); setTimeout(() => setSaved(false), 1500)
  }

  const sendVerification = async () => {
    setVerifyMsg('')
    try {
      await api.sendVerificationEmail(email.address || email.accountEmail)
      flash(setVerifyMsg, 'Verification code sent to ' + (email.address || email.accountEmail))
    } catch (e) { flash(setVerifyMsg, 'Failed to send: ' + e.message) }
  }

  const verify = async () => {
    try {
      await api.verifyEmail(verificationCode)
      setPrefs((p) => ({ ...p, email: { ...p.email, verified: true } }))
      setVerificationCode('')
      flash(setVerifyMsg, 'Email verified ✓')
    } catch (e) { flash(setVerifyMsg, 'Invalid code: ' + e.message) }
  }

  const sendTest = async () => {
    setTestErr(''); setTestMsg('')
    try {
      await api.testNotification()
      flash(setTestMsg, 'Test email sent successfully')
    } catch (e) { setTestErr(e.message); flash(setTestMsg, '') }
  }

  const renderToggleList = (toggles, channelKey) =>
    toggles.map((t) => (
      <div key={t.k} className="flex-between" style={{ padding: '9px 0', borderBottom: '1px solid var(--border)' }}>
        <div>
          <div className="small" style={{ fontWeight: 600 }}>{t.l}</div>
          {t.d && <div className="faint" style={{ fontSize: 12 }}>{t.d}</div>}
        </div>
        <Toggle on={toggles[t.k]} onClick={() => patch((p) => ({ ...p, [channelKey]: { ...p[channelKey], toggles: { ...p[channelKey].toggles, [t.k]: !toggles[t.k] } } }))} />
      </div>
    ))

  return (
    <div className="grid cols-2" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
      <div>
        <Card title="Email Notifications" sub="Delivered to your notification email via the configured provider"
          actions={<Mail size={18} className="faint" />}>
          <div className="flex-between" style={{ padding: '6px 0' }}>
            <span className="small" style={{ fontWeight: 600 }}>Email notifications</span>
            <Toggle on={email.enabled} onClick={() => patch((p) => ({ ...p, email: { ...p.email, enabled: !email.enabled } }))} />
          </div>
          <div className="field">
            <label>Notification email</label>
            <input className="input" value={email.address || email.accountEmail || ''}
              onChange={(e) => patch((p) => ({ ...p, email: { ...p.email, address: e.target.value } }))} placeholder="you@example.com" />
            <div className="flex" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={sendVerification} disabled={!email.address && !email.accountEmail}>Send verification code</button>
              {!email.verified && (
                <>
                  <input className="input" style={{ width: 90 }} placeholder="Code" value={verificationCode} onChange={(e) => setVerificationCode(e.target.value)} />
                  <button className="btn sm" onClick={verify}>Verify</button>
                </>
              )}
              {email.verified && <span className="badge green flex" style={{ gap: 5, alignItems: 'center' }}><ShieldCheck size={12} /> Verified</span>}
            </div>
            {verifyMsg && <div className="small mt" style={{ color: 'var(--accent-3)' }}>{verifyMsg}</div>}
          </div>
          <div className="small faint mt" style={{ marginBottom: 6 }}>Delivery status is recorded per message — nothing is marked sent unless the provider accepted it.</div>
          {renderToggleList(EMAIL_TOGGLES, 'email')}
          <button className="btn primary mt" onClick={save}><Save size={15} /> {saved ? 'Saved ✓' : 'Save email settings'}</button>
        </Card>

        <Card className="mt" title="Quiet Hours" sub="Non-critical emails are held until the morning"
          actions={<Moon size={18} className="faint" />}>
          <div className="flex-between" style={{ padding: '6px 0' }}>
            <span className="small" style={{ fontWeight: 600 }}>Quiet hours</span>
            <Toggle on={quiet.enabled} onClick={() => patch((p) => ({ ...p, quietHours: { ...p.quietHours, enabled: !quiet.enabled } }))} />
          </div>
          {quiet.enabled && (
            <div className="row2">
              <div className="field"><label>Start</label><input className="input" type="time" value={quiet.start} onChange={(e) => patch((p) => ({ ...p, quietHours: { ...p.quietHours, start: e.target.value } }))} /></div>
              <div className="field"><label>End</label><input className="input" type="time" value={quiet.end} onChange={(e) => patch((p) => ({ ...p, quietHours: { ...p.quietHours, end: e.target.value } }))} /></div>
            </div>
          )}
          <button className="btn primary mt" onClick={save}><Save size={15} /> {saved ? 'Saved ✓' : 'Save quiet hours'}</button>
        </Card>
      </div>

      <div>
        <Card title="In-App Notifications" sub="Shown in the notification bell" actions={<Bell size={18} className="faint" />}>
          <div className="flex-between" style={{ padding: '6px 0' }}>
            <span className="small" style={{ fontWeight: 600 }}>In-app notifications</span>
            <Toggle on={inApp.enabled} onClick={() => patch((p) => ({ ...p, inApp: { ...p.inApp, enabled: !inApp.enabled } }))} />
          </div>
          {renderToggleList(INAPP_TOGGLES, 'inApp')}
          <button className="btn primary mt" onClick={save}><Save size={15} /> {saved ? 'Saved ✓' : 'Save in-app settings'}</button>
        </Card>

        <Card className="mt" title="Test & Status" sub="Verify real email delivery" actions={<Send size={18} className="faint" />}>
          <div className="small muted">Provider: <b style={{ color: 'var(--text)' }}>{emailHealthLabel(prefs.emailHealth)}</b></div>
          <div className="small faint mt">From: <b>{prefs.emailHealth?.from || '—'}</b></div>
          <button className="btn primary mt w100" onClick={sendTest}><Send size={15} /> Send Test Email</button>
          {testMsg && <div className="small mt" style={{ color: 'var(--green)' }}>{testMsg}</div>}
          {testErr && <div className="small mt" style={{ color: 'var(--red)' }}>{testErr}</div>}
        </Card>
      </div>
    </div>
  )
}

function emailHealthLabel(h) {
  if (!h) return 'not configured'
  if (h.provider) return `${h.provider}${h.dev ? ' (dev log mode)' : ''}`
  return 'not configured'
}
