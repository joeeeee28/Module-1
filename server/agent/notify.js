// Notification service.
//
// Every notification is first persisted to the `notifications` table (the
// in-app inbox), which is *always* a real, delivered message. Additional
// channels (webhook, Telegram, email/SMTP) are attempted only when configured,
// and their delivery status is recorded honestly — a notification is never
// marked "delivered" unless the transport actually succeeded.

import { db } from '../db.js'
import { config, logger } from '../config.js'

const CHANNELS = ['in-app', 'webhook', 'telegram', 'email']

function createNotification(userId, { type, title, body, channel }) {
  const ins = db
    .prepare(
      'INSERT INTO notifications (user_id, type, title, body, channel, status) VALUES (?,?,?,?,?,?)'
    )
    .run(userId, type, title, body ?? null, channel, 'pending')
  return Number(ins.lastInsertRowid)
}

function mark(id, status, error = null) {
  db.prepare('UPDATE notifications SET status = ?, error = ?, delivered_at = ? WHERE id = ?').run(
    status,
    error,
    status === 'delivered' ? new Date().toISOString() : null,
    id
  )
}

async function deliverWebhook(n) {
  if (!config.webhookUrl) return { ok: false, error: 'No webhook configured' }
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), config.requestTimeoutMs)
  try {
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      signal: c.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: n.type, title: n.title, body: n.body }),
    })
    clearTimeout(t)
    return { ok: res.ok, error: res.ok ? null : `HTTP ${res.status}` }
  } catch (e) {
    clearTimeout(t)
    return { ok: false, error: e.message }
  }
}

async function deliverTelegram(n) {
  if (!config.telegramBotToken || !config.telegramChatId) {
    return { ok: false, error: 'Telegram not configured' }
  }
  const text = `*${n.title}*\n${n.body || ''}`
  const url = `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), config.requestTimeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: c.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.telegramChatId, text, parse_mode: 'Markdown' }),
    })
    clearTimeout(t)
    const data = await res.json().catch(() => ({}))
    return { ok: res.ok && data.ok !== false, error: data.ok === false ? (data.description || `HTTP ${res.status}`) : null }
  } catch (e) {
    clearTimeout(t)
    return { ok: false, error: e.message }
  }
}

async function deliverEmail(n, user) {
  if (!config.smtpHost || !config.smtpFrom) return { ok: false, error: 'SMTP not configured' }
  // Node has no built-in SMTP client; email delivery requires a real SMTP
  // integration. Record honestly as unavailable unless implemented via a lib.
  return { ok: false, error: 'SMTP transport not enabled (no SMTP client configured)' }
}

/**
 * Send a notification to a user. Returns the persisted notification row(s)
 * with per-channel delivery status.
 */
export async function sendNotification(user, { type, title, body }) {
  const userId = user.id
  const results = []

  // In-app inbox — always delivered.
  const inAppId = createNotification(userId, { type, title, body, channel: 'in-app' })
  mark(inAppId, 'delivered')
  results.push(db.prepare('SELECT * FROM notifications WHERE id = ?').get(inAppId))

  // Additional channels per user preference + global config.
  const pref = user.notification_channel || 'in-app'
  if (pref === 'in-app') return results

  if (pref === 'webhook' || (pref === 'all' && config.webhookUrl)) {
    const id = createNotification(userId, { type, title, body, channel: 'webhook' })
    const r = await deliverWebhook({ type, title, body })
    mark(id, r.ok ? 'delivered' : 'failed', r.error)
    results.push(db.prepare('SELECT * FROM notifications WHERE id = ?').get(id))
  }
  if (pref === 'telegram' || (pref === 'all' && config.telegramBotToken)) {
    const id = createNotification(userId, { type, title, body, channel: 'telegram' })
    const r = await deliverTelegram({ type, title, body })
    mark(id, r.ok ? 'delivered' : 'failed', r.error)
    results.push(db.prepare('SELECT * FROM notifications WHERE id = ?').get(id))
  }
  if (pref === 'email' || (pref === 'all' && config.smtpHost)) {
    const id = createNotification(userId, { type, title, body, channel: 'email' })
    const r = await deliverEmail({ type, title, body }, user)
    mark(id, r.ok ? 'delivered' : 'failed', r.error)
    results.push(db.prepare('SELECT * FROM notifications WHERE id = ?').get(id))
  }

  logger.info('notify', 'Notification sent', {
    userId, type, channels: results.map((r) => `${r.channel}:${r.status}`),
  })
  return results
}

export function listNotifications(userId, limit = 50) {
  return db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit)
}

export function markRead(userId, id) {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(id, userId)
}

export function unreadCount(userId) {
  return db.prepare('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0').get(userId).c
}

export { CHANNELS }
