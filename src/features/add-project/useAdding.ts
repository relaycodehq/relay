import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AddingJob, NewProject, Project } from "../../../shared/projects";
import { api } from "../../lib/api";
import { localProjectAt } from "./related";

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
export function useAdding(projects: readonly Project[], computerId?: string) {
  const start = useQuery({
    queryKey: ["adding-start", computerId],
    queryFn: () => api.addingStart(computerId),
    retry: false,
    staleTime: 0,
  });
  const [job, setJob] = useState<AddingJob | null>(null);
  useEffect(() => {
    setJob(null);
    if (!computerId) return api.onProjectAdding(setJob);
  }, [computerId]);
  const [error, setError] = useState<unknown>();
  const [picked, setPicked] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(work: () => Promise<Project | undefined>) {
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
      if (computerId) setJob(null);
    }
  }

  return {
    start: start.data,
    startError: start.error,
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
      if (computerId) return run(() => api.addRemoteProject(computerId, path));
      return run(async () => {
        const info = await api.inspectFolder(path);
        const project = localProjectAt(projects, info.path);
        if (project) return project;
        if (info.kind === "repository") return api.addProjectAt(info.path);
        setPicked(
          info.kind === "inside"
            ? { kind: "inside", path: info.path, root: info.root }
            : info.kind === "plain"
              ? { kind: "plain", path: info.path }
              : { kind: "missing", path: info.path },
        );
      });
    },
    add: (path: string, setUpGit = false) =>
      run(() => api.addProjectAt(path, setUpGit)),
    clone: (remote: string, into: string) =>
      run(async () => {
        if (!computerId) return api.cloneProject(remote, into);
        setJob({
          title: "Cloning repository",
          step: "Starting",
          progress: null,
        });
        for (;;) {
          const answer = await api.cloneRemoteProject(computerId, remote, into);
          if (answer.done) return answer.project;
          setJob({
            title: "Cloning repository",
            step: answer.step,
            progress: answer.progress,
          });
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }),
    create: (spec: NewProject) =>
      run(() => {
        if (computerId)
          setJob({
            title: `Creating ${spec.name}`,
            step: "Starting",
            progress: null,
          });
        return api.createProject(spec, computerId);
      }),
    cancel: () => void api.cancelProjectAdding(computerId).catch(setError),
  };
}

export type Adding = ReturnType<typeof useAdding>;
