import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "../../../shared/error-message";
import type { Project } from "../../../shared/projects";
import type { ProjectTask } from "../../../shared/tasks";
import { api } from "../../lib/api";

export type Action = "stop" | "restart";

/** Stop and Restart, with which task is mid-way through one, and what last failed. */
export function useTaskActions(project: Project) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<Map<string, Action>>(new Map());
  const [error, setError] = useState<string>();
  const act = async (task: ProjectTask, action: Action) => {
    setBusy((b) => new Map(b).set(task.id, action));
    setError(undefined);
    try {
      await (action === "stop"
        ? api.stopProjectTask(project.id, task.id)
        : api.restartProjectTask(project.id, task.id));
      window.setTimeout(
        () =>
          void qc.invalidateQueries({
            queryKey: ["project-tasks", project.id],
          }),
        800,
      );
    } catch (e) {
      setError(errorMessage(e));
      setBusy((b) => {
        const next = new Map(b);
        next.delete(task.id);
        return next;
      });
    }
  };
  return { busy, error, act };
}
