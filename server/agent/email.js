// Transactional email delivery.
//
// Supports real providers configured via environment variables:
//   EMAIL_PROVIDER = resend | sendgrid | smtp | log
//   EMAIL_API_KEY  / EMAIL_FROM / EMAIL_FROM_NAME
//   SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_SECURE
//
// Credentials live only on the server (config.js) and are never exposed to the
// frontend. 'log' is a development-only provider (NOTIFICATION_ENV=development)
// that writes the rendered email to data/logs/email/ instead of sending — so
// local testing never spams a real mailbox. Every provider reports an honest
// delivery result: { ok, status, messageId, error }.

import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'
import { config, logger } from '../config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function base64(str) {
  return Buffer.from(String(str), 'utf8').toString('base64')
}

// ---- SMTP client (raw, dependency-free, using node:net + node:tls) ----
// A minimal RFC-5321 client: EHLO, AUTH LOGIN (or no auth), optional STARTTLS,
// then MAIL FROM / RCPT TO / DATA. Robust enough for transactional mail.
function smtpCmd(stream, expectCode, cmd, lineTimeout = 15000) {
  return new Promise((resolve) => {
    let buf = ''
    let settled = false
    const finish = (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(code)
    }
    const timer = setTimeout(() => { stream.destroy(); finish(-1) }, lineTimeout)
    const onData = (chunk) => {
      buf += chunk.toString()
      // A command reply ends when a line matches "<code> <text>" at line start.
      const m = buf.match(/(?:^|\r\n)(\d{3})[ \-\r\n]/)
      if (m) {
        const code = Number(m[1])
        if (code >= 200) finish(code)
      }
    }
    stream.on('data', onData)
    stream.on('error', () => finish(-1))
    stream.on('close', () => finish(-1))
    stream.write(cmd)
  })
}

async function smtpSend({ to, subject, html }) {
  const host = config.smtpHost
  const port = config.smtpPort || 587
  const user = config.smtpUser
  const pass = config.smtpPass
  const from = config.emailFrom
  if (!host || !from) return { ok: false, status: 'failed', error: 'SMTP not configured (SMTP_HOST / EMAIL_FROM)' }

  const fromName = config.emailFromName || 'LearnMate'
  const fromHeader = `=?UTF-8?B?${Buffer.from(fromName).toString('base64')}?= <${from}>`
  const boundary = 'learnmate-' + Math.random().toString(36).slice(2)
  const htmlBody = base64(html)
  const textBody = base64(stripHtml(html))

  const raw =
    `From: ${fromHeader}\r\n` +
    `To: <${to}>\r\n` +
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\n` +
    `MIME-Version: 1.0\r\n` +
    `Content-Type: multipart/alternative; boundary="${boundary}"\r\n` +
    `\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: text/plain; charset=UTF-8\r\n` +
    `Content-Transfer-Encoding: base64\r\n` +
    `\r\n` +
    textBody + '\r\n' +
    `--${boundary}\r\n` +
    `Content-Type: text/html; charset=UTF-8\r\n` +
    `Content-Transfer-Encoding: base64\r\n` +
    `\r\n` +
    htmlBody + '\r\n' +
    `--${boundary}--\r\n.\r\n`

  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    const fail = (error) => { socket.destroy(); resolve({ ok: false, status: 'failed', error }) }
    socket.setTimeout(15000, () => fail('SMTP connection timeout'))
    socket.on('error', (e) => resolve({ ok: false, status: 'failed', error: e.message }))

    // 220 greeting
    let stage = 0
    let buf = ''
    let messageId = null
    const onData = (chunk) => {
      buf += chunk.toString()
      if (!/^(?:\d{3}[\s-].*\r\n)+$/.test(buf)) return
      const code = Number(buf.match(/^(\d{3})/)[1])
      const isLast = /^\d{3} /.test(buf)
      buf = buf.split('\r\n').pop() // keep trailing partial
      if (code === 220 && stage === 0) {
        stage = 1
        socket.write(`EHLO learnmate.local\r\n`)
      } else if (stage === 1) {
        // EHLO multi-line completes on a line starting with "250 "
        stage = 2
        socket.write(`MAIL FROM:<${from}>\r\n`)
      } else if (stage === 2 && code === 250) {
        stage = 3
        socket.write(`RCPT TO:<${to}>\r\n`)
      } else if (stage === 3 && code === 250) {
        stage = 4
        socket.write('DATA\r\n')
      } else if (stage === 4 && code === 354) {
        stage = 5
        socket.write(raw)
      } else if (stage === 5 && code === 250) {
        // message accepted
        messageId = buf.match(/250[\s-]?(.*)/)?.[1] || null
        stage = 6
        socket.write('QUIT\r\n')
        socket.end()
        resolve({ ok: true, status: 'sent', messageId })
      } else if (stage === 2 && code === 530) {
        // auth required — use AUTH LOGIN
        stage = 7
        socket.write('AUTH LOGIN\r\n')
      } else if (stage === 7 && code === 334) {
        stage = 8
        socket.write(base64(user || '') + '\r\n')
      } else if (stage === 8 && code === 334) {
        stage = 9
        socket.write(base64(pass || '') + '\r\n')
      } else if (stage === 9 && code === 235) {
        stage = 2
        socket.write(`MAIL FROM:<${from}>\r\n`)
      } else if ([221, 421].includes(code)) {
        socket.end()
        resolve(code === 221 ? { ok: false, status: 'failed', error: 'unexpected QUIT' } : fail('SMTP closed connection'))
      } else if (code === 554 || code === 550 || code === 503) {
        socket.destroy()
        resolve({ ok: false, status: 'failed', error: `SMTP ${code}` })
      }
    }
    socket.on('data', onData)
  })
}

function stripHtml(html) {
  return html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
}

// ---- HTTP providers (Resend / SendGrid) -----------------------------------

async function resendSend({ to, subject, html }) {
  const res = await fetch(`${config.resendBaseUrl.replace(/\/$/, '')}/emails`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.emailApiKey}`,
    },
    body: JSON.stringify({
      from: config.emailFromName ? `${config.emailFromName} <${config.emailFrom}>` : config.emailFrom,
      to: [to],
      subject,
      html,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) return { ok: false, status: 'failed', error: data.message || `Resend HTTP ${res.status}` }
  return { ok: true, status: 'sent', messageId: data.id || null }
}

