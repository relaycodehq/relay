import { useState } from "react";
import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type { Project } from "../../../shared/projects";
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
} from "../../../shared/project-folders";
import { api } from "../../lib/api";
import { ghostKey } from "../../../shared/import-offer";
import { realBefore } from "../import-offer/import-plan";
import { errorMessage } from "../../../shared/error-message";
import { groupKey, type SidebarFolds } from "./useSidebarFolds";

export type ProjectGroups = ReturnType<typeof useProjectGroups>;

/** An import offer's plan, whose new projects stand in the tree. */
interface PlannedGroups {
  move: (id: string, folder: string, before: string | null) => void;
  regroup: (from: string, to: string) => void;
}

/**
 * Runs `work` on the projects or their groups, showing `optimistic` groups
 * meanwhile. A failure goes to `setError`; both lists are asked again after.
 */
async function changeGroups(
  qc: QueryClient,
  setError: (message: string | undefined) => void,
  work: () => Promise<void>,
  optimistic?: (groups: string[]) => string[],
) {
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
    void qc.invalidateQueries({ queryKey: ["projects"] });
    void qc.invalidateQueries({ queryKey: ["project-groups"] });
  }
}

/**
 * Moves project `id` to `target`: in the import plan, and unless it is only
 * one of the plan's stand-ins, in the listed projects at once and on the
 * desktop.
 */
async function placeProject(
  qc: QueryClient,
  projects: Project[],
  id: string,
  target: ProjectPlace,
  planned: PlannedGroups | undefined,
) {
  const placement = projectPlacement(projects, id, target);
  if (!placement) return;
  const { folder } = placement;
  planned?.move(id, folder, placement.before);
  // A stand-in isn't a project yet: only the plan moves it.
  if (ghostKey(id)) return;
  const before = realBefore(projects, folder, placement.before);
  qc.setQueriesData<Project[]>({ queryKey: ["projects"] }, (list) =>
    list ? moveProjectInList(list, id, folder, before) : list,
  );
  await api.moveProject(id, folder, before);
}

/**
 * Renaming and taking apart groups. What's open inside one follows once the
 * desktop has changed it: a refused change leaves the groups where they were.
 */
function groupEdits(
  change: (work: () => Promise<void>) => Promise<void>,
  { setOpen, regroup }: Pick<SidebarFolds, "setOpen" | "regroup">,
  planned: PlannedGroups | undefined,
) {
  const follow = (from: string, to: string) => {
    regroup(from, to);
    planned?.regroup(from, to);
  };
  return {
    /** Renames group `path` to `name`, open or folded as it was. */
    renameGroup(path: string, name: string, open: boolean) {
      const to = joinGroup(parentGroup(path), name);
      void change(async () => {
        await api.renameProjectGroup(path, to);
        setOpen(groupKey(to), open);
        follow(path, to);
      });
    },
    removeGroup(path: string) {
      void change(async () => {
        await api.removeProjectGroup(path);
        follow(path, parentGroup(path));
      });
    },
  };
}

/**
 * The Projects tree: its groups, the names being typed into it, and naming,
 * moving and removing groups and projects. Each change shows before the
 * desktop has it; a failure goes to `setError`.
 */
export function useProjectGroups(
  /** Every project but Scratchpad's. */
  projects: Project[],
  { setOpen, regroup }: Pick<SidebarFolds, "setOpen" | "regroup">,
  setError: (message: string | undefined) => void,
  /** An import plan's new projects stand among `projects`; it hears every move. */
  planned?: PlannedGroups,
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
  const change = (
    work: () => Promise<void>,
    optimistic?: (groups: string[]) => string[],
  ) => changeGroups(qc, setError, work, optimistic);
  // Both callers go through `change`, which refreshes the lists after.
  const place = (id: string, target: ProjectPlace) =>
    placeProject(qc, projects, id, target, planned);
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
    ...groupEdits(change, { setOpen, regroup }, planned),
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
    removeProject: (id: string) =>
      void change(async () => {
        await api.removeProject(id);
      }),
    moveProject: (id: string, target: ProjectPlace) =>
      void change(() => place(id, target)),
    reveal: (id: string) =>
      void api.revealProject(id).catch((e) => setError(errorMessage(e))),
  };
}
