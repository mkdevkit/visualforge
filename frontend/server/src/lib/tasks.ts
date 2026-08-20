import { nanoid } from "nanoid";
import type { AssetType, TaskRecord, TaskStatus } from "../types.js";
import { getTaskRow, listTasks, replaceTasks, upsertTask } from "./db.js";

export function loadTasks(): TaskRecord[] {
  return listTasks();
}

export function saveTasks(list: TaskRecord[]) {
  replaceTasks(list);
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
  upsertTask(task);
  return task;
}

export function patchTask(id: string, patch: Partial<TaskRecord>) {
  const current = getTaskRow(id);
  if (!current) return undefined;
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  upsertTask(next);
  return next;
}

export function getTask(id: string) {
  return getTaskRow(id);
}

export function mark(id: string, status: TaskStatus, extra: Partial<TaskRecord> = {}) {
  const progress = status === "succeeded" ? 100 : status === "failed" ? 0 : extra.progress;
  return patchTask(id, { status, ...extra, ...(progress !== undefined ? { progress } : {}) });
}
