import { useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { AssetRecord, TaskRecord } from "./types";

export function useTaskPoll(
  task: TaskRecord | null,
  setTask: (task: TaskRecord) => void,
  setError: (message: string) => void,
  onSucceeded?: (task: TaskRecord) => void,
) {
  const [assets, setAssets] = useState<AssetRecord[]>([]);
  const id = task?.id;
  const status = task?.status;
  const assetKey = task?.assetIds?.join(",") || "";
  const onSucceededRef = useRef(onSucceeded);
  onSucceededRef.current = onSucceeded;
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    if (!id || status === "succeeded" || status === "failed") return;
    const timer = setInterval(async () => {
      try {
        const r = await api.task(id);
        setTask(r.task);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [id, status, setTask, setError]);

  useEffect(() => {
    if (status !== "succeeded") return;
    const ids = assetKey.split(",").filter(Boolean);
    const done = () => {
      if (taskRef.current) onSucceededRef.current?.(taskRef.current);
    };
    if (!ids.length) {
      setAssets([]);
      done();
      return;
    }
    Promise.all(ids.map((item) => api.asset(item)))
      .then((rows) => {
        setAssets(rows.map((r) => r.asset));
        done();
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [status, assetKey, setError]);

  return { assets, setAssets };
}
