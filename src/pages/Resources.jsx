import React, { useEffect, useState } from 'react'
import { Plus, Trash2, ExternalLink, BookOpen, Youtube, FileText, Github, Link2, Search, Sparkles } from 'lucide-react'
import { api } from '../api.js'
import { Card, Badge, Modal, Spinner, Empty } from '../components.jsx'

const TYPE_ICON = {
  Book: <BookOpen size={15} />, YouTube: <Youtube size={15} />, Documentation: <FileText size={15} />,
  Course: <BookOpen size={15} />, GitHub: <Github size={15} />, PDF: <FileText size={15} />, Website: <Link2 size={15} />,
}

export default function Resources() {
  const [resources, setResources] = useState(null)
  const [goals, setGoals] = useState([])
  const [adding, setAdding] = useState(false)

  const load = () => api.resources().then(setResources)
  useEffect(() => {
    load()
    api.goals().then(setGoals)
  }, [])

  if (!resources) return <Spinner />

  return (
    <div>
      <div className="flex-between mb">
        <div>
          <h2 className="section-title">Learning Resources</h2>
          <p className="muted small" style={{ margin: '-8px 0 0' }}>
            Books, courses, docs, videos & repos — the AI recommends existing resources before new ones.
          </p>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}><Plus size={16} /> Add resource</button>
      </div>

      <DiscoveryPanel onImported={load} goals={goals} />

      {resources.length === 0 && <Empty icon="📚" text="No resources saved yet." />}

      <div className="grid cols-2">
        {resources.map((r) => (
          <Card key={r.id}>
            <div className="flex-between" style={{ alignItems: 'flex-start' }}>
              <div className="flex" style={{ gap: 10 }}>
                <span className="badge gray" style={{ gap: 6 }}>{TYPE_ICON[r.type] || <Link2 size={15} />}{r.type}</span>
                {r.source && r.source !== 'manual' && <Badge tone="violet">{r.source}</Badge>}
                {r.verified ? <Badge tone="green">verified</Badge> : <Badge tone="gray">unverified</Badge>}
              </div>
              <button className="btn icon ghost sm" onClick={async () => { await api.delResource(r.id); load() }}><Trash2 size={14} /></button>
            </div>
            <div className="card-title mt" style={{ fontSize: 15 }}>{r.title}</div>
            {r.notes && <p className="muted small" style={{ margin: '6px 0 0' }}>{r.notes}</p>}
            {r.url && (
              <a className="flex small mt" style={{ gap: 6, color: 'var(--accent-3)' }} href={r.url} target="_blank" rel="noreferrer">
                <ExternalLink size={13} /> {r.url}
              </a>
            )}
          </Card>
        ))}
      </div>

      {adding && <AddResource goals={goals} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load() }} />}
    </div>
  )
}

function DiscoveryPanel({ onImported, goals }) {
  const [topic, setTopic] = useState('')
  const [results, setResults] = useState(null)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState({})
  const [msg, setMsg] = useState('')

  const discover = async () => {
    if (!topic.trim()) return
    setBusy(true)
    setMsg('')
    try {
      const r = await api.discoverResources(topic)
      setResults(r.results)
      setSelected({})
      if (r.message) setMsg(r.message)
    } finally {
      setBusy(false)
    }
  }

  const importSelected = async () => {
    const items = results.filter((_, i) => selected[i])
    if (!items.length) return
    await api.importResources(goals[0]?.id || null, topic, items)
    setResults(null)
    setTopic('')
    onImported()
  }

  return (
    <Card className="mb" title="Discover resources" sub="Real, live lookups — official docs, packages & search. Each result is labeled with its source and verification status.">
      <div className="flex" style={{ gap: 10 }}>
        <input className="input" style={{ flex: 1 }} placeholder="e.g. Python requests, Microsoft Graph API, pytest…" value={topic} onChange={(e) => setTopic(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && discover()} />
        <button className="btn primary" onClick={discover} disabled={busy}><Search size={15} className={busy ? 'spin' : ''} /> Discover</button>
      </div>
      {msg && <div className="small muted mt">{msg}</div>}
      {results && (
        <div className="mt">
          {results.length === 0 && <div className="small muted">No results found — try a more specific topic.</div>}
          {results.map((r, i) => (
            <div key={i} className="flex" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)', gap: 10, alignItems: 'flex-start' }}>
              <input type="checkbox" checked={!!selected[i]} onChange={(e) => setSelected({ ...selected, [i]: e.target.checked })} style={{ marginTop: 3 }} />
              <div style={{ flex: 1 }}>
                <div className="small" style={{ fontWeight: 600 }}>{r.title}</div>
                {r.summary && <div className="small faint">{r.summary}</div>}
                <a className="small" style={{ color: 'var(--accent-3)' }} href={r.url} target="_blank" rel="noreferrer">{r.url}</a>
              </div>
              <div className="flex" style={{ gap: 6, flexDirection: 'column', alignItems: 'flex-end' }}>
                <Badge tone="violet">{r.source}</Badge>
                <Badge tone={r.verified ? 'green' : 'gray'}>{r.verified ? 'verified' : 'unverified'}</Badge>
              </div>
            </div>
          ))}
          {results.length > 0 && (
            <button className="btn primary mt" onClick={importSelected} disabled={!Object.values(selected).some(Boolean)}>
              <Sparkles size={15} /> Save selected to library
            </button>
          )}
        </div>
      )}
    </Card>
  )
}

function AddResource({ goals, onClose, onDone }) {
  const [f, setF] = useState({ title: '', url: '', type: 'Website', goal_id: '', notes: '' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    await api.addResource({ ...f, goal_id: f.goal_id || null })
    onDone()
  }
  return (
    <Modal title="Add resource" onClose={onClose}>
      <div className="field"><label>Title *</label><input className="input" value={f.title} onChange={set('title')} placeholder="e.g. Real Python — REST APIs" /></div>
      <div className="field"><label>URL</label><input className="input" value={f.url} onChange={set('url')} placeholder="https://…" /></div>
      <div className="row2">
        <div className="field"><label>Type</label>
          <select className="select" value={f.type} onChange={set('type')}>
            {['Website', 'YouTube', 'Documentation', 'Course', 'Book', 'PDF', 'GitHub'].map((t) => <option key={t}>{t}</option>)}
          </select>
        </div>
        <div className="field"><label>Related goal</label>
          <select className="select" value={f.goal_id} onChange={set('goal_id')}>
            <option value="">None</option>
            {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </div>
      </div>
      <div className="field"><label>Notes</label><textarea className="textarea" value={f.notes} onChange={set('notes')} /></div>
      <div className="flex" style={{ justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={!f.title}>Save</button>
      </div>
    </Modal>
  )
}
