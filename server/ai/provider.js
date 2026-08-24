// AI provider abstraction.
//
// When an LLM key is configured (OPENAI_API_KEY or ANTHROPIC_API_KEY) the app
// calls a real model over HTTPS (server-side only — keys never reach the
// frontend). When no key is configured, `aiComplete` returns `null` and the
// deterministic learning engine in engine.js takes over. Every consumer must
// handle the `null` case so the app never fakes AI output.

import { config, logger } from '../config.js'

let warnedUnavailable = false

export function aiAvailable() {
  return Boolean(config.openaiApiKey || config.anthropicApiKey)
}

function withTimeout(ms) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), ms)
  return { signal: c.signal, clear: () => clearTimeout(t) }
}

async function openaiComplete(system, user, json) {
  const url = `${config.openaiBaseUrl.replace(/\/$/, '')}/chat/completions`
  const { signal, clear } = withTimeout(config.aiTimeoutMs)
  try {
    const body = {
      model: config.openaiModel,
      temperature: 0.4,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    }
    if (json) body.response_format = { type: 'json_object' }
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.openaiApiKey}`,
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`OpenAI ${res.status}: ${txt.slice(0, 200)}`)
    }
    const data = await res.json()
    return data.choices?.[0]?.message?.content ?? null
  } finally {
    clear()
  }
}

async function anthropicComplete(system, user, json) {
  const { signal, clear } = withTimeout(config.aiTimeoutMs)
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.anthropicModel,
        max_tokens: json ? 1500 : 800,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    })
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Anthropic ${res.status}: ${txt.slice(0, 200)}`)
    }
    const data = await res.json()
    return data.content?.[0]?.text ?? null
  } finally {
    clear()
  }
}

/**
 * Ask the configured AI model. Returns the model's text, or `null` if no model
 * is configured / the call fails. `json` requests JSON output; the caller must
 * still JSON.parse defensively.
 */
export async function aiComplete(system, user, { json = false } = {}) {
  if (!aiAvailable()) {
    if (!warnedUnavailable) {
      logger.info('ai', 'No AI key configured — using built-in deterministic engine')
      warnedUnavailable = true
    }
    return null
  }
  try {
    if (config.anthropicApiKey) return await anthropicComplete(system, user, json)
    return await openaiComplete(system, user, json)
  } catch (e) {
    logger.error('ai', 'AI request failed, falling back to engine', { error: e.message })
    return null
  }
}
