// In-process scheduler — the clock that triggers the morning agent and the
// periodic notification checks.
//
// Every minute it checks each user's local time (in their configured timezone)
// against their briefing time. When they match, and the morning agent hasn't
// already run today, it executes the full pipeline. It also runs the email queue
// worker and the daily/weekly/monthly notification generators (revision, goal
// deadlines, task reminders, missed tasks, reviews) once per period, gated by
// stored markers so restarts never cause duplicates.
//
// NOTE: requires the server process to be running. For serverless hosts, trigger
// the same pipeline via POST /api/agent/run-morning (protected by ADMIN_TOKEN).

import { db, userToday } from '../db.js'
import { config, logger } from '../config.js'
import { runMorningAgent } from './morning.js'
import { processEmailQueue } from './notify.js'
import {
  notifyRevisionsDue,
  notifyGoalDeadlines,
  notifyAssessmentReady,
  notifyTaskReminders,
  notifyMissedTasks,
  notifyWeeklyReview,
  notifyMonthlyReview,
} from './generators.js'
import { logAgentRun } from './runlog.js'

let timer = null
const lastRun = new Map()

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

function localHour(timezone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).formatToParts(date)
    return Number(parts.find((p) => p.type === 'hour').value)
  } catch {
    return new Date().getHours()
  }
}

// Week identifier (Monday-based) for weekly gating.
function weekKey(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  const day = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - day)
  return d.toISOString().slice(0, 10)
}

// Persisted marker so a check runs at most once per period.
function markRun(userId, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run(`notif:${userId}:${key}`, JSON.stringify(value))
}
function lastRunAt(userId, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(`notif:${userId}:${key}`)
  if (!row) return null
  try { return JSON.parse(row.value) } catch { return row.value }
}

async function runDailyChecks(user) {
  const today = userToday(user)
  const uid = user.id
  const hr = localHour(user.timezone || 'UTC')

  // revision + deadline + assessment + task reminders: once per day
  if (lastRunAt(uid, 'daily') !== today) {
    try {
      await notifyRevisionsDue(user)
      await notifyGoalDeadlines(user)
      await notifyAssessmentReady(user)
      await notifyTaskReminders(user)
    } catch (e) {
      logger.error('notif', 'Daily notification checks failed', { userId: uid, error: e.message })
    }
    markRun(uid, 'daily', today)
  }

  // missed tasks: once per day, evening
  if (hr >= 18 && lastRunAt(uid, 'missed') !== today) {
    try {
      await notifyMissedTasks(user)
    } catch (e) {
      logger.error('notif', 'Missed-task checks failed', { userId: uid, error: e.message })
    }
    markRun(uid, 'missed', today)
  }
}

async function runPeriodicChecks(user) {
  const today = userToday(user)
  const uid = user.id
  const wk = weekKey(today)

  // weekly review: once per week, on Monday
  if (new Date(today + 'T00:00:00').getDay() === 1 && lastRunAt(uid, 'weekly') !== wk) {
    try {
      await notifyWeeklyReview(user)
      markRun(uid, 'weekly', wk)
    } catch (e) {
      logger.error('notif', 'Weekly review notification failed', { userId: uid, error: e.message })
    }
  }

  // monthly review: once per month, on the 1st
  const monthKey = today.slice(0, 7)
  if (today.endsWith('-01') && lastRunAt(uid, 'monthly') !== monthKey) {
    try {
      await notifyMonthlyReview(user)
      markRun(uid, 'monthly', monthKey)
    } catch (e) {
      logger.error('notif', 'Monthly review notification failed', { userId: uid, error: e.message })
    }
  }
}

async function tick() {
  // drain email queue
  try {
    await processEmailQueue()
  } catch (e) {
    logger.error('notif', 'Email queue drain failed', { error: e.message })
  }

  const users = db.prepare('SELECT * FROM users').all()
  for (const user of users) {
    // --- morning agent (per timezone) ---
    if (user.briefing_time) {
      const hm = localHm(user.timezone || 'UTC')
      if (hm && hm >= user.briefing_time) {
        const today = userToday(user)
        const key = `${user.id}:${today}`
        const last = lastRun.get(key) || 0
        if (Date.now() - last >= 60 * 1000) {
          const alreadyRan = db.prepare('SELECT id FROM daily_plans WHERE user_id=? AND date=?').get(user.id, today)
          if (!alreadyRan) {
            lastRun.set(key, Date.now())
            try {
              await runMorningAgent(user.id)
            } catch (e) {
              logger.error('scheduler', 'Morning agent failed', { userId: user.id, error: e.message })
              logAgentRun(user.id, 'Scheduler', 'Morning agent run', e.message, 'FAILED')
            }
          }
        }
      }
    }

    // --- notification checks ---
    await runDailyChecks(user)
    await runPeriodicChecks(user)
  }
}

export function startScheduler() {
  if (timer) return
  timer = setInterval(() => {
    tick().catch((e) => logger.error('scheduler', 'Scheduler tick error', { error: e.message }))
  }, 30 * 1000)
  logger.info('scheduler', 'Scheduler started (30s interval: morning agent, email queue, notification checks)')
  return timer
}

export function stopScheduler() {
  if (timer) clearInterval(timer)
  timer = null
}

export function isSchedulerRunning() {
  return Boolean(timer)
}
