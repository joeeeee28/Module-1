import React, { useEffect, useState } from 'react'
import { Plus, GraduationCap, Check, X } from 'lucide-react'
import { api } from '../api.js'
import { Card, Badge, Spinner, Empty } from '../components.jsx'

const KINDS = [
  { value: 'quick', label: 'Quick Quiz', desc: '5 questions' },
  { value: 'concept', label: 'Concept Test', desc: '10 questions' },
  { value: 'practical', label: 'Practical Challenge', desc: 'Real-world problem' },
  { value: 'debug', label: 'Debugging Challenge', desc: 'Fix broken code' },
  { value: 'scenario', label: 'Scenario Challenge', desc: 'Business/technical scenario' },
]

export default function Assessments() {
  const [list, setList] = useState(null)
  const [goals, setGoals] = useState([])
  const [active, setActive] = useState(null)
  const [answers, setAnswers] = useState({})
  const [result, setResult] = useState(null)

  useEffect(() => {
    api.assessments().then(setList)
    api.goals().then(setGoals)
  }, [])

  const generate = async (kind, goal_id) => {
    const a = await api.generateAssessment({ kind, goal_id })
    setActive(a)
    setAnswers({})
    setResult(null)
  }

  const grade = async () => {
    const arr = active.questions.map((q, i) => answers[i])
    const r = await api.grade(active.id, arr)
    setResult(r)
    api.assessments().then(setList)
  }

  if (!list || !goals.length && !list) return <Spinner />

  return (
    <div>
      <div className="mb">
        <h2 className="section-title">Knowledge Assessments</h2>
        <p className="muted small" style={{ margin: '-8px 0 0' }}>Scores feed directly into your mastery levels.</p>
      </div>

      {active ? (
        <AssessmentView assessment={active} answers={answers} setAnswers={setAnswers} result={result} onGrade={grade} onClose={() => setActive(null)} />
      ) : (
        <div className="grid cols-2" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
          <Card title="Start an assessment" sub="Choose a goal and assessment type">
            <div className="grid cols-2" style={{ gap: 10 }}>
              {KINDS.map((k) => (
                <div key={k.value} className="small" style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-2)' }}>
                  <div style={{ fontWeight: 600 }}>{k.label}</div>
                  <div className="faint" style={{ fontSize: 12 }}>{k.desc}</div>
                  <button className="btn sm primary mt" onClick={() => generate(k.value, goals[0]?.id)}>Start</button>
                </div>
              ))}
            </div>
          </Card>

          <Card title="History" sub={`${list.length} assessments`}>
            {list.length === 0 && <div className="muted small">No assessments taken yet.</div>}
            {list.map((a) => (
              <div key={a.id} className="flex-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div className="small" style={{ fontWeight: 600 }}>{a.title}</div>
                  <div className="faint" style={{ fontSize: 11 }}>{a.kind} · {a.date}</div>
                </div>
                {a.completed ? (
                  <Badge tone={a.score / (a.max_score || 1) >= 0.7 ? 'green' : a.score / (a.max_score || 1) >= 0.4 ? 'amber' : 'red'}>
                    {a.score}/{a.max_score}
                  </Badge>
                ) : (
                  <Badge tone="gray">pending</Badge>
                )}
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  )
}

function AssessmentView({ assessment, answers, setAnswers, result, onGrade, onClose }) {
  const qs = assessment.questions
  return (
    <Card
      title={assessment.title}
      sub={`${assessment.kind} · ${assessment.difficulty}`}
      actions={<button className="btn sm" onClick={onClose}>Close</button>}
    >
      {result ? (
        <div style={{ textAlign: 'center', padding: 30 }}>
          <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-0.03em', color: result.pct >= 70 ? 'var(--green)' : result.pct >= 40 ? 'var(--amber)' : 'var(--red)' }}>
            {result.pct}%
          </div>
          <div className="muted">Score {result.score}/{result.max}</div>
          <p className="muted small mt">
            {result.pct >= 70
              ? 'Great work! This boosts your mastery score.'
              : result.pct >= 40
                ? 'Solid effort — I\'ve scheduled a revision to reinforce the weak spots.'
                : 'This topic needs reinforcement — I\'ve added it to your revision queue.'}
          </p>
          <button className="btn primary mt" onClick={onClose}>Done</button>
        </div>
      ) : (
        <div>
          {qs.map((q, i) => (
            <div key={i} className="mb">
              <div className="small" style={{ fontWeight: 600, marginBottom: 8 }}>{i + 1}. {q.prompt}</div>
              {q.type === 'mcq' ? (
                q.options.map((o, j) => (
                  <label key={j} className="flex" style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 6, cursor: 'pointer', background: answers[i] === j ? 'var(--surface-2)' : 'transparent' }}>
                    <input type="radio" name={`q${i}`} checked={answers[i] === j} onChange={() => setAnswers({ ...answers, [i]: j })} style={{ marginRight: 10 }} />
                    <span className="small">{o.text}</span>
                  </label>
                ))
              ) : (
                <textarea className="textarea" placeholder="Write your answer / approach…" value={answers[i] || ''} onChange={(e) => setAnswers({ ...answers, [i]: e.target.value })} />
              )}
            </div>
          ))}
          <div className="flex" style={{ justifyContent: 'flex-end', gap: 10 }}>
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn primary" onClick={onGrade}><Check size={15} /> Submit</button>
          </div>
        </div>
      )}
    </Card>
  )
}
