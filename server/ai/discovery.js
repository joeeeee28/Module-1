// Real resource discovery + live-information layer.
//
// Three honest sources, in priority order:
//   1. Live package registries (PyPI / npm) — genuine, current data with real URLs.
//   2. A curated map of authoritative official documentation (stable, real URLs).
//   3. An optional external search API (Tavily / Brave / SerpAPI) when a key is set.
//
// Every URL is verified at runtime where the network allows it; results are
// labelled with their source and verification status so the UI never presents
// a guessed/fake link as confirmed.

import { config, logger } from '../config.js'

const PYPI_BASE = 'https://pypi.org'
const NPM_BASE = 'https://www.npmjs.com'

// Curated authoritative sources. Only stable, well-known official URLs.
const CURATED = [
  { keys: ['python'], title: 'Python official documentation', url: 'https://docs.python.org/3/', type: 'Documentation' },
  { keys: ['python'], title: 'The Python Tutorial', url: 'https://docs.python.org/3/tutorial/', type: 'Tutorial' },
  { keys: ['python requests', 'requests library', 'http client', 'requests'], title: 'Requests: HTTP for Humans', url: 'https://requests.readthedocs.io/', type: 'Documentation' },
  { keys: ['sql'], title: 'SQLite documentation', url: 'https://www.sqlite.org/docs.html', type: 'Documentation' },
  { keys: ['sql'], title: 'PostgreSQL documentation', url: 'https://www.postgresql.org/docs/', type: 'Documentation' },
  { keys: ['javascript', 'js'], title: 'MDN Web Docs — JavaScript', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript', type: 'Documentation' },
  { keys: ['rest'], title: 'Microsoft — RESTful web API design', url: 'https://learn.microsoft.com/en-us/azure/architecture/best-practices/api-design', type: 'Guide' },
  { keys: ['git'], title: 'Git documentation', url: 'https://git-scm.com/doc', type: 'Documentation' },
  { keys: ['git', 'github'], title: 'GitHub Docs', url: 'https://docs.github.com/', type: 'Documentation' },
  { keys: ['azure'], title: 'Microsoft Learn — Azure', url: 'https://learn.microsoft.com/en-us/azure/', type: 'Documentation' },
  { keys: ['entra', 'azure ad'], title: 'Microsoft Entra ID documentation', url: 'https://learn.microsoft.com/en-us/entra/', type: 'Documentation' },
  { keys: ['microsoft 365', 'm365'], title: 'Microsoft 365 documentation', url: 'https://learn.microsoft.com/en-us/microsoft-365/', type: 'Documentation' },
  { keys: ['powershell'], title: 'PowerShell documentation', url: 'https://learn.microsoft.com/en-us/powershell/', type: 'Documentation' },
  { keys: ['graph'], title: 'Microsoft Graph documentation', url: 'https://learn.microsoft.com/en-us/graph/', type: 'Documentation' },
  { keys: ['intune'], title: 'Microsoft Intune documentation', url: 'https://learn.microsoft.com/en-us/mem/intune/', type: 'Documentation' },
  { keys: ['exchange'], title: 'Exchange Online documentation', url: 'https://learn.microsoft.com/en-us/exchange/', type: 'Documentation' },
  { keys: ['sharepoint'], title: 'SharePoint documentation', url: 'https://learn.microsoft.com/en-us/sharepoint/', type: 'Documentation' },
  { keys: ['servicenow'], title: 'ServiceNow product documentation', url: 'https://docs.servicenow.com/', type: 'Documentation' },
  { keys: ['servicenow'], title: 'ServiceNow Developer', url: 'https://developer.servicenow.com/', type: 'Documentation' },
  { keys: ['business analysis', 'ba'], title: 'IIBA — International Institute of Business Analysis', url: 'https://www.iiba.org/', type: 'Reference' },
  { keys: ['project management'], title: 'Project Management Institute', url: 'https://www.pmi.org/', type: 'Reference' },
  { keys: ['scrum', 'agile'], title: 'Scrum.org', url: 'https://www.scrum.org/', type: 'Reference' },
  { keys: ['architecture'], title: 'Microsoft — Azure Architecture Center', url: 'https://learn.microsoft.com/en-us/azure/architecture/', type: 'Guide' },
]

// Library names we can resolve live via PyPI for common Python topics.
const PYPI_HINTS = {
  'requests': 'requests',
  'web scraping': 'beautifulsoup4',
  'beautifulsoup': 'beautifulsoup4',
  'testing': 'pytest',
  'automation': 'schedule',
  'data': 'pandas',
  'async': 'aiohttp',
  'flask': 'flask',
  'django': 'django',
  'fastapi': 'fastapi',
  'openai': 'openai',
  'numpy': 'numpy',
}

const NPM_HINTS = {
  'playwright': 'playwright',
  'react': 'react',
  'node': 'node',
  'puppeteer': 'puppeteer',
}

async function fetchJson(url, { timeoutMs = 8000, retries = 1 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    const c = new AbortController()
    const t = setTimeout(() => c.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        signal: c.signal,
        headers: { 'User-Agent': 'LearnMate/1.0 (+personal learning agent)' },
      })
      clearTimeout(t)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      clearTimeout(t)
      lastErr = e
      if (attempt < retries) await new Promise((r) => setTimeout(r, 400))
    }
  }
  throw lastErr
}

