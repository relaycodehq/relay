import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Project } from "../../shared/projects";
import {
  groupBefore,
  groupPaths,
  joinGroup,
  moveGroupInList,
  moveProjectInList,
  parentGroup,
  projectFolderTree,
  projectPlacement,
  type ProjectPlace,
} from "../../shared/project-folders";
import { api } from "./api";
import { errorMessage } from "./error-message";
import { groupKey } from "./useSidebarFolds";

export type ProjectGroups = ReturnType<typeof useProjectGroups>;

/**
 * The Projects tree: its groups, the names being typed into it, and naming,
 * moving and removing groups and projects. Each change shows before the
 * desktop has it; a failure goes to `setError`.
 */
export function useProjectGroups(
  /** Every project but Scratchpad's. */
  projects: Project[],
  setOpen: (key: string, open: boolean) => void,
  setError: (message: string | undefined) => void,
) {
  const qc = useQueryClient();
  const groups = useQuery({
    queryKey: ["project-groups"],
    queryFn: () => api.projectGroups(),
  }).data;
  /** Where a new group's name is being typed, and a project to move into it. */
  const [adding, setAdding] = useState<{ parent: string; project?: string }>();
  const [renaming, setRenaming] = useState<string>();
  const [renamingProject, setRenamingProject] = useState<string>();
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["projects"] }),
      qc.invalidateQueries({ queryKey: ["project-groups"] }),
    ]);
  const change = async (
    work: () => Promise<void>,
    optimistic?: (groups: string[]) => string[],
  ) => {
    setError(undefined);
    if (optimistic)
      qc.setQueryData<string[]>(["project-groups"], (list) =>
        optimistic(list ?? []),
      );
    try {
      await work();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      void refresh();
    }
  };
  const place = async (id: string, target: ProjectPlace) => {
    const placement = projectPlacement(projects, id, target);
    if (!placement) return;
    const { folder, before } = placement;
    qc.setQueriesData<Project[]>({ queryKey: ["projects"] }, (list) =>
      list ? moveProjectInList(list, id, folder, before) : list,
    );
    try {
      await api.moveProject(id, folder, before);
    } finally {
      void refresh();
    }
  };
  const tree = projectFolderTree(projects, groups);
  const paths = groupPaths(tree);
  return {
    tree,
    /** Every group, in the order the tree shows them. */
    paths,
    adding,
    setAdding,
    renaming,
    setRenaming,
    renamingProject,
    setRenamingProject,
    /** Opens the name field for a new group in `parent`, to move `project` into. */
    startGroup(parent: string, project?: string) {
      setRenaming(undefined);
      if (parent) setOpen(groupKey(parent), true);
      setAdding({ parent, project });
    },
    createGroup(parent: string, name: string, project?: string) {
      const path = joinGroup(parent, name);
      setOpen(groupKey(path), true);
      void change(
        () =>
          project
            ? place(project, { kind: "folder", path })
            : api.createProjectGroup(path),
        (list) => [...list, path],
      );
    },
    /** Renames group `path` to `name`, open or folded as it was. */
    renameGroup(path: string, name: string, open: boolean) {
      const to = joinGroup(parentGroup(path), name);
      setOpen(groupKey(to), open);
      void change(() => api.renameProjectGroup(path, to));
    },
    removeGroup: (path: string) =>
      void change(() => api.removeProjectGroup(path)),
    moveGroup(
      path: string,
      target: { path: string; where: "before" | "after" },
    ) {
      const before = groupBefore(paths, path, target);
      void change(
        () => api.moveProjectGroup(path, before),
        (list) => moveGroupInList(list, path, before),
      );
    },
    renameProject(id: string, name: string) {
      qc.setQueriesData<Project[]>({ queryKey: ["projects"] }, (list) =>
        list?.map((p) => (p.id === id ? { ...p, name } : p)),
      );
      void change(async () => {
        await api.renameProject(id, name);
      });
    },
    moveProject: (id: string, target: ProjectPlace) =>
      void change(() => place(id, target)),
    reveal: (id: string) =>
      void api.revealProject(id).catch((e) => setError(errorMessage(e))),
  };
}
