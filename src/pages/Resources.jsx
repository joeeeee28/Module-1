import React, { useEffect, useState } from 'react'
import { Plus, Trash2, ExternalLink, BookOpen, Youtube, FileText, Github, Link2 } from 'lucide-react'
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

      {resources.length === 0 && <Empty icon="📚" text="No resources yet." />}

      <div className="grid cols-2">
        {resources.map((r) => (
          <Card key={r.id}>
            <div className="flex-between" style={{ alignItems: 'flex-start' }}>
              <div className="flex" style={{ gap: 10 }}>
                <span className="badge gray" style={{ gap: 6 }}>{TYPE_ICON[r.type] || <Link2 size={15} />}{r.type}</span>
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
