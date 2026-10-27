import type { ProjectFolderNode } from "../../../shared/project-folders";
import type { AgentProvider, ChatSummary } from "../../../shared/projects";
import { useStoredState } from "../../lib/persisted-store";

/** Which threads the sidebar lists; an empty list lets every one through. */
export interface ThreadFilter {
  projects: string[];
  agents: AgentProvider[];
}

const strings = (saved: unknown) =>
  Array.isArray(saved)
    ? saved.filter((s): s is string => typeof s === "string")
    : [];

export const filterCount = (f: ThreadFilter) =>
  f.projects.length + f.agents.length;

/** The agents that worked in `chat`, most recent first. */
export const chatAgents = (chat: ChatSummary): AgentProvider[] =>
  chat.providers ?? (chat.provider ? [chat.provider] : []);

/** Every Scratchpad chat has a project of its own; the filter takes them as one. */
export const SCRATCHPAD = "scratchpad";

/** The filter without projects that are gone: one's id would hide everything, with nothing to untick. */
export const withoutRemoved = (
  f: ThreadFilter,
  projects: ReadonlyMap<string, unknown>,
): ThreadFilter => ({
  ...f,
  projects: f.projects.filter((id) => id === SCRATCHPAD || projects.has(id)),
});

/** `project` is a project's id, or SCRATCHPAD. */
export const takesProject = (f: ThreadFilter, project: string) =>
  !f.projects.length || f.projects.includes(project);

export const passes = (f: ThreadFilter, project: string, chat: ChatSummary) =>
  takesProject(f, project) &&
  (!f.agents.length || chatAgents(chat).some((a) => f.agents.includes(a)));

/** The tree with only the projects `keep` takes, and the groups holding them. */
export function pruneTree(
  node: ProjectFolderNode,
  keep: (id: string) => boolean,
): ProjectFolderNode {
  return {
    ...node,
    folders: node.folders
      .map((f) => pruneTree(f, keep))
      .filter((f) => f.folders.length || f.projects.length),
    projects: node.projects.filter((p) => keep(p.id)),
  };
}

export type ThreadFilterState = ReturnType<typeof useThreadFilter>;

/** The sidebar's filter, kept per device. */
export function useThreadFilter() {
  const [filter, setFilter] = useStoredState(
    "relay-sidebar-filter",
    (saved): ThreadFilter => {
      const s = (saved ?? {}) as Partial<Record<keyof ThreadFilter, unknown>>;
      return {
        projects: strings(s.projects),
        agents: strings(s.agents) as AgentProvider[],
      };
    },
  );
  return {
    filter,
    toggle(kind: keyof ThreadFilter, id: string) {
      setFilter((f) => ({
        ...f,
        [kind]: (f[kind] as string[]).includes(id)
          ? f[kind].filter((x) => x !== id)
          : [...f[kind], id],
      }));
    },
    clear: () => setFilter({ projects: [], agents: [] }),
  };
}
