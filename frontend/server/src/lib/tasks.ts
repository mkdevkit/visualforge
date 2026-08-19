import { join } from "node:path";
import { nanoid } from "nanoid";
import type { AssetType, TaskRecord, TaskStatus } from "../types.js";
import { loadSettings } from "../config.js";
import { loadJson, saveJson } from "./json.js";

function tasksFile() {
  return join(loadSettings().dataDir, "tasks.json");
}

export function loadTasks(): TaskRecord[] {
  return loadJson<TaskRecord[]>(tasksFile(), []);
}

export function saveTasks(list: TaskRecord[]) {
  saveJson(tasksFile(), list);
}

export function createTask(partial: {
  type: AssetType;
  model: string;
  prompt: string;
  remoteTaskId?: string;
  payload?: Record<string, unknown>;
}): TaskRecord {
  const now = new Date().toISOString();
  const task: TaskRecord = {
    id: `tsk_${nanoid(10)}`,
    remoteTaskId: partial.remoteTaskId,
    type: partial.type,
    model: partial.model,
    prompt: partial.prompt,
    status: partial.remoteTaskId ? "running" : "queued",
    progress: 5,
    assetIds: [],
    createdAt: now,
    updatedAt: now,
    payload: partial.payload || {},
  };
  const list = loadTasks();
  list.unshift(task);
  saveTasks(list);
  return task;
}

export function patchTask(id: string, patch: Partial<TaskRecord>) {
  const list = loadTasks();
  const idx = list.findIndex((t) => t.id === id);
  if (idx < 0) return undefined;
  list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
  saveTasks(list);
  return list[idx];
}

export function getTask(id: string) {
  return loadTasks().find((t) => t.id === id);
}

export function mark(id: string, status: TaskStatus, extra: Partial<TaskRecord> = {}) {
  const progress = status === "succeeded" ? 100 : status === "failed" ? 0 : extra.progress;
  return patchTask(id, { status, ...extra, ...(progress !== undefined ? { progress } : {}) });
}
