// In-process scheduler — the clock that triggers the morning agent.
//
// Every minute it checks each user's local time (in their configured timezone)
// against their briefing time. When they match, and the morning agent hasn't
// already run today, it executes the full pipeline.
//
// NOTE: this requires the server process to be running (works on Render/Fly
// long-running services). For serverless hosts, trigger the same pipeline via
// POST /api/agent/run-morning (protected by ADMIN_TOKEN) from an external cron.

import { db, userToday } from '../db.js'
import { config, logger } from '../config.js'
import { runMorningAgent } from './morning.js'
import { logAgentRun } from './runlog.js'

let timer = null
const lastRun = new Map() // `${userId}:${date}` -> timestamp

function localHm(timezone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date)
    const h = parts.find((p) => p.type === 'hour').value
    const m = parts.find((p) => p.type === 'minute').value
    return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
  } catch {
    return null
  }
}

async function tick() {
  const users = db.prepare('SELECT * FROM users').all()
  for (const user of users) {
    if (!user.briefing_time) continue
    const hm = localHm(user.timezone || 'UTC')
    if (!hm) continue
    // Trigger when the local time has reached the briefing time (catch-up safe:
    // a briefing missed while the server was down is delivered on the next tick).
    if (hm < user.briefing_time) continue

    const today = userToday(user)
    const key = `${user.id}:${today}`
    const last = lastRun.get(key) || 0
    if (Date.now() - last < 60 * 1000) continue // already ran this minute

    const alreadyRan = db
      .prepare('SELECT id FROM daily_plans WHERE user_id = ? AND date = ?')
      .get(user.id, today)
    if (alreadyRan) continue

    lastRun.set(key, Date.now())
    logger.info('scheduler', 'Triggering morning agent', { userId: user.id, tz: user.timezone, hm })
    try {
      await runMorningAgent(user.id)
    } catch (e) {
      logger.error('scheduler', 'Morning agent failed', { userId: user.id, error: e.message })
      logAgentRun(user.id, 'Scheduler', 'Morning agent run', e.message, 'FAILED')
    }
  }
}

export function startScheduler() {
  if (timer) return
  timer = setInterval(() => {
    tick().catch((e) => logger.error('scheduler', 'Scheduler tick error', { error: e.message }))
  }, 30 * 1000)
  logger.info('scheduler', `Scheduler started (interval 30s, briefing times honored per-user timezone)`)
  return timer
}

export function stopScheduler() {
  if (timer) clearInterval(timer)
  timer = null
}

export function isSchedulerRunning() {
  return Boolean(timer)
}
