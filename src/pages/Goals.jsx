import React, { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Plus, Target, Trash2, RefreshCw, ArrowLeft, Flag, CalendarDays, Clock } from 'lucide-react'
import { api } from '../api.js'
import { Card, Bar, Badge, Modal, Spinner, Empty, levelColor } from '../components.jsx'

const LEVELS = ['Beginner', 'Intermediate', 'Advanced', 'Expert']

export default function Goals() {
  const { id } = useParams()
  return id ? <GoalDetail id={id} /> : <GoalList />
}

function GoalList() {
  const [goals, setGoals] = useState(null)
  const [creating, setCreating] = useState(false)

  const load = () => api.goals().then(setGoals)
  useEffect(() => { load() }, [])

  if (!goals) return <Spinner />

  return (
    <div>
      <div className="flex-between mb">
        <div>
          <h2 className="section-title">My Learning Goals</h2>
          <p className="muted small" style={{ margin: '-8px 0 0' }}>
            Each goal becomes an AI-generated roadmap with daily plans.
          </p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> New goal</button>
      </div>

      {goals.length === 0 && (
        <Empty icon="🎯" text="No goals yet — create your first learning goal.">
          <button className="btn primary" onClick={() => setCreating(true)}><Plus size={16} /> Create goal</button>
        </Empty>
      )}

      <div className="grid cols-2">
        {goals.map((g) => (
          <Card key={g.id}>
            <div className="flex-between" style={{ marginBottom: 10 }}>
              <Link to={`/goals/${g.id}`} className="card-title" style={{ fontSize: 16 }}>{g.name}</Link>
              <Badge tone={g.status === 'active' ? 'green' : 'gray'}>{g.status}</Badge>
            </div>
            <p className="muted small" style={{ margin: '0 0 12px', minHeight: 36 }}>{g.description}</p>
            <div className="flex-between" style={{ marginBottom: 8 }}>
              <span className="small faint">{g.current_level} → {g.target_level}</span>
              <span className="mono small faint">{Math.round(g.progress)}%</span>
            </div>
            <Bar value={g.progress} />
            <div className="flex mt" style={{ gap: 14, flexWrap: 'wrap' }}>
              <Badge tone={g.priority === 'High' ? 'red' : g.priority === 'Medium' ? 'amber' : 'gray'}><Flag size={11} /> {g.priority}</Badge>
              {g.deadline && <Badge tone="blue"><CalendarDays size={11} /> {g.deadline}</Badge>}
              <Badge tone="gray"><Clock size={11} /> {g.hours_per_week}h/week</Badge>
            </div>
          </Card>
        ))}
      </div>

      {creating && <CreateGoal onClose={() => setCreating(false)} onDone={() => { setCreating(false); load() }} />}
    </div>
  )
}

