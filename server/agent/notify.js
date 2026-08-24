// LearnMate Notification Engine.
//
// Every notification is created from a REAL learning event, persisted to the
// `notifications` table (the in-app inbox), and — when the user enables email —
// handed to an email queue that a worker drains through the configured provider.
//
// Reliability guarantees:
//   * idempotency — a unique (user, type, channel, ...) key prevents duplicates
//     across restarts (e.g. the morning plan is never sent twice for one day).
//   * honest status — nothing is marked 'delivered' unless the transport
//     actually accepted it; email failures are recorded and the in-app copy stays.
//   * quiet hours — non-critical email is deferred to the next morning.
//   * priority — critical/high/medium/low steers frequency and quiet-hours bypass.

import { db, now } from '../db.js'
import { config, logger, isDevMode, emailConfigured } from '../config.js'
import { getPreferences, shouldNotify, inQuietHours, notificationEmail } from './preferences.js'
import { sendEmail } from './email.js'

export const CHANNELS = ['in-app', 'email']

const PRIORITY_LEVEL = { critical: 0, high: 1, medium: 2, low: 3 }

function nextMorning(user) {
  // Next 07:30 in the user's timezone (ISO). Used to defer quiet-hour email.
  const tz = user.timezone || 'UTC'
  const time = user.morning_notification_time || user.briefing_time || '07:30'
  const [hh, mm] = time.split(':').map(Number)
  // Walk forward minute-by-minute until local time >= time and not today.
  const d = new Date(Date.now() + 90 * 60 * 1000) // start from ~now
  for (let i = 0; i < 60 * 24 * 3; i++) {
    const probe = new Date(d.getTime() + i * 60 * 1000)
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(probe)
    const h = Number(parts.find((p) => p.type === 'hour').value)
    const m = Number(parts.find((p) => p.type === 'minute').value)
    if (h === hh && m === mm) return probe.toISOString()
  }
  return new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
}

function idempotencyKeyFor(type, channel, user, entityKey) {
  const date = now() // YYYY-MM-DD (server local) — daily dedupe for daily types
  const parts = [type, channel, date]
  if (entityKey) parts.push(String(entityKey))
  return parts.join(':')
}

/**
 * Persist a notification (in-app always; email enqueued when enabled).
 * Returns an array of created notification rows. Skips duplicates (idempotency)
 * and respects preferences + quiet hours.
 */
export async function notifyUser({
  user,
  type,
  title,
  message,
  priority = 'medium',
  relatedEntityType = null,
  relatedEntityId = null,
  actionUrl = null,
  metadata = null,
  idempotencyKey = null,
  entityKey = null,
}) {
  const userId = user.id
  const results = []

  // --- in-app ---
  if (shouldNotify(userId, type, 'in-app')) {
    const key = idempotencyKey ? `in-app:${idempotencyKey}` : idempotencyKeyFor(type, 'in-app', user, entityKey)
    const existing = db.prepare('SELECT id FROM notifications WHERE user_id = ? AND idempotency_key = ?').get(userId, key)
    if (!existing) {
      const ins = db.prepare(
        `INSERT INTO notifications
           (user_id, type, title, body, channel, status, priority, related_entity_type, related_entity_id, action_url, metadata_json, idempotency_key, delivered_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        userId, type, title, message, 'in-app', 'delivered', priority,
        relatedEntityType, relatedEntityId, actionUrl,
        metadata ? JSON.stringify(metadata) : '{}', key, new Date().toISOString()
      )
      results.push(db.prepare('SELECT * FROM notifications WHERE id = ?').get(Number(ins.lastInsertRowid)))
    }
  }

  // --- email ---
  if (shouldNotify(userId, type, 'email')) {
    const key = idempotencyKey ? `email:${idempotencyKey}` : idempotencyKeyFor(type, 'email', user, entityKey)
    const existing = db.prepare('SELECT id FROM notifications WHERE user_id = ? AND idempotency_key = ?').get(userId, key)
    const critical = priority === 'critical'
    const quiet = !critical && inQuietHours(user)
    if (!existing) {
      const scheduledFor = quiet ? nextMorning(user) : new Date().toISOString()
      const ins = db.prepare(
        `INSERT INTO notifications
           (user_id, type, title, body, channel, status, priority, scheduled_for, related_entity_type, related_entity_id, action_url, metadata_json, idempotency_key)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).run(
        userId, type, title, message, 'email', 'queued', priority, scheduledFor,
        relatedEntityType, relatedEntityId, actionUrl,
        metadata ? JSON.stringify(metadata) : '{}', key
      )
      const n = db.prepare('SELECT * FROM notifications WHERE id = ?').get(Number(ins.lastInsertRowid))
      enqueueEmail(n, user)
      results.push(n)
    }
  }

  logger.debug('notify', 'Notification created', {
    userId, type, channels: results.map((r) => `${r.channel}:${r.status}`),
  })
  return results
}

// ---- email queue -----------------------------------------------------------

export function enqueueEmail(notification, user) {
  const to = notificationEmail(user)
  if (!to) {
    db.prepare('UPDATE notifications SET status = ?, error = ? WHERE id = ?').run('failed', 'No email address configured', notification.id)
    return
  }
  db.prepare(
    'INSERT INTO email_queue (user_id, notification_id, to_email, subject, provider, status) VALUES (?,?,?,?,?,?)'
  ).run(
    notification.user_id, notification.id, to,
    notification.title || 'LearnMate notification',
    config.emailProvider, 'queued'
  )
}

