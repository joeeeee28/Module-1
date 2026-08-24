import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export const config = {
  port: process.env.PORT || 4000,
  nodeEnv: process.env.NODE_ENV || 'development',
  databasePath: process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'app.db'),

  // demo seeding — OFF by default. Set SEED_DEMO=true to create a sample account.
  seedDemo: process.env.SEED_DEMO === 'true',

  logLevel: process.env.LOG_LEVEL || 'info',
  logDir: process.env.LOG_DIR || path.join(__dirname, '..', 'data', 'logs'),

  // AI provider (optional). If unset, the built-in deterministic engine is used.
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest',
  aiTimeoutMs: Number(process.env.AI_TIMEOUT_MS || 30000),

  // live search provider (optional)
  searchProvider: process.env.SEARCH_API_PROVIDER || '', // 'tavily' | 'brave' | 'serp'
  searchApiKey: process.env.SEARCH_API_KEY || '',

  // notifications
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  webhookUrl: process.env.WEBHOOK_URL || '',
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  smtpFrom: process.env.SMTP_FROM || '',

  // cron-trigger token: protects /api/agent/* endpoints called by an external scheduler
  adminToken: process.env.ADMIN_TOKEN || '',

  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 10000),
}

export const aiConfigured = () =>
  Boolean(config.openaiApiKey || config.anthropicApiKey)

export const searchConfigured = () =>
  Boolean(config.searchProvider && config.searchApiKey)

// ---------------------------------------------------------------------------
// Structured logger — writes human-readable logs to disk + console.
// Never logs secrets.
// ---------------------------------------------------------------------------
const SECRET_KEYS = ['api_key', 'apikey', 'token', 'password', 'authorization', 'smtp_pass', 'secret']

function redact(obj) {
  if (!obj || typeof obj !== 'object') return obj
  const out = Array.isArray(obj) ? [] : {}
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEYS.some((s) => k.toLowerCase().includes(s))) out[k] = '[REDACTED]'
    else out[k] = typeof v === 'object' ? redact(v) : v
  }
  return out
}

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 }
let stream = null
function getStream() {
  if (stream) return stream
  try {
    fs.mkdirSync(config.logDir, { recursive: true })
    stream = fs.createWriteStream(path.join(config.logDir, 'learnmate.log'), { flags: 'a' })
  } catch {
    stream = null
  }
  return stream
}

export function log(level, scope, message, meta) {
  if (LEVELS[level] < LEVELS[config.logLevel]) return
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    meta: meta ? redact(meta) : undefined,
  })
  if (level === 'error') console.error(line)
  else console.log(line)
  const s = getStream()
  if (s) s.write(line + '\n')
}

export const logger = {
  debug: (scope, message, meta) => log('debug', scope, message, meta),
  info: (scope, message, meta) => log('info', scope, message, meta),
  warn: (scope, message, meta) => log('warn', scope, message, meta),
  error: (scope, message, meta) => log('error', scope, message, meta),
}
