import { ListFilter } from "lucide-react";
import { agentName } from "../../../shared/agents";
import type { AgentProvider, Project } from "../../../shared/projects";
import { relativeDate } from "../../lib/relative-date";
import { SearchSelect } from "../../ui/SearchSelect";
import { ProviderIcon } from "../agents/ComposerModelPicker";
import { ProjectBadge } from "../projects/ProjectBadge";
import {
  filterCount,
  type ThreadFilter,
  type ThreadFilterState,
} from "./useThreadFilter";

/**
 * Narrows the sidebar to some projects or agents. Agents only show up once
 * threads ran more than one, since a single agent filters nothing.
 */
export function FilterMenu({
  state: { toggle, clear },
  filter,
  projects,
  agents,
}: {
  state: ThreadFilterState;
  /** What's ticked, of what's still there. */
  filter: ThreadFilter;
  /**
   * The projects to offer, latest activity first; `key` is what the filter
   * keeps, `at` when a thread in it last changed, if one has.
   */
  projects: { key: string; project: Project; at?: number }[];
  agents: AgentProvider[];
}) {
  const count = filterCount(filter);
  return (
    <SearchSelect
      label="Filter"
      placeholder="Search projects and agents…"
      className="sb-filter-popup"
      triggerClassName={`sb-top-button sb-filter ${count ? "active" : ""}`}
      triggerLabel={count ? `Filter, ${count} applied` : "Filter"}
      trigger={
        <>
          <ListFilter size={15} />
          {count > 0 && <span className="sb-bell-count">{count}</span>}
        </>
      }
      checked={[
        ...filter.projects.map((id) => `project:${id}`),
        ...filter.agents.map((a) => `agent:${a}`),
      ]}
      // Agents first: a handful of them, over a list that may scroll.
      options={[
        ...(agents.length > 1
          ? agents.map((a) => ({
              value: `agent:${a}`,
              label: agentName(a),
              icon: <ProviderIcon provider={a} />,
              group: "Agents",
            }))
          : []),
        ...projects.map(({ key, project, at }) => ({
          value: `project:${key}`,
          label: project.scratch ? "Scratchpad" : project.name,
          detail: at ? relativeDate(new Date(at).toISOString()) : undefined,
          icon: <ProjectBadge project={project} />,
          group: "Projects",
        })),
      ]}
      onChange={(value) => {
        const [kind, id] = value.split(/:(.*)/);
        toggle(kind === "agent" ? "agents" : "projects", id);
      }}
      action={count ? { label: "Clear filter", onSelect: clear } : undefined}
    />
  );
}
