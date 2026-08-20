import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { AssetRecord, TaskRecord } from "../types.js";
import { loadSettings } from "../config.js";

type Store = {
  dir: string;
  db: DatabaseSync;
};

let cached: Store | null = null;
let hooksBound = false;

function asCount(row: Record<string, unknown> | undefined) {
  const n = row?.n;
  if (typeof n === "bigint") return Number(n);
  if (typeof n === "number") return n;
  return 0;
}

function parseRecord<T>(row: Record<string, unknown> | undefined): T | undefined {
  if (!row || typeof row.json !== "string") return undefined;
  try {
    return JSON.parse(row.json) as T;
  } catch {
    return undefined;
  }
}

function readJsonArray<T>(path: string): T[] | null {
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return Array.isArray(data) ? (data as T[]) : null;
  } catch (err) {
    console.error(`无法解析 ${path}，跳过导入 SQLite：`, err);
    return null;
  }
}

function archiveJson(path: string) {
  const bak = `${path}.bak`;
  const dest = existsSync(bak) ? `${path}.bak.${Date.now()}` : bak;
  renameSync(path, dest);
  console.log(`已将 ${path} 改名为 ${dest}（SQLite 为当前数据源）`);
}

function bindCloseHooks() {
  if (hooksBound) return;
  hooksBound = true;
  process.once("exit", () => closeStore());
}

function openDatabase(file: string): DatabaseSync {
  try {
    const require = createRequire(import.meta.url);
    const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
    return new DatabaseSync(file, { timeout: 5000 });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ERR_UNKNOWN_BUILTIN_MODULE" || /cannot find module ['"]node:sqlite['"]/i.test(String(err))) {
      throw new Error(
        `资源库已改用 SQLite，需要 Node.js 22.13+ 或 24（内置 node:sqlite）。当前是 ${process.version}。`,
        { cause: err },
      );
    }
    throw err;
  }
}

export function storePath(dataDir = loadSettings().dataDir) {
  return join(dataDir, "visualforge.sqlite");
}

export function closeStore() {
  if (!cached) return;
  try {
    cached.db.close();
  } catch {
    /* already closed */
  }
  cached = null;
}

function migrateFromJson(dir: string, db: DatabaseSync) {
  const assetsCount = asCount(db.prepare("SELECT COUNT(*) AS n FROM assets").get());
  const libraryFile = join(dir, "library.json");
  if (assetsCount === 0) {
    const list = readJsonArray<AssetRecord>(libraryFile);
    if (list?.length) {
      const insert = db.prepare("INSERT OR REPLACE INTO assets (id, type, created_at, json) VALUES (?, ?, ?, ?)");
      db.exec("BEGIN");
      try {
        for (const asset of list) {
          if (!asset?.id) continue;
          insert.run(asset.id, asset.type || "", asset.createdAt || "", JSON.stringify(asset));
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      archiveJson(libraryFile);
      console.log(`已从 library.json 导入 ${list.length} 条成品到 SQLite`);
    }
  }

  const tasksCount = asCount(db.prepare("SELECT COUNT(*) AS n FROM tasks").get());
  const tasksFile = join(dir, "tasks.json");
  if (tasksCount === 0) {
    const list = readJsonArray<TaskRecord>(tasksFile);
    if (list?.length) {
      const insert = db.prepare("INSERT OR REPLACE INTO tasks (id, status, created_at, json) VALUES (?, ?, ?, ?)");
      db.exec("BEGIN");
      try {
        for (const task of list) {
          if (!task?.id) continue;
          insert.run(task.id, task.status || "", task.createdAt || "", JSON.stringify(task));
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      archiveJson(tasksFile);
      console.log(`已从 tasks.json 导入 ${list.length} 条任务到 SQLite`);
    }
  }
}

export function getDb(): DatabaseSync {
  const dir = loadSettings().dataDir;
  if (cached && cached.dir === dir) return cached.db;
  closeStore();
  mkdirSync(dir, { recursive: true });
  const db = openDatabase(storePath(dir));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assets_created ON assets(created_at);
    CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(type);
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
  `);
  migrateFromJson(dir, db);
  cached = { dir, db };
  bindCloseHooks();
  return db;
}

export function initStore() {
  getDb();
  return storePath();
}

export function listAssets(): AssetRecord[] {
  return getDb()
    .prepare("SELECT json FROM assets ORDER BY created_at DESC")
    .all()
    .map((row) => parseRecord<AssetRecord>(row))
    .filter((asset): asset is AssetRecord => Boolean(asset));
}

export function getAssetRow(id: string): AssetRecord | undefined {
  return parseRecord<AssetRecord>(getDb().prepare("SELECT json FROM assets WHERE id = ?").get(id));
}

export function upsertAsset(asset: AssetRecord) {
  getDb()
    .prepare(
      `INSERT INTO assets (id, type, created_at, json) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET type = excluded.type, json = excluded.json`,
    )
    .run(asset.id, asset.type || "", asset.createdAt || "", JSON.stringify(asset));
}

export function deleteAssetRow(id: string) {
  const result = getDb().prepare("DELETE FROM assets WHERE id = ?").run(id);
  return result.changes > 0;
}

export function replaceAssets(list: AssetRecord[]) {
  const db = getDb();
  const insert = db.prepare("INSERT INTO assets (id, type, created_at, json) VALUES (?, ?, ?, ?)");
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM assets");
    for (const asset of list) {
      if (!asset?.id) continue;
      insert.run(asset.id, asset.type || "", asset.createdAt || "", JSON.stringify(asset));
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function listTasks(): TaskRecord[] {
  return getDb()
    .prepare("SELECT json FROM tasks ORDER BY created_at DESC")
    .all()
    .map((row) => parseRecord<TaskRecord>(row))
    .filter((task): task is TaskRecord => Boolean(task));
}

export function getTaskRow(id: string): TaskRecord | undefined {
  return parseRecord<TaskRecord>(getDb().prepare("SELECT json FROM tasks WHERE id = ?").get(id));
}

export function upsertTask(task: TaskRecord) {
  getDb()
    .prepare(
      `INSERT INTO tasks (id, status, created_at, json) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET status = excluded.status, json = excluded.json`,
    )
    .run(task.id, task.status || "", task.createdAt || "", JSON.stringify(task));
}

export function replaceTasks(list: TaskRecord[]) {
  const db = getDb();
  const insert = db.prepare("INSERT INTO tasks (id, status, created_at, json) VALUES (?, ?, ?, ?)");
  db.exec("BEGIN");
  try {
    db.exec("DELETE FROM tasks");
    for (const task of list) {
      if (!task?.id) continue;
      insert.run(task.id, task.status || "", task.createdAt || "", JSON.stringify(task));
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
