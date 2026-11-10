import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "../../../shared/error-message";
import type { Project } from "../../../shared/projects";
import type { ProjectTask } from "../../../shared/tasks";
import { api } from "../../lib/api";

export type Action = "stop" | "restart";

/**
 * How long a stop or restart may take before the list has settled: SIGKILL
 * goes after about 3s, and the main process looks for the exit for 6s (see
 * `terminate` in electron/terminal/tasks.ts).
 */
export const TASK_SETTLE_MS = 7000;

/** Stop and Restart, with which task is mid-way through one, and what last failed. */
export function useTaskActions(project: Project) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<Map<string, Action>>(new Map());
  const [error, setError] = useState<string>();
  const timers = useRef(new Set<number>());
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);
  const later = (run: () => void, ms: number) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, ms);
    timers.current.add(timer);
  };
  const refresh = () =>
    void qc.invalidateQueries({ queryKey: ["project-tasks", project.id] });
  const free = (id: string) =>
    setBusy((b) => {
      const next = new Map(b);
      next.delete(id);
      return next;
    });
  const act = async (task: ProjectTask, action: Action) => {
    setBusy((b) => new Map(b).set(task.id, action));
    setError(undefined);
    try {
      await (action === "stop"
        ? api.stopProjectTask(project.id, task.id)
        : api.restartProjectTask(project.id, task.id));
      later(refresh, 800);
      // A task that survived, or came back under its id, can be acted on again.
      later(() => {
        free(task.id);
        refresh();
      }, TASK_SETTLE_MS);
    } catch (e) {
      setError(errorMessage(e));
      free(task.id);
    }
  };
  return { busy, error, act };
}