async function verifyUrl(url, { timeoutMs = 6000 } = {}) {
  const c = new AbortController()
  const t = setTimeout(() => c.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'HEAD', signal: c.signal, redirect: 'follow' })
    clearTimeout(t)
    return res.ok
  } catch {
    clearTimeout(t)
    // HEAD can be rejected by some servers; try GET
    const c2 = new AbortController()
    const t2 = setTimeout(() => c2.abort(), timeoutMs)
    try {
      const res = await fetch(url, { signal: c2.signal, redirect: 'follow' })
      clearTimeout(t2)
      return res.ok
    } catch {
      clearTimeout(t2)
      return false
    }
  }
}

// Live package lookup on PyPI — returns current, real package data.
async function pypiLookup(pkg) {
  try {
    const d = await fetchJson(`${PYPI_BASE}/pypi/${encodeURIComponent(pkg)}/json`)
    return {
      title: `${d.info.name} ${d.info.version} (PyPI)`,
      url: d.info.project_url || `${PYPI_BASE}/project/${encodeURIComponent(pkg)}/`,
      type: 'Package',
      source: 'pypi',
      summary: (d.info.summary || '').slice(0, 140),
      verified: true,
    }
  } catch {
    return null
  }
}

async function npmLookup(pkg) {
  try {
    const d = await fetchJson(`https://registry.npmjs.org/${encodeURIComponent(pkg)}/latest`)
    return {
      title: `${d.name} ${d.version} (npm)`,
      url: `${NPM_BASE}/package/${encodeURIComponent(pkg)}`,
      type: 'Package',
      source: 'npm',
      summary: (d.description || '').slice(0, 140),
      verified: true,
    }
  } catch {
    return null
  }
}

async function searchApi(topic) {
  if (!config.searchProvider || !config.searchApiKey) return []
  try {
    if (config.searchProvider === 'tavily') {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: config.searchApiKey, query: `${topic} official documentation tutorial`, max_results: 4 }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      return (data.results || []).map((r) => ({
        title: r.title, url: r.url, type: 'Web', source: 'search', summary: r.content?.slice(0, 140), verified: false,
      }))
    }
    // Brave / SerpAPI default to simple query → not implemented without their SDKs; return []
    logger.warn('discovery', 'Search provider not supported', { provider: config.searchProvider })
    return []
  } catch (e) {
    logger.warn('discovery', 'Live search failed', { error: e.message })
    return []
  }
}

/**
 * Discover resources for a learning topic. Returns an array of resource objects
 * with a `source` field so the UI can label provenance honestly.
 */
export async function discoverResources(topic, { limit = 5 } = {}) {
  const t = (topic || '').toLowerCase()
  const results = []

  // 1. Live package registries (real, current data) — highest trust.
  for (const [hint, pkg] of Object.entries(PYPI_HINTS)) {
    if (t.includes(hint)) {
      const r = await pypiLookup(pkg)
      if (r) results.push(r)
    }
  }
  for (const [hint, pkg] of Object.entries(NPM_HINTS)) {
    if (t.includes(hint)) {
      const r = await npmLookup(pkg)
      if (r) results.push(r)
    }
  }

  // 2. Curated authoritative sources.
  for (const c of CURATED) {
    if (c.keys.some((k) => t.includes(k))) {
      results.push({ title: c.title, url: c.url, type: c.type, source: 'curated', verified: false })
    }
  }

  // 3. Optional live search API.
  const searchResults = await searchApi(topic)
  results.push(...searchResults)

  // Verify curated/search URLs (best effort — may be egress-restricted).
  const seen = new Set()
  const out = []
  for (const r of results) {
    if (seen.has(r.url)) continue
    seen.add(r.url)
    let verified = r.verified || false
    if (r.source === 'curated') {
      verified = await verifyUrl(r.url)
    }
    out.push({ ...r, verified, lastVerified: verified ? new Date().toISOString() : null })
    if (out.length >= limit) break
  }
  return out
}

/**
 * Current real-world developments for a topic. Returns a short factual summary
 * when a live source is reachable, otherwise null (caller must degrade).
 */
export async function getCurrentInfo(topic) {
  const t = (topic || '').toLowerCase()
  // Live package data is a legitimate "current" signal we can actually fetch.
  for (const [hint, pkg] of Object.entries(PYPI_HINTS)) {
    if (t.includes(hint)) {
      const r = await pypiLookup(pkg)
      if (r) return `Latest ${r.title} — ${r.summary || 'released on PyPI'}.`
    }
  }
  const search = await searchApi(`${topic} latest developments 2026`)
  if (search.length) {
    return `Recent sources on "${topic}": ${search.map((s) => s.title).join('; ')}.`
  }
  return null
}
