import React, { createContext, useContext, useEffect, useState } from 'react'
import { Routes, Route, Navigate, NavLink, useLocation, Link, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Sun, Target, Route as RouteIcon, Layers, Calendar, Link2,
  StickyNote, GraduationCap, TrendingUp, Sparkles, ClipboardList, Settings,
  Menu, LogOut, Sparkle, Activity, Bell,
} from 'lucide-react'
import { api, getToken, setToken } from './api.js'
import Dashboard from './pages/Dashboard.jsx'
import Today from './pages/Today.jsx'
import Goals from './pages/Goals.jsx'
import Roadmap from './pages/Roadmap.jsx'
import SkillsPage from './pages/Skills.jsx'
import CalendarPage from './pages/Calendar.jsx'
import Resources from './pages/Resources.jsx'
import Notes from './pages/Notes.jsx'
import Assessments from './pages/Assessments.jsx'
import Progress from './pages/Progress.jsx'
import Coach from './pages/Coach.jsx'
import Review from './pages/Review.jsx'
import SettingsPage from './pages/Settings.jsx'
import AgentActivity from './pages/AgentActivity.jsx'
import Notifications from './pages/Notifications.jsx'
import NotificationSettings from './pages/NotificationSettings.jsx'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

const NAV = [
  { group: 'Overview', items: [
    { to: '/', icon: <LayoutDashboard />, label: 'Dashboard', end: true },
    { to: '/today', icon: <Sun />, label: "Today's Learning" },
    { to: '/progress', icon: <TrendingUp />, label: 'Progress' },
  ]},
  { group: 'Learning', items: [
    { to: '/goals', icon: <Target />, label: 'My Goals' },
    { to: '/roadmap', icon: <RouteIcon />, label: 'Learning Roadmap' },
    { to: '/skills', icon: <Layers />, label: 'Skills' },
    { to: '/assessments', icon: <GraduationCap />, label: 'Assessments' },
  ]},
  { group: 'Organize', items: [
    { to: '/calendar', icon: <Calendar />, label: 'Calendar' },
    { to: '/resources', icon: <Link2 />, label: 'Resources' },
    { to: '/notes', icon: <StickyNote />, label: 'Notes' },
  ]},
  { group: 'Insight', items: [
    { to: '/coach', icon: <Sparkles />, label: 'AI Coach' },
    { to: '/review', icon: <ClipboardList />, label: 'Weekly Review' },
    { to: '/activity', icon: <Activity />, label: 'Agent Activity' },
    { to: '/notifications', icon: <Bell />, label: 'Notifications' },
  ]},
  { group: '', items: [
    { to: '/settings', icon: <Settings />, label: 'Settings' },
    { to: '/notification-settings', icon: <Bell />, label: 'Notification Settings' },
  ]},
]

function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ;(async () => {
      if (!getToken()) { setLoading(false); return }
      try {
        const { user } = await api.me()
        setUser(user)
      } catch {
        setToken(null)
      }
      setLoading(false)
    })()
  }, [])

  const login = async (email, password) => {
    const { token, user } = await api.login(email, password)
    setToken(token)
    setUser(user)
  }
  const signup = async (name, email, password, timezone) => {
    const { token, user } = await api.signup(name, email, password, timezone)
    setToken(token)
    setUser(user)
  }
  const logout = () => { setToken(null); setUser(null) }

  return <AuthContext.Provider value={{ user, loading, login, signup, logout }}>{children}</AuthContext.Provider>
}

