// Per-user notification preferences.
//
// Stored in the `notification_preferences` table as JSON keyed by user. Also
// keeps the email-specific fields on the users table in sync (notification_email,
// email_notifications_enabled, email_verified). Every notification type has its
// own toggle for each channel, so the engine can decide precisely what to send.

import { db } from '../db.js'

export const DEFAULT_PREFS = {
  email: {
    enabled: false,
    address: '',
    verified: false,
    toggles: {
      morning: true,
      taskReminder: true,
      missedTask: true,
      revision: true,
      assessment: true,
      deadline: true,
      weekly: true,
      monthly: true,
    },
  },
  inApp: {
    enabled: true,
    toggles: {
      taskReminder: true,
      learningPlan: true,
      revision: true,
      assessment: true,
      missedTask: true,
      deadline: true,
      aiRecommendation: true,
    },
  },
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '07:00',
  },
}

function mergePrefs(base, override) {
  const out = { ...base }
  for (const k of Object.keys(override || {})) {
    if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && override[k] && typeof override[k] === 'object') {
      out[k] = mergePrefs(base[k], override[k])
    } else if (override[k] !== undefined) {
      out[k] = override[k]
    }
  }
  return out
}

export function getPreferences(userId) {
  const row = db.prepare('SELECT prefs_json FROM notification_preferences WHERE user_id = ?').get(userId)
  let prefs = DEFAULT_PREFS
  if (row) {
    try {
      prefs = mergePrefs(DEFAULT_PREFS, JSON.parse(row.prefs_json))
    } catch {
      prefs = DEFAULT_PREFS
    }
  }
  // Keep email fields authoritative from the users table.
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
  if (user) {
    prefs.email.address = user.notification_email || user.email || prefs.email.address || ''
    prefs.email.enabled = Boolean(user.email_notifications_enabled ?? (prefs.email.enabled ? 1 : 0))
    prefs.email.verified = Boolean(user.email_verified)
  }
  return prefs
}

export function setPreferences(userId, prefs) {
  const current = getPreferences(userId)
  const merged = mergePrefs(current, prefs)
  // Persist JSON
  db.prepare(
    'INSERT INTO notification_preferences (user_id, prefs_json, updated_at) VALUES (?,?,datetime(\'now\')) ' +
    'ON CONFLICT(user_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = datetime(\'now\')'
  ).run(userId, JSON.stringify(merged))

  // Sync email fields onto the users table.
  if (prefs?.email) {
    const sets = []
    const vals = []
    if (prefs.email.address !== undefined) {
      sets.push('notification_email = ?'); vals.push(prefs.email.address)
      // Changing the address invalidates verification.
      if (prefs.email.address !== (current.email.address)) {
        sets.push('email_verified = 0'); vals.push(0)
      }
    }
    if (prefs.email.enabled !== undefined) { sets.push('email_notifications_enabled = ?'); vals.push(prefs.email.enabled ? 1 : 0) }
    if (prefs.email.verified !== undefined) { sets.push('email_verified = ?'); vals.push(prefs.email.verified ? 1 : 0) }
    if (sets.length) {
      vals.push(userId)
      db.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
    }
  }
  return getPreferences(userId)
}

// Map a notification type to the preference toggle key for a channel.
const TYPE_TO_TOGGLE = {
  morning: 'morning',
  weekly_review: 'weekly',
  monthly_review: 'monthly',
  task_reminder: 'taskReminder',
  missed_task: 'missedTask',
  revision_due: 'revision',
  assessment_ready: 'assessment',
  goal_deadline: 'deadline',
  learning_plan: 'learningPlan',
  ai_recommendation: 'aiRecommendation',
  test: null,
}

// Should this type be delivered on the given channel for this user?
export function shouldNotify(userId, type, channel) {
  const prefs = getPreferences(userId)
  if (channel === 'in-app') {
    if (!prefs.inApp.enabled) return false
    const key = TYPE_TO_TOGGLE[type]
    if (key && prefs.inApp.toggles[key] === false) return false
    return true
  }
  if (channel === 'email') {
    if (!prefs.email.enabled || !prefs.email.address || !prefs.email.verified) return false
    const key = TYPE_TO_TOGGLE[type]
    if (key && prefs.email.toggles[key] === false) return false
    return true
  }
  return true
}

// Resolve the email address to use for a user (notification_email or account email).
export function notificationEmail(user) {
  return user.notification_email || user.email || ''
}

// Is it quiet hours right now in the user's timezone?
export function inQuietHours(user) {
  const prefs = getPreferences(user.id)
  const q = prefs.quietHours
  if (!q.enabled) return false
  const hm = localHm(user.timezone || 'UTC')
  if (!hm) return false
  return betweenHm(hm, q.start, q.end)
}

function localHm(timezone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date)
    const h = parts.find((p) => p.type === 'hour').value
    const m = parts.find((p) => p.type === 'minute').value
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
  } catch {
    return null
  }
}

// Handle intervals that wrap midnight (e.g. 22:00 -> 07:00).
function betweenHm(hm, start, end) {
  if (start === end) return false
  const t = toMin(hm), s = toMin(start), e = toMin(end)
  if (s < e) return t >= s && t < e
  return t >= s || t < e
}

function toMin(hm) {
  const [h, m] = String(hm).split(':').map(Number)
  return h * 60 + (m || 0)
}
