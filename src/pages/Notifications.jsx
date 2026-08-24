import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Filter, Inbox, Mail, Check } from 'lucide-react'
import { api } from '../api.js'
import { Card, Spinner } from '../components.jsx'

const CHANNEL_LABEL = { 'in_app': 'In-App', 'in-app': 'In-App', email: 'Email' }
const STATUS_BADGE = {
  delivered: 'green', sent: 'green', read: 'green',
  queued: 'gray', pending: 'gray', processing: 'gray',
  failed: 'red', cancelled: 'gray',
}

export default function Notifications() {
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState({ channel: '', status: '', read: '', date: '' })
  const navigate = useNavigate()

  const load = async (f) => {
    try {
      const d = await api.notificationsHistory(f)
      setData(d)
    } catch { setData({ notifications: [] }) }
  }

  useEffect(() => { load(filter) }, [])
  const apply = () => load(filter)

  const open = async (n) => {
    if (n.action_url) {
      const path = n.action_url.replace(/^https?:\/\/[^/]+/, '')
      navigate(path)
    }
  }

  const markRead = async (id) => {
    await api.readNotification(id)
    load(filter)
  }

  if (!data) return <Spinner />
  const notifs = data.notifications || []
  const email = data.email || {}

  return (
    <div>
      <div className="page-head">
        <div>
          <h2 className="page-title">Notification History</h2>
          <div className="page-sub">Every notification generated from your learning activity.</div>
        </div>
        <div className="badge" style={{ alignSelf: 'center' }}>
          Email: {email.provider ? `${email.provider}${email.dev ? ' (dev log)' : ''}` : 'not configured'}
        </div>
      </div>

      <Card title="Filters" sub="Filter the history below" actions={<Filter size={16} className="faint" />}>
        <div className="flex" style={{ gap: 10, flexWrap: 'wrap' }}>
          <select className="select" value={filter.channel} onChange={(e) => setFilter({ ...filter, channel: e.target.value })}>
            <option value="">All channels</option>
            <option value="in-app">In-App</option>
            <option value="email">Email</option>
          </select>
          <select className="select" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
            <option value="">All statuses</option>
            <option value="delivered">Delivered</option>
            <option value="sent">Sent</option>
            <option value="queued">Queued</option>
            <option value="failed">Failed</option>
            <option value="read">Read</option>
          </select>
          <select className="select" value={filter.read} onChange={(e) => setFilter({ ...filter, read: e.target.value })}>
            <option value="">Read / unread</option>
            <option value="read">Read</option>
            <option value="unread">Unread</option>
          </select>
          <input className="input" type="date" style={{ width: 160 }} value={filter.date}
            onChange={(e) => setFilter({ ...filter, date: e.target.value })} />
          <button className="btn" onClick={apply}>Apply</button>
        </div>
      </Card>

      <Card className="mt">
        {notifs.length === 0 && <div className="muted small" style={{ padding: 20, textAlign: 'center' }}>No notifications match your filters.</div>}
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Notification</th>
                <th>Channel</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {notifs.map((n) => (
                <tr key={n.id} style={{ cursor: n.action_url ? 'pointer' : 'default' }} onClick={() => n.action_url && open(n)}>
                  <td className="small faint">{String(n.created_at || '').replace('T', ' ').slice(0, 16)}</td>
                  <td>
                    <div className="small" style={{ fontWeight: n.read ? 500 : 700 }}>{n.title}</div>
                    {n.body && <div className="small faint">{n.body}</div>}
                  </td>
                  <td>
                    <span className="flex" style={{ gap: 5, alignItems: 'center' }}>
                      {n.channel === 'email' ? <Mail size={12} /> : <Inbox size={12} />}
                      <span className="small">{CHANNEL_LABEL[n.channel] || n.channel}</span>
                    </span>
                  </td>
                  <td><span className={`badge ${STATUS_BADGE[n.status] || 'gray'}`}>{n.status}</span></td>
                  <td>
                    {!n.read && <button className="btn sm" onClick={(e) => { e.stopPropagation(); markRead(n.id) }}><Check size={13} /> Read</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