function CreateGoal({ onClose, onDone }) {
  const [f, setF] = useState({ name: '', description: '', why: '', target_outcome: '', current_level: 'Beginner', target_level: 'Advanced', priority: 'Medium', deadline: '', hours_per_week: 5, preferred_method: 'Hands-on / project-based', related_goal: '' })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const submit = async () => {
    setBusy(true)
    try {
      const g = await api.createGoal({ ...f, deadline: f.deadline || null, hours_per_week: +f.hours_per_week })
      onDone()
      useNavigate()(`/goals/${g.id}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Create Learning Goal" sub="The AI will generate a structured roadmap automatically" onClose={onClose} wide>
      <div className="field">
        <label>Goal name *</label>
        <input className="input" value={f.name} onChange={set('name')} placeholder="e.g. Become proficient in Python automation" autoFocus />
      </div>
      <div className="field">
        <label>Description</label>
        <input className="input" value={f.description} onChange={set('description')} placeholder="What do you want to achieve?" />
      </div>
      <div className="row2">
        <div className="field">
          <label>Why this matters</label>
          <input className="input" value={f.why} onChange={set('why')} placeholder="How it advances your career" />
        </div>
        <div className="field">
          <label>Target outcome</label>
          <input className="input" value={f.target_outcome} onChange={set('target_outcome')} placeholder="e.g. Ship 2 automation tools" />
        </div>
      </div>
      <div className="row3">
        <div className="field">
          <label>Current level</label>
          <select className="select" value={f.current_level} onChange={set('current_level')}>
            {LEVELS.map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Target level</label>
          <select className="select" value={f.target_level} onChange={set('target_level')}>
            {LEVELS.map((l) => <option key={l}>{l}</option>)}
          </select>
        </div>
        <div className="field">
          <label>Priority</label>
          <select className="select" value={f.priority} onChange={set('priority')}>
            <option>High</option><option>Medium</option><option>Low</option>
          </select>
        </div>
      </div>
      <div className="row3">
        <div className="field">
          <label>Deadline</label>
          <input className="input" type="date" value={f.deadline} onChange={set('deadline')} />
        </div>
        <div className="field">
          <label>Hours / week</label>
          <input className="input" type="number" value={f.hours_per_week} onChange={set('hours_per_week')} min={1} />
        </div>
        <div className="field">
          <label>Learning method</label>
          <select className="select" value={f.preferred_method} onChange={set('preferred_method')}>
            <option>Hands-on / project-based</option>
            <option>Video courses</option>
            <option>Reading / documentation</option>
            <option>Practice-driven</option>
            <option>Mentorship / pairing</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label>Related career goal</label>
        <input className="input" value={f.related_goal} onChange={set('related_goal')} placeholder="e.g. Solutions Architect" />
      </div>
      <div className="flex" style={{ justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={submit} disabled={busy || !f.name}>
          <Target size={15} /> {busy ? 'Generating roadmap…' : 'Create & generate roadmap'}
        </button>
      </div>
    </Modal>
  )
}

function GoalDetail({ id }) {
  const nav = useNavigate()
  const [goal, setGoal] = useState(null)
  const [editing, setEditing] = useState(false)

  const load = () => api.goal(id).then(setGoal)
  useEffect(() => { load() }, [id])

  const regenerate = async () => {
    if (!confirm('Regenerate this roadmap? Existing topic progress will be reset.')) return
    setGoal(await api.regenerateRoadmap(id))
  }
  const del = async () => {
    if (!confirm('Delete this goal and its roadmap?')) return
    await api.delGoal(id)
    nav('/goals')
  }

  if (!goal) return <Spinner />

  const statusTone = { completed: 'green', active: 'blue', not_started: 'gray', locked: 'gray', needs_review: 'amber', in_progress: 'violet' }

  return (
    <div>
      <button className="btn ghost sm mb" onClick={() => nav('/goals')}><ArrowLeft size={14} /> All goals</button>
      <div className="flex-between mb" style={{ alignItems: 'flex-start' }}>
        <div>
          <h2 className="section-title" style={{ fontSize: 22 }}>{goal.name}</h2>
          <p className="muted small" style={{ maxWidth: 640 }}>{goal.description}</p>
          <div className="flex mt" style={{ gap: 10, flexWrap: 'wrap' }}>
            <Badge tone={goal.status === 'active' ? 'green' : 'gray'}>{goal.status}</Badge>
            <Badge tone={goal.priority === 'High' ? 'red' : goal.priority === 'Medium' ? 'amber' : 'gray'}>{goal.priority} priority</Badge>
            {goal.deadline && <Badge tone="blue">Deadline {goal.deadline}</Badge>}
            <Badge tone="gray">{goal.current_level} → {goal.target_level}</Badge>
          </div>
        </div>
        <div className="flex" style={{ gap: 8 }}>
          <button className="btn" onClick={regenerate}><RefreshCw size={14} /> Regenerate</button>
          <button className="btn" onClick={() => setEditing(true)}>Edit</button>
          <button className="btn danger" onClick={del}><Trash2 size={14} /></button>
        </div>
      </div>

      <div className="mb flex" style={{ gap: 14 }}>
        <div style={{ flex: 1 }}><Bar value={goal.progress} /></div>
        <span className="mono small faint">{Math.round(goal.progress)}%</span>
      </div>

      {goal.why && (
        <Card className="mb">
          <div className="small faint" style={{ textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Why this matters</div>
          <div>{goal.why}</div>
          {goal.target_outcome && <div className="mt small muted">🎯 Outcome: {goal.target_outcome}</div>}
        </Card>
      )}

      <div className="grid cols-2">
        {goal.phases.map((p) => (
          <Card key={p.id} title={`Phase ${p.phase_number} — ${p.title}`} sub={p.description}
            actions={<Badge tone={statusTone[p.status] || 'gray'}>{p.status}</Badge>}>
            <div className="mb flex" style={{ gap: 10 }}>
              <Bar value={p.progress || 0} />
              <span className="mono small faint">{p.progress || 0}%</span>
            </div>
            {goal.topics.filter((t) => t.phase_id === p.id).map((t) => (
              <div key={t.id} className="flex-between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="flex" style={{ gap: 10 }}>
                  <span className="ttype" style={{ background: levelColor(t.difficulty) }} />
                  <span className="small" style={{ fontWeight: t.status === 'completed' ? 400 : 600, textDecoration: t.status === 'completed' ? 'line-through' : 'none', color: t.status === 'completed' ? 'var(--text-faint)' : 'var(--text)' }}>
                    {t.name}
                  </span>
                </div>
                <div className="flex" style={{ gap: 8 }}>
                  <span className="mono small faint">{t.estimated_minutes}m</span>
                  <Badge tone={statusTone[t.status] || 'gray'}>{t.status.replace('_', ' ')}</Badge>
                </div>
              </div>
            ))}
            {goal.topics.filter((t) => t.phase_id === p.id).length === 0 && (
              <div className="small faint">No topics in this phase yet.</div>
            )}
          </Card>
        ))}
      </div>

      {editing && <EditGoal goal={goal} onClose={() => setEditing(false)} onDone={() => { setEditing(false); load() }} />}
    </div>
  )
}

function EditGoal({ goal, onClose, onDone }) {
  const [f, setF] = useState({ ...goal })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    await api.saveGoal(goal.id, { name: f.name, description: f.description, why: f.why, target_outcome: f.target_outcome, priority: f.priority, deadline: f.deadline, hours_per_week: +f.hours_per_week, preferred_method: f.preferred_method, related_goal: f.related_goal })
    onDone()
  }
  return (
    <Modal title="Edit goal" onClose={onClose}>
      <div className="field"><label>Name</label><input className="input" value={f.name} onChange={set('name')} /></div>
      <div className="field"><label>Description</label><textarea className="textarea" value={f.description} onChange={set('description')} /></div>
      <div className="field"><label>Why this matters</label><input className="input" value={f.why} onChange={set('why')} /></div>
      <div className="field"><label>Target outcome</label><input className="input" value={f.target_outcome} onChange={set('target_outcome')} /></div>
      <div className="row2">
        <div className="field"><label>Priority</label>
          <select className="select" value={f.priority} onChange={set('priority')}><option>High</option><option>Medium</option><option>Low</option></select>
        </div>
        <div className="field"><label>Deadline</label><input className="input" type="date" value={f.deadline || ''} onChange={set('deadline')} /></div>
      </div>
      <div className="flex" style={{ justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={save}>Save</button>
      </div>
    </Modal>
  )
}
