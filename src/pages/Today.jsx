import React, { useEffect, useState } from 'react'
import { RefreshCw, Check, Clock, Flame, BookOpen, Wrench, Hammer, HelpCircle, RotateCcw, CheckCircle2, Play, Square } from 'lucide-react'
import { api } from '../api.js'
import { Card, Bar, Badge, Modal, Stars, Spinner, TaskCheck } from '../components.jsx'

const TYPE_META = {
  learn: { label: 'Learn', color: 'var(--accent)', icon: <BookOpen size={15} /> },
  practice: { label: 'Practice', color: 'var(--accent-3)', icon: <Wrench size={15} /> },
  build: { label: 'Build', color: 'var(--accent-2)', icon: <Hammer size={15} /> },
  test: { label: 'Test', color: 'var(--pink)', icon: <HelpCircle size={15} /> },
  revise: { label: 'Revise', color: 'var(--amber)', icon: <RotateCcw size={15} /> },
}

export default function Today() {
  const [data, setData] = useState(null)
  const [reflecting, setReflecting] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => api.today().then(setData)
  useEffect(() => { load() }, [])

  const refresh = async () => {
    setBusy(true)
    try {
      const d = await api.generatePlan()
      setData(d)
    } finally {
      setBusy(false)
    }
  }

  const complete = async (task, reflection) => {
    await api.completeTask(task.id, reflection)
    setReflecting(null)
    load()
  }

  const skip = async (task) => {
    await api.setTaskStatus(task.id, 'skipped')
    load()
  }

  if (!data) return <Spinner />
  const { plan, tasks, briefing: b } = data
  const done = tasks.filter((t) => t.status === 'completed').length
  const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0

  return (
    <div>
      <SessionTracker />
      {/* header */}
      <div className="grid cols-2 mb" style={{ gridTemplateColumns: '1.6fr 1fr' }}>
        <Card>
          <div className="flex-between">
            <div>
              <div className="card-title" style={{ fontSize: 18 }}>Today's Mission — {b?.topic || plan.topic}</div>
              <div className="card-sub">{b?.objective || plan.objective}</div>
            </div>
            <Badge tone="blue">{b?.estimatedMinutes || plan.estimated_minutes} min</Badge>
          </div>
          <div className="mt flex" style={{ gap: 14 }}>
            <div style={{ flex: 1 }}><Bar value={pct} /></div>
            <span className="mono small faint">{done}/{tasks.length} done</span>
          </div>
          {b?.successCriteria?.length > 0 && (
            <div className="mt">
              <div className="small faint" style={{ marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Success criteria</div>
              <div className="grid cols-2">
                {b.successCriteria.map((s, i) => (
                  <div key={i} className="small flex" style={{ gap: 8 }}>
                    <CheckCircle2 size={14} style={{ color: 'var(--green)' }} /> {s}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mt flex" style={{ gap: 8 }}>
            <button className="btn" onClick={refresh} disabled={busy}>
              <RefreshCw size={15} className={busy ? 'spin' : ''} /> Regenerate plan
            </button>
            {b?.streak > 0 && (
              <span className="flex small muted" style={{ marginLeft: 'auto' }}>
                <Flame size={15} style={{ color: 'var(--amber)' }} /> {b.streak}-day streak
              </span>
            )}
          </div>
        </Card>

        <Card title="How today works">
          <p className="small muted" style={{ margin: 0 }}>
            Complete each block in order. When you finish a task, I'll ask a quick reflection — your
            confidence and difficulty feedback adapt tomorrow's plan automatically.
          </p>
          <div className="mt">
            {Object.values(TYPE_META).map((m) => (
              <div key={m.label} className="flex small" style={{ padding: '5px 0' }}>
                <span className="badge gray" style={{ gap: 6 }}>{m.icon}{m.label}</span>
                <span className="faint">
                  {m.label === 'Learn' ? 'Study the core concepts' : m.label === 'Practice' ? 'Hands-on exercise' : m.label === 'Build' ? 'Apply / mini project' : m.label === 'Test' ? 'Verify understanding' : 'Spaced-repetition review'}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* tasks */}
      {tasks.map((t) => {
        const meta = TYPE_META[t.type] || TYPE_META.learn
        const isDone = t.status === 'completed'
        const isSkipped = t.status === 'skipped'
        return (
          <div key={t.id} className={`task ${isDone ? 'done' : ''}`} style={{ opacity: isSkipped ? 0.5 : 1 }}>
            <span className="ttype" style={{ background: meta.color }} />
            <TaskCheck done={isDone} onClick={() => !isDone && !isSkipped && setReflecting(t)} />
            <div className="tmain">
              <div className="ttitle">{t.title}</div>
              {t.description && <div className="tdesc">{t.description}</div>}
            </div>
            <span className="badge gray" style={{ gap: 5 }}>{meta.icon}{meta.label}</span>
            <span className="tdur">{t.duration}m</span>
            {!isDone && !isSkipped && (
              <button className="btn sm ghost" onClick={() => skip(t)}>Skip</button>
            )}
            {isSkipped && <Badge tone="red">Skipped</Badge>}
            {isDone && <Check size={18} style={{ color: 'var(--green)' }} />}
          </div>
        )
      })}

      {reflecting && (
        <ReflectModal task={reflecting} onClose={() => setReflecting(null)} onSubmit={(r) => complete(reflecting, r)} />
      )}
    </div>
  )
}

function SessionTracker() {
  const [session, setSession] = useState(null)
  const [topicName, setTopicName] = useState('')
  const [elapsed, setElapsed] = useState(0)
  const [ending, setEnding] = useState(false)

  const load = () => api.activeSession().then((s) => setSession(s || null))
  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!session?.started_at) return
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - new Date(session.started_at).getTime()) / 1000)))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [session?.started_at])

  const start = async () => {
    const s = await api.startSession({ topic_name: topicName || undefined })
    setSession(s)
    setTopicName('')
  }
  const end = async (reflection) => {
    await api.endSession(session.id, reflection)
    setSession(null)
    setEnding(false)
    setElapsed(0)
  }

  if (!session) {
    return (
      <Card className="mb" title="Start a learning session" sub="Track real time spent and capture reflection at the end">
        <div className="flex" style={{ gap: 10 }}>
          <input className="input" style={{ flex: 1 }} placeholder="What are you learning? (optional)" value={topicName} onChange={(e) => setTopicName(e.target.value)} />
          <button className="btn primary" onClick={start}><Play size={15} /> Start learning</button>
        </div>
      </Card>
    )
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0')
  const ss = String(elapsed % 60).padStart(2, '0')

  return (
    <Card className="mb">
      <div className="flex-between">
        <div className="flex" style={{ gap: 12 }}>
          <span className="badge green" style={{ gap: 6 }}>
            <span className="dot" style={{ width: 8, height: 8, borderRadius: 50, background: 'var(--green)', animation: 'pulse 1.5s infinite', display: 'inline-block' }} />
            In progress
          </span>
          <b>{session.topic_name || 'Learning session'}</b>
        </div>
        <div className="flex" style={{ gap: 12, alignItems: 'center' }}>
          <span className="mono" style={{ fontSize: 22, fontWeight: 700 }}>{mm}:{ss}</span>
          <button className="btn danger" onClick={() => setEnding(true)}><Square size={15} /> End session</button>
        </div>
      </div>
      {ending && <EndSessionModal onClose={() => setEnding(false)} onSubmit={end} />}
    </Card>
  )
}

function EndSessionModal({ onClose, onSubmit }) {
  const [confidence, setConfidence] = useState(3)
  const [difficulty, setDifficulty] = useState('medium')
  const [understood, setUnderstood] = useState('yes')
  const [difficult, setDifficult] = useState('')
  const [needHelp, setNeedHelp] = useState(false)
  const [learned, setLearned] = useState('')

  return (
    <Modal title="End session — how did it go?" onClose={onClose}>
      <div className="field">
        <label>Did you understand the topic?</label>
        <select className="select" value={understood} onChange={(e) => setUnderstood(e.target.value)}>
          <option value="yes">Yes, clearly</option>
          <option value="partial">Partially</option>
          <option value="no">No, I'm confused</option>
        </select>
      </div>
      <div className="field">
        <label>Confidence</label>
        <div className="flex" style={{ gap: 10 }}><Stars value={confidence} onChange={setConfidence} /><span className="small muted">{confidence}/5</span></div>
      </div>
      <div className="row2">
        <div className="field"><label>Difficulty</label>
          <select className="select" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
          </select>
        </div>
        <div className="field"><label>What was difficult?</label>
          <input className="input" value={difficult} onChange={(e) => setDifficult(e.target.value)} placeholder="e.g. error handling" />
        </div>
      </div>
      <div className="field"><label>What did you learn?</label>
        <textarea className="textarea" value={learned} onChange={(e) => setLearned(e.target.value)} placeholder="Key takeaways…" /></div>
      <div className="field">
        <label className="flex" style={{ gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={needHelp} onChange={(e) => setNeedHelp(e.target.checked)} /> I'd like extra help on this
        </label>
      </div>
      <div className="flex" style={{ justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn" onClick={onClose}>Keep going</button>
        <button className="btn primary" onClick={() => onSubmit({ confidence, difficulty, understood: understood === 'yes' ? 1 : understood === 'partial' ? 0 : -1, difficult, need_help: needHelp ? 1 : 0, learned })}>
          Save session
        </button>
      </div>
    </Modal>
  )
}

function ReflectModal({ task, onClose, onSubmit }) {
  const [confidence, setConfidence] = useState(3)
  const [difficulty, setDifficulty] = useState('medium')
  const [minutes, setMinutes] = useState(task.duration)
  const [learned, setLearned] = useState('')
  const [notes, setNotes] = useState('')

  return (
    <Modal title="How did it go?" sub={task.title} onClose={onClose}>
      <div className="field">
        <label>Confidence — how well did you understand it?</label>
        <div className="flex" style={{ gap: 10 }}>
          <Stars value={confidence} onChange={setConfidence} />
          <span className="small muted">{confidence}/5</span>
        </div>
      </div>
      <div className="row2">
        <div className="field">
          <label>Difficulty</label>
          <select className="select" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
        </div>
        <div className="field">
          <label>Actual time spent (minutes)</label>
          <input className="input" type="number" value={minutes} onChange={(e) => setMinutes(+e.target.value)} min={1} />
        </div>
      </div>
      <div className="field">
        <label>What did you learn?</label>
        <textarea className="textarea" value={learned} onChange={(e) => setLearned(e.target.value)} placeholder="One or two key takeaways…" />
      </div>
      <div className="field">
        <label>Notes / questions</label>
        <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything to remember or ask…" />
      </div>
      <div className="flex" style={{ justifyContent: 'flex-end', gap: 10 }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          onClick={() => onSubmit({ status: 'completed', confidence, difficulty, actual_minutes: minutes, learned, notes })}
        >
          <Clock size={15} /> Complete task
        </button>
      </div>
    </Modal>
  )
}
