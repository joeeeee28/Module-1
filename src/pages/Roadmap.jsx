import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowDown, Clock, CheckCircle2, Pencil, Lock, AlertTriangle, Play } from 'lucide-react'
import { api } from '../api.js'
import { Card, Badge, Modal, Spinner, Empty, levelColor } from '../components.jsx'

const statusTone = { completed: 'green', active: 'blue', not_started: 'gray', locked: 'gray', needs_review: 'amber', in_progress: 'violet' }

export default function Roadmap() {
  const { id } = useParams()
  const nav = useNavigate()
  const [goals, setGoals] = useState(null)
  const [goal, setGoal] = useState(null)
  const [selected, setSelected] = useState(null)

  const loadGoals = () => api.goals().then(setGoals)
  useEffect(() => { loadGoals() }, [])

  useEffect(() => {
    const gid = id || (goals && goals.find((g) => g.status === 'active')?.id) || goals?.[0]?.id
    if (gid) {
      if (!id) nav(`/roadmap/${gid}`, { replace: true })
      api.goal(gid).then(setGoal)
    }
  }, [id, goals])

  if (!goals || !goal) return <Spinner />

  const phaseState = (p) => {
    const topics = goal.topics.filter((t) => t.phase_id === p.id)
    if (topics.every((t) => t.status === 'completed')) return 'done'
    if (topics.some((t) => t.status === 'needs_review')) return 'review'
    if (p.status === 'active') return 'active'
    return ''
  }

  return (
    <div>
      <div className="flex-between mb">
        <div>
          <h2 className="section-title">Learning Roadmap</h2>
          <p className="muted small" style={{ margin: '-8px 0 0' }}>Your AI-generated path from current level to mastery.</p>
        </div>
        <select className="select" style={{ maxWidth: 320 }} value={goal.id} onChange={(e) => nav(`/roadmap/${e.target.value}`)}>
          {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
      </div>

      {goal.topics.length === 0 && (
        <Empty icon="🗺️" text="No roadmap yet.">
          <button className="btn primary" onClick={() => api.regenerateRoadmap(goal.id).then(setGoal)}>Generate roadmap</button>
        </Empty>
      )}

      <div className="roadmap">
        {goal.phases.map((p, pi) => {
          const state = phaseState(p)
          const topics = goal.topics.filter((t) => t.phase_id === p.id)
          return (
            <div key={p.id} className={`roadmap-node ${state}`} onClick={() => setSelected({ phase: p })}>
              <span className="dot" />
              <div className="flex-between">
                <div className="flex" style={{ gap: 12 }}>
                  <div className="avatar" style={{ width: 36, height: 36, fontSize: 13 }}>{p.phase_number}</div>
                  <div>
                    <div className="flex" style={{ gap: 8 }}>
                      <span style={{ fontWeight: 700 }}>{p.title}</span>
                      {state === 'done' && <CheckCircle2 size={16} style={{ color: 'var(--green)' }} />}
                      {state === 'review' && <AlertTriangle size={16} style={{ color: 'var(--amber)' }} />}
                      {state === 'active' && <Play size={16} style={{ color: 'var(--accent-3)' }} />}
                      {p.status === 'locked' && state !== 'done' && <Lock size={14} className="faint" />}
                    </div>
                    <div className="small faint">{p.description}</div>
                  </div>
                </div>
                <div className="flex" style={{ gap: 12 }}>
                  <span className="mono small faint"><Clock size={12} style={{ verticalAlign: -2 }} /> {p.estimated_minutes}m</span>
                  <span className="mono small faint">{p.progress || 0}%</span>
                </div>
              </div>

              {topics.length > 0 && (
                <div className="grid cols-2 mt" style={{ gap: 10 }}>
                  {topics.map((t) => (
                    <div
                      key={t.id}
                      className="flex-between small"
                      style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--bg-2)', border: '1px solid var(--border)', cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); setSelected({ topic: t }) }}
                    >
                      <span className="flex" style={{ gap: 8, minWidth: 0 }}>
                        <span className="ttype" style={{ background: levelColor(t.difficulty) }} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.name}</span>
                      </span>
                      <Badge tone={statusTone[t.status] || 'gray'}>{t.status.replace('_', ' ')}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {selected?.topic && (
        <TopicModal topic={selected.topic} goalName={goal.name} onClose={() => setSelected(null)} onSaved={(t) => { setGoal({ ...goal, topics: goal.topics.map((x) => (x.id === t.id ? t : x)) }) }} />
      )}
    </div>
  )
}

function TopicModal({ topic, goalName, onClose, onSaved }) {
  const [t, setT] = useState({ ...topic })
  const [edit, setEdit] = useState(false)
  const concepts = typeof t.concepts_json === 'string' ? JSON.parse(t.concepts_json || '[]') : t.concepts_json || []
  const exercises = typeof t.exercises_json === 'string' ? JSON.parse(t.exercises_json || '[]') : t.exercises_json || []
  const success = typeof t.success_criteria_json === 'string' ? JSON.parse(t.success_criteria_json || '[]') : t.success_criteria_json || []

  const save = async () => {
    const saved = await api.saveTopic(t.id, {
      name: t.name, description: t.description, difficulty: t.difficulty, estimated_minutes: +t.estimated_minutes,
      concepts: (typeof t.concepts_json === 'string' ? JSON.parse(t.concepts_json || '[]') : t.concepts_json),
      exercises: (typeof t.exercises_json === 'string' ? JSON.parse(t.exercises_json || '[]') : t.exercises_json),
      project: t.project,
    })
    onSaved(saved)
    setEdit(false)
  }

  const set = (k) => (e) => setT({ ...t, [k]: e.target.value })

  return (
    <Modal title={t.name} sub={`${goalName} · ${t.difficulty} · ${t.estimated_minutes} min`} onClose={onClose} wide>
      {!edit ? (
        <div>
          <p className="muted small">{t.description}</p>
          {concepts.length > 0 && (
            <>
              <div className="small faint mt" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Concepts</div>
              <div className="grid cols-2 mt" style={{ gap: 6 }}>
                {concepts.map((c, i) => <div key={i} className="small">• {c}</div>)}
              </div>
            </>
          )}
          {exercises.length > 0 && (
            <>
              <div className="small faint mt" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Exercises</div>
              <div className="mt" style={{ gap: 6, display: 'grid' }}>
                {exercises.map((e, i) => <div key={i} className="small">• {e}</div>)}
              </div>
            </>
          )}
          {t.project && (
            <>
              <div className="small faint mt" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Project</div>
              <p className="small mt">{t.project}</p>
            </>
          )}
          {success.length > 0 && (
            <>
              <div className="small faint mt" style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}>Success criteria</div>
              <div className="mt" style={{ gap: 6, display: 'grid' }}>
                {success.map((s, i) => <div key={i} className="small">✓ {s}</div>)}
              </div>
            </>
          )}
          <div className="flex mt-lg" style={{ justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn" onClick={() => setEdit(true)}><Pencil size={14} /> Edit</button>
            <button className="btn primary" onClick={onClose}>Done</button>
          </div>
        </div>
      ) : (
        <div>
          <div className="field"><label>Name</label><input className="input" value={t.name} onChange={set('name')} /></div>
          <div className="field"><label>Description</label><textarea className="textarea" value={t.description} onChange={set('description')} /></div>
          <div className="row3">
            <div className="field"><label>Difficulty</label>
              <select className="select" value={t.difficulty} onChange={set('difficulty')}>
                <option>beginner</option><option>intermediate</option><option>advanced</option><option>expert</option>
              </select>
            </div>
            <div className="field"><label>Estimated minutes</label><input className="input" type="number" value={t.estimated_minutes} onChange={set('estimated_minutes')} /></div>
          </div>
          <div className="field"><label>Concepts (one per line)</label>
            <textarea className="textarea" value={concepts.join('\n')} onChange={(e) => setT({ ...t, concepts_json: e.target.value.split('\n') })} />
          </div>
          <div className="field"><label>Exercises (one per line)</label>
            <textarea className="textarea" value={exercises.join('\n')} onChange={(e) => setT({ ...t, exercises_json: e.target.value.split('\n') })} />
          </div>
          <div className="field"><label>Project</label><textarea className="textarea" value={t.project || ''} onChange={set('project')} /></div>
          <div className="flex" style={{ justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn" onClick={() => setEdit(false)}>Cancel</button>
            <button className="btn primary" onClick={save}>Save</button>
          </div>
        </div>
      )}
    </Modal>
  )
}
