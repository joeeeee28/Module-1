import React from 'react'
import { X, Check } from 'lucide-react'

export function Card({ title, sub, actions, children, className = '', flat }) {
  if (flat) return <div className={`card flat ${className}`}>{children}</div>
  return (
    <div className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div className="row">
            {title && <h3 className="card-title">{title}</h3>}
            {sub && <span className="card-sub">{sub}</span>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}

export function Kpi({ icon, value, unit, label, delta }) {
  return (
    <div className="card kpi">
      <div className="icon">{icon}</div>
      <div className="val">
        {value}
        {unit && <span className="unit"> {unit}</span>}
      </div>
      <div className="lbl">{label}</div>
      {delta && <div className={`delta ${delta.startsWith('-') ? 'neg' : ''}`}>{delta}</div>}
    </div>
  )
}

export function Bar({ value, thin, color }) {
  return (
    <div className={`bar ${thin ? 'thin' : ''}`}>
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: color }} />
    </div>
  )
}

export function ProgressRow({ name, value, color }) {
  return (
    <div className="progress-row">
      <span className="name">{name}</span>
      <Bar value={value} color={color} />
      <span className="pct">{Math.round(value)}%</span>
    </div>
  )
}

export function Badge({ children, tone = 'gray' }) {
  return <span className={`badge ${tone}`}>{children}</span>
}

export function Modal({ title, sub, onClose, children, wide }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`}>
        <div className="modal-head">
          <div>
            <h2>{title}</h2>
            {sub && <div className="muted small">{sub}</div>}
          </div>
          <button className="btn icon ghost" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Stars({ value, onChange }) {
  return (
    <div className="stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} className={n <= value ? 'lit' : ''} onClick={() => onChange && onChange(n)}>
          ★
        </button>
      ))}
    </div>
  )
}

export function Empty({ icon, text, children }) {
  return (
    <div className="empty">
      <div className="icon">{icon}</div>
      <div>{text}</div>
      {children && <div className="mt">{children}</div>}
    </div>
  )
}

export function Segmented({ options, value, onChange }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Spinner() {
  return <div className="flex" style={{ justifyContent: 'center', padding: 30 }}>Loading…</div>
}

export function TaskCheck({ done, onClick }) {
  return (
    <button className="tcheck" onClick={onClick} aria-label="toggle">
      {done && <Check />}
    </button>
  )
}

export function levelColor(level) {
  const m = (level || '').toLowerCase()
  if (m === 'expert') return '#34d399'
  if (m === 'advanced') return '#22d3ee'
  if (m === 'intermediate') return '#8b5cf6'
  if (m === 'beginner') return '#fbbf24'
  return '#6b7488'
}

export function masteryTone(m) {
  if (m >= 70) return 'green'
  if (m >= 45) return 'blue'
  if (m >= 20) return 'amber'
  return 'red'
}
