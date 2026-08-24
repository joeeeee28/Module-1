import React, { useEffect, useState } from 'react'
import { RefreshCw, Play, Bot, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react'
import { api } from '../api.js'
import { Card, Badge, Spinner, Empty } from '../components.jsx'

const STATUS_ICON = {
  SUCCESS: <CheckCircle2 size={16} style={{ color: 'var(--green)' }} />,
  PARTIAL: <AlertTriangle size={16} style={{ color: 'var(--amber)' }} />,
  WARN: <AlertTriangle size={16} style={{ color: 'var(--amber)' }} />,
  FAILED: <XCircle size={16} style={{ color: 'var(--red)' }} />,
  EMPTY: <AlertTriangle size={16} style={{ color: 'var(--amber)' }} />,
}

export default function AgentActivity() {
  const [runs, setRuns] = useState(null)
  const [busy, setBusy] = useState(false)
  const [config, setConfig] = useState(null)

  const load = () => api.agentActivity().then(setRuns)
  useEffect(() => { load(); api.config().then(setConfig) }, [])

  const runNow = async () => {
    setBusy(true)
    try {
      await api.runMorning()
      load()
    } finally {
      setBusy(false)
    }
  }

  if (!runs) return <Spinner />

  return (
    <div>
      <div className="flex-between mb">
        <div>
          <h2 className="section-title">Agent Activity</h2>
          <p className="muted small" style={{ margin: '-8px 0 0' }}>
            A real audit log of every automated action — confirms the agent actually ran.
          </p>
        </div>
        <div className="flex">
          <button className="btn" onClick={load}><RefreshCw size={15} /> Refresh</button>
          <button className="btn primary" onClick={runNow} disabled={busy}>
            <Play size={15} className={busy ? 'spin' : ''} /> Run morning agent now
          </button>
        </div>
      </div>

      <Card className="mb" title="Runtime capabilities" sub="What's actually configured (no fake integrations)">
        <div className="grid cols-3">
          <div className="small flex" style={{ gap: 8 }}>
            <Bot size={16} style={{ color: config?.aiConfigured ? 'var(--green)' : 'var(--amber)' }} />
            AI model: {config?.aiConfigured ? 'Connected' : 'Built-in engine (no key)'}
          </div>
          <div className="small flex" style={{ gap: 8 }}>
            <span style={{ color: config?.searchConfigured ? 'var(--green)' : 'var(--amber)' }}>🔍</span>
            Live search: {config?.searchConfigured ? 'Connected' : 'Unavailable'}
          </div>
          <div className="small flex" style={{ gap: 8 }}>
            <span style={{ color: config?.telegramConfigured || config?.webhookConfigured ? 'var(--green)' : 'var(--amber)' }}>📣</span>
            External notifications: {config?.telegramConfigured ? 'Telegram' : config?.webhookConfigured ? 'Webhook' : 'In-app only'}
          </div>
        </div>
      </Card>

      {runs.length === 0 ? (
        <Empty icon="🤖" text="No agent runs recorded yet. The log fills as the agent plans, discovers resources, and sends notifications." />
      ) : (
        <Card flat>
          <table className="table">
            <thead>
              <tr><th>Time</th><th>Agent</th><th>Action</th><th>Detail</th><th>Status</th></tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td className="mono small faint" style={{ whiteSpace: 'nowrap' }}>{r.created_at?.replace('T', ' ').slice(0, 16)}</td>
                  <td><span className="small" style={{ fontWeight: 600 }}>{r.agent}</span></td>
                  <td className="small">{r.action}</td>
                  <td className="small faint">{r.detail}</td>
                  <td>
                    <span className="flex" style={{ gap: 6 }}>
                      {STATUS_ICON[r.status] || <span />}
                      <Badge tone={r.status === 'SUCCESS' ? 'green' : r.status === 'FAILED' ? 'red' : 'amber'}>{r.status}</Badge>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
