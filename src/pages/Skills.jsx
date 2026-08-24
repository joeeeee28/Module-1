import React, { useEffect, useState } from 'react'
import { Plus, Trash2, Pencil, Info } from 'lucide-react'
import { api } from '../api.js'
import { Card, Bar, Badge, Modal, Spinner, levelColor, masteryTone } from '../components.jsx'

const LEVELS = ['Novice', 'Beginner', 'Intermediate', 'Advanced', 'Expert']

export default function SkillsPage() {
  const [skills, setSkills] = useState(null)
  const [editing, setEditing] = useState(null) // {skill} or 'new'

  const load = () => api.skills().then(setSkills)
  useEffect(() => { load() }, [])

  if (!skills) return <Spinner />

  const cats = [...new Set(skills.map((s) => s.category || 'Other'))]

  return (
    <div>
      <div className="flex-between mb">
        <div>
          <h2 className="section-title">Skill Mastery</h2>
          <p className="muted small" style={{ margin: '-8px 0 0' }}>
            Mastery is computed from lessons, exercises, assessments, projects, confidence & recency — not just completion.
          </p>
        </div>
        <button className="btn primary" onClick={() => setEditing('new')}><Plus size={16} /> Add skill</button>
      </div>

      {cats.map((cat) => (
        <Card key={cat} title={cat} className="mb">
          {skills.filter((s) => (s.category || 'Other') === cat).map((s) => (
            <div key={s.id} className="flex-between" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
              <div style={{ width: 170 }}>
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <span className="small" style={{ color: levelColor(s.current_level) }}>{s.current_level}</span>
                <span className="small faint"> → {s.target_level}</span>
              </div>
              <div className="flex" style={{ flex: 1, gap: 12, alignItems: 'center' }}>
                <Bar value={s.current_mastery} />
                <span className="mono small faint" style={{ width: 40, textAlign: 'right' }}>{Math.round(s.current_mastery)}%</span>
              </div>
              <div className="flex" style={{ gap: 6, marginLeft: 12 }}>
                <Badge tone={masteryTone(s.current_mastery)}>{Math.round(s.current_mastery)}%</Badge>
                <button className="btn icon ghost sm" onClick={() => setEditing({ skill: s })}><Pencil size={14} /></button>
                <button className="btn icon ghost sm" onClick={async () => { if (confirm(`Delete ${s.name}?`)) { await api.delSkill(s.id); load() } }}><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </Card>
      ))}

      {editing && (
        <SkillModal
          skill={editing === 'new' ? null : editing.skill}
          onClose={() => setEditing(null)}
          onDone={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}

function SkillModal({ skill, onClose, onDone }) {
  const [f, setF] = useState(skill ? { ...skill } : { name: '', category: 'Technical', target_mastery: 80, current_level: 'Beginner', target_level: 'Advanced' })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    if (skill) await api.saveSkill(skill.id, f)
    else await api.addSkill(f)
    onDone()
  }
  return (
    <Modal title={skill ? 'Edit skill' : 'Add skill'} onClose={onClose}>
      <div className="field"><label>Name *</label><input className="input" value={f.name} onChange={set('name')} placeholder="e.g. Kubernetes" /></div>
      <div className="field"><label>Category</label>
        <select className="select" value={f.category} onChange={set('category')}>
          <option>Technical</option><option>Microsoft / Cloud</option><option>ServiceNow</option><option>Business / Architecture</option><option>Other</option>
        </select>
      </div>
      <div className="row2">
        <div className="field"><label>Current level</label>
          <select className="select" value={f.current_level} onChange={set('current_level')}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
        </div>
        <div className="field"><label>Target level</label>
          <select className="select" value={f.target_level} onChange={set('target_level')}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select>
        </div>
      </div>
      <div className="field"><label>Target mastery %</label><input className="input" type="number" value={f.target_mastery} onChange={set('target_mastery')} min={0} max={100} /></div>
      <div className="flex" style={{ justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save} disabled={!f.name}>Save</button>
      </div>
    </Modal>
  )
}