function Layout() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const loc = useLocation()

  const titles = {
    '/': 'Dashboard', '/today': "Today's Learning", '/goals': 'My Goals',
    '/roadmap': 'Learning Roadmap', '/skills': 'Skills', '/calendar': 'Calendar',
    '/resources': 'Resources', '/notes': 'Notes', '/assessments': 'Assessments',
    '/progress': 'Progress', '/coach': 'AI Coach', '/review': 'Weekly Review',
    '/activity': 'Agent Activity', '/settings': 'Settings',
  }
  const title = titles[loc.pathname] || (loc.pathname.startsWith('/goals/') ? 'Goal details' : 'LearnMate')

  return (
    <div className="app">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <Link to="/" className="logo" onClick={() => setOpen(false)}>
          <div className="mark"><Sparkle size={18} /></div>
          <div className="name">LearnMate <span>· AI Coach</span></div>
        </Link>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {NAV.map((g, i) => (
            <div className="nav-group" key={i}>
              {g.group && <div className="label">{g.group}</div>}
              {g.items.map((it) => (
                <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`} onClick={() => setOpen(false)}>
                  {it.icon}
                  <span>{it.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </div>
        <div className="user-chip">
          <div className="avatar">{user?.name?.[0] || '?'}</div>
          <div className="meta">
            <div className="n">{user?.name || 'User'}</div>
            <div className="r">{user?.target_role || user?.role || ''}</div>
          </div>
          <button className="btn icon ghost" style={{ marginLeft: 'auto' }} onClick={logout} title="Log out">
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <div className="main">
        <div className="topbar">
          <div className="flex">
            <button className="btn icon ghost mobile-toggle" onClick={() => setOpen(!open)}>
              <Menu size={20} />
            </button>
            <div>
              <h1>{title}</h1>
            </div>
          </div>
          <div className="flex gap-lg">
            {user && <span className="muted small">Hi {user.name.split(' ')[0]} 👋</span>}
            <NotificationsBell />
          </div>
        </div>
        <div className="content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/today" element={<Today />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/goals/:id" element={<Goals />} />
            <Route path="/roadmap" element={<Roadmap />} />
            <Route path="/roadmap/:id" element={<Roadmap />} />
            <Route path="/skills" element={<SkillsPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/resources" element={<Resources />} />
            <Route path="/notes" element={<Notes />} />
            <Route path="/assessments" element={<Assessments />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/coach" element={<Coach />} />
            <Route path="/review" element={<Review />} />
            <Route path="/activity" element={<AgentActivity />} />
            <Route path="/notifications" element={<Notifications />} />
            <Route path="/notification-settings" element={<NotificationSettings />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  )
}

function Login() {
  const { login, signup } = useAuth()
  const [mode, setMode] = useState('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [cfg, setCfg] = useState(null)

  useEffect(() => {
    api.config().then(setCfg).catch(() => {})
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      if (mode === 'login') await login(email, password)
      else await signup(name, email, password, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')
    } catch (err) {
      setError(err.message)
    }
    setBusy(false)
  }

  return (
    <div className="login-wrap">
      <div className="login-card card">
        <div className="logo">
          <div className="mark"><Sparkle size={20} /></div>
          <div className="name">LearnMate</div>
        </div>
        <p className="muted small" style={{ textAlign: 'center', marginTop: -8 }}>
          Your personal AI learning coach, planner & accountability partner.
        </p>
        <form onSubmit={submit} className="mt-lg">
          {mode === 'signup' && (
            <div className="field">
              <label>Name</label>
              <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
          </div>
          <div className="field">
            <label>Password</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          </div>
          {error && <div className="small" style={{ color: 'var(--red)', marginBottom: 10 }}>{error}</div>}
          <button className="btn primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
            {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <div className="hint">
          {mode === 'login' ? (
            cfg?.seedDemo ? (
              <>Demo account: <b>alex@example.com</b> / <b>demo</b></>
            ) : (
              <>No account yet? <a href="#" style={{ color: 'var(--accent-3)' }} onClick={(e) => { e.preventDefault(); setMode('signup') }}>Create one</a></>
            )
          ) : (
            <>Already have an account? <a href="#" style={{ color: 'var(--accent-3)' }} onClick={(e) => { e.preventDefault(); setMode('login') }}>Sign in</a></>
          )}
        </div>
        <div className="hint">
          {mode === 'login' && cfg?.seedDemo && (
            <>New here? <a href="#" style={{ color: 'var(--accent-3)' }} onClick={(e) => { e.preventDefault(); setMode('signup') }}>Create an account</a></>
          )}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}

function Gate() {
  const { user, loading } = useAuth()
  if (loading) return <div className="login-wrap"><span className="muted">Loading…</span></div>
  if (!user) return <Login />
  return <Layout />
}

const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }

function isToday(s) {
  if (!s) return false
  return String(s).slice(0, 10) === new Date().toISOString().slice(0, 10)
}

function NotificationsBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [count, setCount] = useState(0)
  const navigate = useNavigate()

  const load = async () => {
    try {
      const n = await api.notifications({ limit: 100 })
      const sorted = [...n].sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) || (b.id - a.id))
      setItems(sorted)
      setCount(n.filter((x) => !x.read).length)
    } catch { /* ignore */ }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 30000) // real-time in-app updates via polling
    return () => clearInterval(t)
  }, [])

  const openNotification = async (n) => {
    if (!n.read) { api.readNotification(n.id).then(load) }
    setOpen(false)
    if (n.action_url) {
      const path = n.action_url.replace(/^https?:\/\/[^/]+/, '')
      navigate(path)
    }
  }

  const todayItems = items.filter((x) => isToday(x.created_at))
  const earlierItems = items.filter((x) => !isToday(x.created_at))

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn icon ghost" onClick={() => setOpen(!open)} aria-label="Notifications">
        <Bell size={19} />
        {count > 0 && (
          <span style={{ position: 'absolute', top: -2, right: -2, background: 'var(--red)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 99, padding: '1px 5px' }}>{count}</span>
        )}
      </button>
      {open && (
        <div className="card" style={{ position: 'absolute', right: 0, top: 42, width: 360, maxHeight: 460, overflowY: 'auto', zIndex: 200, boxShadow: 'var(--shadow)' }}>
          <div className="flex-between" style={{ paddingBottom: 8, borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
            <b className="small">Notifications</b>
            <Link to="/notifications" onClick={() => setOpen(false)} className="small" style={{ color: 'var(--accent-3)' }}>View history →</Link>
          </div>
          {items.length === 0 && <div className="muted small" style={{ padding: 12 }}>No notifications yet.</div>}
          {todayItems.length > 0 && <div className="notif-group">Today</div>}
          {todayItems.map((n) => <NotifItem key={n.id} n={n} onClick={() => openNotification(n)} />)}
          {earlierItems.length > 0 && <div className="notif-group">Earlier</div>}
          {earlierItems.map((n) => <NotifItem key={n.id} n={n} onClick={() => openNotification(n)} />)}
        </div>
      )}
    </div>
  )
}

function NotifItem({ n, onClick }) {
  return (
    <div className={`notif-item ${n.read ? '' : 'unread'}`} onClick={onClick}>
      <div className="flex-between" style={{ gap: 8 }}>
        <span className="small" style={{ fontWeight: n.read ? 500 : 700, color: n.read ? 'var(--text-muted)' : 'var(--text)' }}>{n.title}</span>
        <span className="badge gray">{n.channel}</span>
      </div>
      {n.body && <div className="small faint">{n.body}</div>}
      <div className="small faint" style={{ fontSize: 11, marginTop: 2 }}>{n.created_at?.replace('T', ' ').slice(0, 16)}</div>
    </div>
  )
}
