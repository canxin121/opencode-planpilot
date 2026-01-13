import fs from "fs"
import path from "path"
import os from "os"
import { Database } from "bun:sqlite"
import { xdgConfig } from "xdg-basedir"

export type DatabaseConnection = Database

let cachedDb: Database | null = null

export function resolveConfigRoot(): string {
  if (process.env.OPENCODE_CONFIG_DIR) {
    return process.env.OPENCODE_CONFIG_DIR
  }
  const base = xdgConfig ?? path.join(os.homedir(), ".config")
  return path.join(base, "opencode")
}

export function resolvePlanpilotDir(): string {
  const override = process.env.OPENCODE_PLANPILOT_DIR || process.env.OPENCODE_PLANPILOT_HOME
  if (override && override.trim()) return override
  return path.join(resolveConfigRoot(), ".planpilot")
}

export function resolveDbPath(): string {
  return path.join(resolvePlanpilotDir(), "planpilot.db")
}

export function resolvePlanMarkdownDir(): string {
  return path.join(resolvePlanpilotDir(), "plans")
}

export function resolvePlanMarkdownPath(planId: number): string {
  return path.join(resolvePlanMarkdownDir(), `plan_${planId}.md`)
}

export function ensureParentDir(filePath: string) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
}

export function openDatabase(): Database {
  if (cachedDb) return cachedDb
  const dbPath = resolveDbPath()
  ensureParentDir(dbPath)
  const db = new Database(dbPath)
  db.exec("PRAGMA foreign_keys = ON;")
  ensureSchema(db)
  cachedDb = db
  return db
}

export function ensureSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      comment TEXT,
      last_session_id TEXT,
      last_cwd TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plan_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      executor TEXT NOT NULL,
      sort_order INTEGER NOT NULL,
      comment TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      step_id INTEGER NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      comment TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(step_id) REFERENCES steps(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS active_plan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      plan_id INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(session_id),
      UNIQUE(plan_id),
      FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_steps_plan_order ON steps(plan_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_goals_step ON goals(step_id);
  `)

  const columns = db
    .prepare("PRAGMA table_info(plans)")
    .all()
    .map((row: any) => row.name as string)
  if (!columns.includes("last_cwd")) {
    db.exec("ALTER TABLE plans ADD COLUMN last_cwd TEXT")
  }
}
