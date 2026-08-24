import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.join(__dirname, '..', 'data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const DB_PATH = path.join(DATA_DIR, 'app.db')
export const db = new DatabaseSync(DB_PATH)

db.exec('PRAGMA journal_mode = WAL;')
db.exec('PRAGMA foreign_keys = ON;')

export function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE,
    password_hash TEXT,
    role TEXT,
    career_goal TEXT,
    target_role TEXT,
    experience_level TEXT,
    daily_learning_minutes INTEGER DEFAULT 45,
    preferred_days TEXT DEFAULT '["Mon","Tue","Wed","Thu","Fri"]',
    briefing_time TEXT DEFAULT '07:30',
    learning_style TEXT DEFAULT 'Hands-on / project-based',
    bio TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS skills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    category TEXT,
    current_mastery REAL DEFAULT 0,
    target_mastery REAL DEFAULT 80,
    current_level TEXT DEFAULT 'Beginner',
    target_level TEXT DEFAULT 'Advanced',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    description TEXT,
    why TEXT,
    target_outcome TEXT,
    current_level TEXT DEFAULT 'Beginner',
    target_level TEXT DEFAULT 'Advanced',
    priority TEXT DEFAULT 'Medium',
    deadline TEXT,
    hours_per_week REAL DEFAULT 5,
    preferred_method TEXT DEFAULT 'Hands-on / project-based',
    resources_json TEXT DEFAULT '[]',
    related_goal TEXT,
    status TEXT DEFAULT 'active',
    progress REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS roadmap_phases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER NOT NULL,
    phase_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'locked',
    estimated_minutes INTEGER DEFAULT 0,
    progress REAL DEFAULT 0,
    sort INTEGER DEFAULT 0,
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    goal_id INTEGER NOT NULL,
    phase_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    difficulty TEXT DEFAULT 'beginner',
    estimated_minutes INTEGER DEFAULT 30,
    status TEXT DEFAULT 'locked',
    concepts_json TEXT DEFAULT '[]',
    exercises_json TEXT DEFAULT '[]',
    project TEXT,
    success_criteria_json TEXT DEFAULT '[]',
    sort INTEGER DEFAULT 0,
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE,
    FOREIGN KEY (phase_id) REFERENCES roadmap_phases(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS daily_plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    date TEXT NOT NULL,
    primary_goal_id INTEGER,
    topic TEXT,
    objective TEXT,
    estimated_minutes INTEGER DEFAULT 0,
    briefing_json TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    daily_plan_id INTEGER NOT NULL,
    goal_id INTEGER,
    topic_id INTEGER,
    type TEXT DEFAULT 'learn',
    title TEXT NOT NULL,
    description TEXT,
    duration INTEGER DEFAULT 15,
    status TEXT DEFAULT 'not_started',
    sort INTEGER DEFAULT 0,
    FOREIGN KEY (daily_plan_id) REFERENCES daily_plans(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS task_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    date TEXT,
    status TEXT,
    actual_minutes INTEGER,
    difficulty TEXT,
    confidence INTEGER,
    notes TEXT,
    questions TEXT,
    learned TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    date TEXT,
    duration INTEGER,
    goal_id INTEGER,
    topic_id INTEGER,
    topic_name TEXT,
    confidence INTEGER,
    difficulty TEXT,
    notes TEXT,
    learned TEXT,
    status TEXT DEFAULT 'completed',
    kind TEXT DEFAULT 'learn'
  );

  CREATE TABLE IF NOT EXISTS assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    goal_id INTEGER,
    topic_id INTEGER,
    title TEXT,
    kind TEXT DEFAULT 'quiz',
    questions_json TEXT DEFAULT '[]',
    score REAL,
    max_score REAL,
    date TEXT,
    difficulty TEXT,
    completed INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS resources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    goal_id INTEGER,
    topic_id INTEGER,
    title TEXT NOT NULL,
    url TEXT,
    type TEXT,
    notes TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    goal_id INTEGER,
    topic_id INTEGER,
    content TEXT DEFAULT '',
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    period TEXT,
    period_start TEXT,
    summary_json TEXT DEFAULT '{}',
    recommendations TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS revision_schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    topic_id INTEGER,
    goal_id INTEGER,
    topic_name TEXT,
    due_date TEXT,
    interval_days INTEGER,
    status TEXT DEFAULT 'pending',
    source TEXT DEFAULT 'spaced'
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  `)
}

// small helpers
export function now() {
  return new Date().toISOString().slice(0, 10)
}

export function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function isoDate(d = new Date()) {
  return d.toISOString().slice(0, 10)
}

export function daysBetween(a, b) {
  const da = new Date(a + 'T00:00:00')
  const db = new Date(b + 'T00:00:00')
  return Math.round((db - da) / 86400000)
}

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  if (!row) return fallback
  try {
    return JSON.parse(row.value)
  } catch {
    return row.value
  }
}

export function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, JSON.stringify(value))
}
