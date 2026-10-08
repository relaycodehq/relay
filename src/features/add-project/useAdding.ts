import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  AddingJob,
  FolderInfo,
  NewProject,
  Project,
} from "../../../shared/projects";
import { api } from "../../lib/api";

/** What a picked folder turned out to be, when it can't simply be added. */
export type Picked =
  | { kind: "added"; project: Project }
  | { kind: "plain"; path: string }
  | { kind: "inside"; path: string; root: string }
  | { kind: "missing"; path: string };

/**
 * The palette's work: where it starts, the clone or creation under way, and
 * adding what was picked. Each action resolves to the project, or to nothing
 * when it failed (the error is kept) or needs an answer first (`picked`).
 */
export function useAdding(projects: readonly Project[]) {
  const start = useQuery({
    queryKey: ["adding-start"],
    queryFn: () => api.addingStart(),
    staleTime: 0,
  });
  const [job, setJob] = useState<AddingJob | null>(null);
  useEffect(() => api.onProjectAdding(setJob), []);
  const [error, setError] = useState<unknown>();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<Project>) {
    setError(undefined);
    setPicked(null);
    setBusy(true);
    try {
      return await work();
    } catch (e) {
      // A cancelled clone says so itself; nothing to show.
      if (!(e instanceof Error && /Cancelled\.$/.test(e.message))) setError(e);
    } finally {
      setBusy(false);
    }
  }

  return {
    start: start.data,
    job,
    busy: busy || !!job,
    error,
    picked,
    clear() {
      setError(undefined);
      setPicked(null);
    },
    /** A folder from the list, Finder or a typed path. */
    async pick(path: string) {
      setError(undefined);
      let info: FolderInfo;
      try {
        info = await api.inspectFolder(path);
      } catch (e) {
        return void setError(e);
      }
      const project = projects.find((p) => p.path === info.path);
      if (project) return void setPicked({ kind: "added", project });
      if (info.kind === "repository")
        return run(() => api.addProjectAt(info.path));
      setPicked(
        info.kind === "inside"
          ? { kind: "inside", path: info.path, root: info.root }
          : info.kind === "plain"
            ? { kind: "plain", path: info.path }
            : { kind: "missing", path: info.path },
      );
    },
    add: (path: string, setUpGit = false) =>
      run(() => api.addProjectAt(path, setUpGit)),
    clone: (remote: string, into: string) =>
      run(() => api.cloneProject(remote, into)),
    create: (spec: NewProject) => run(() => api.createProject(spec)),
    cancel: () => void api.cancelProjectAdding(),
  };
}

export type Adding = ReturnType<typeof useAdding>;