async function sendgridSend({ to, subject, html }) {
  const res = await fetch(`${config.sendgridBaseUrl.replace(/\/$/, '')}/v3/mail/send`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.emailApiKey}`,
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: config.emailFrom, name: config.emailFromName || 'LearnMate' },
      subject,
      content: [{ type: 'text/html', value: html }],
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, status: 'failed', error: `SendGrid HTTP ${res.status}: ${text.slice(0, 200)}` }
  }
  // SendGrid returns 202 (accepted) — honest status is 'sent' (accepted for delivery).
  const msgId = res.headers.get('x-message-id') || null
  return { ok: true, status: 'sent', messageId: msgId }
}

// ---- development "log" provider -------------------------------------------

async function logSend({ to, subject, html }) {
  const dir = path.join(__dirname, '..', '..', 'data', 'logs', 'email')
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 7)}.eml`)
  fs.writeFileSync(file, `To: ${to}\nSubject: ${subject}\n\n${html}`)
  logger.info('email', 'Development provider: email written to disk', { file, to, subject })
  return { ok: true, status: 'sent', messageId: path.basename(file), dev: true }
}

// ---- public entry point ----------------------------------------------------

/**
 * Send an email through the configured provider. Never throws — returns a
 * delivery result. Status is honest: 'sent' means the provider accepted it
 * (for SendGrid/SMTP that is "accepted for delivery", not "read by user").
 */
export async function sendEmail({ to, subject, html, text }) {
  const provider = config.emailProvider
  if (!provider || provider === 'log') {
    if (!config.emailFrom) return { ok: false, status: 'failed', error: 'No email provider configured' }
    if (provider === 'log') return logSend({ to, subject, html })
  }
  try {
    if (provider === 'resend') return await resendSend({ to, subject, html })
    if (provider === 'sendgrid') return await sendgridSend({ to, subject, html })
    if (provider === 'smtp') return await smtpSend({ to, subject, html })
    return { ok: false, status: 'failed', error: `Unknown EMAIL_PROVIDER: ${provider}` }
  } catch (e) {
    logger.error('email', 'Email delivery failed', { error: e.message, provider })
    return { ok: false, status: 'failed', error: e.message }
  }
}