// Build the HTML body for a queued email. Subject + body are set by the
// generator (templates) which knows the notification type and metadata.
export function renderEmailBody(notification, user) {
  const meta = (() => { try { return JSON.parse(notification.metadata_json || '{}') } catch { return {} } })()
  const renderer = emailRenderers[notification.type] || emailRenderers.default
  const subject = meta.subject || notification.title || 'LearnMate notification'
  const html = renderer(notification, user, meta)
  return { subject, html }
}

// ---- worker ----------------------------------------------------------------

async function processOne(queueRow) {
  db.prepare("UPDATE email_queue SET status = 'processing' WHERE id = ?").run(queueRow.id)
  const notification = db.prepare('SELECT * FROM notifications WHERE id = ?').get(queueRow.notification_id)
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(queueRow.user_id)
  if (!notification || !user) {
    db.prepare("UPDATE email_queue SET status = 'failed', last_error = 'Missing user/notification' WHERE id = ?").run(queueRow.id)
    return
  }
  const { subject, html } = renderEmailBody(notification, user)
  const result = await sendEmail({ to: queueRow.to_email, subject, html })
  const nowIso = new Date().toISOString()
  if (result.ok) {
    db.prepare("UPDATE email_queue SET status = 'sent', attempts = attempts + 1, sent_at = ? WHERE id = ?").run(nowIso, queueRow.id)
    db.prepare('UPDATE notifications SET status = ?, sent_at = ?, delivered_at = ?, error = NULL WHERE id = ?')
      .run(result.status === 'delivered' ? 'delivered' : 'sent', nowIso, nowIso, notification.id)
    logger.info('email', 'Email sent', { userId: user.id, type: notification.type, id: notification.id, provider: config.emailProvider, messageId: result.messageId })
  } else {
    const attempts = queueRow.attempts + 1
    // bounded retry: up to 3 attempts, then fail (no spam).
    const nextStatus = attempts >= 3 ? 'failed' : 'queued'
    db.prepare('UPDATE email_queue SET status = ?, attempts = ?, last_error = ? WHERE id = ?').run(nextStatus, attempts, result.error, queueRow.id)
    if (nextStatus === 'failed') {
      db.prepare('UPDATE notifications SET status = ?, error = ? WHERE id = ?').run('failed', result.error, notification.id)
      logger.warn('email', 'Email failed after retries', { userId: user.id, id: notification.id, error: result.error })
    }
  }
}

export async function processEmailQueue() {
  if (!emailConfigured()) {
    // nothing enabled — leave queue as-is
    return 0
  }
  const rows = db.prepare(`SELECT * FROM email_queue WHERE status = 'queued' ORDER BY id LIMIT 20`).all()
  // scheduled_for lives on the notification — defer anything scheduled in the future.
  const due = rows.filter((r) => {
    const n = db.prepare('SELECT scheduled_for FROM notifications WHERE id = ?').get(r.notification_id)
    return !n || !n.scheduled_for || n.scheduled_for <= new Date().toISOString()
  })
  for (const row of due) {
    try {
      await processOne(row)
    } catch (e) {
      logger.error('email', 'Email worker error', { error: e.message })
      db.prepare("UPDATE email_queue SET status='failed', last_error=? WHERE id=?").run(e.message, row.id)
    }
  }
  return due.length
}

// ---- compatibility + query helpers ----------------------------------------

/** Backward-compatible sendNotification (used by morning agent and others). */
export async function sendNotification(user, { type, title, body }) {
  return notifyUser({ user, type, title, message: body, priority: 'medium' })
}

export function listNotifications(userId, opts = {}) {
  const limit = Number(opts.limit || 50)
  const { channel, status, read } = opts
  let sql = 'SELECT * FROM notifications WHERE user_id = ?'
  const args = [userId]
  if (channel) { sql += ' AND channel = ?'; args.push(channel) }
  if (status) { sql += ' AND status = ?'; args.push(status) }
  if (read === 'read') sql += ' AND read = 1'
  if (read === 'unread') sql += ' AND read = 0'
  sql += ' ORDER BY id DESC LIMIT ?'
  args.push(limit)
  return db.prepare(sql).all(...args)
}

export function listAllNotifications(userId) {
  return db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC').all(userId)
}

export function markRead(userId, id) {
  db.prepare("UPDATE notifications SET read = 1, read_at = datetime('now') WHERE id = ? AND user_id = ?").run(id, userId)
}

export function markAllRead(userId) {
  db.prepare("UPDATE notifications SET read = 1, read_at = datetime('now') WHERE user_id = ? AND read = 0").run(userId)
}

export function unreadCount(userId) {
  return db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(userId).c
}

export function emailHealth() {
  return {
    provider: config.emailProvider,
    configured: emailConfigured(),
    dev: isDevMode(),
    from: config.emailFrom ? config.emailFrom.replace(/^(.*@)/, '***@') : null,
  }
}

import { renderers as emailRenderers } from './email-templates.js'

export { config }
