import { useRef, useState, type RefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Combobox } from "@base-ui/react/combobox";
import { Check, Monitor, Search, Server, ServerOff } from "lucide-react";
import { shortHost, type PairedComputer } from "../../../shared/handoff";
import { api } from "../../lib/api";
import { ProjectBadge } from "./ProjectBadge";
import { MiddleTruncate } from "../../ui/MiddleTruncate";
import type { ChatSummary, Project } from "../../../shared/projects";
import "./projects.css";

/**
 * The project in view first, then the rest by their latest thread activity.
 * Ordered once on mount: running threads keep bumping `updated`, and rows
 * moving under the pointer would pick the wrong project.
 */
function useOpenOrder(projects: Project[], current: string | null) {
  const qc = useQueryClient();
  const [order] = useState(() => {
    const lastActive = (id: string) =>
      Math.max(
        0,
        ...(qc.getQueryData<ChatSummary[]>(["project-chats", id]) ?? []).map(
          (c) => c.updated,
        ),
      );
    return [...projects]
      .sort(
        (a, b) =>
          Number(b.id === current) - Number(a.id === current) ||
          lastActive(b.id) - lastActive(a.id),
      )
      .map((p) => p.id);
  });
  const rank = (p: Project) => {
    const i = order.indexOf(p.id);
    return i < 0 ? order.length : i;
  };
  return [...projects].sort((a, b) => rank(a) - rank(b));
}

export function ProjectSearch({
  projects,
  current,
  input,
  onSelect,
  onEscape,
}: {
  projects: Project[];
  /** The project in view, chosen until another is picked. */
  current: string | null;
  input: RefObject<HTMLInputElement | null>;
  onSelect: (project: Project) => void;
  onEscape: () => void;
}) {
  const [search, setSearch] = useState("");
  const highlighted = useRef<string | null>(null);
  const query = search.trim().toLocaleLowerCase();
  // The same list handoff keeps; asked here, as projects doesn't import handoff.
  const paired = useQuery({
    queryKey: ["paired-computers"],
    queryFn: () => api.pairedComputers(),
    staleTime: 10_000,
    enabled: projects.some((p) => p.computer),
  });
  const matches = useOpenOrder(projects, current).filter((item) =>
    `${item.name} ${item.path} ${item.computer?.name ?? ""}`
      .toLocaleLowerCase()
      .includes(query),
  );

  return (
    <Combobox.Root<string>
      inline
      open
      // The root types this as boolean but passes it through; "always" starts
      // on the first row, so the first ArrowDown doesn't just land on it.
      autoHighlight={"always" as unknown as boolean}
      items={matches.map((item) => item.id)}
      filter={null}
      inputValue={search}
      onInputValueChange={(value) => {
        highlighted.current = null;
        setSearch(value);
      }}
      onItemHighlighted={(value) => {
        highlighted.current = value ?? null;
      }}
      value={current}
      onValueChange={(value) => {
        const next = projects.find((item) => item.id === value);
        if (next) onSelect(next);
      }}
    >
      <div className="headline-project-search">
        <Search size={15} aria-hidden />
        <Combobox.Input
          ref={input}
          aria-label="Search projects"
          placeholder="Search projects…"
          autoComplete="off"
          spellCheck={false}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onEscape();
            }
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            const next =
              matches.find((item) => item.id === highlighted.current) ??
              matches[0];
            if (!next) return;
            (
              event as typeof event & {
                preventBaseUIHandler?: () => void;
              }
            ).preventBaseUIHandler?.();
            event.preventDefault();
            event.stopPropagation();
            onSelect(next);
          }}
        />
      </div>
      <div className="headline-project-scroll">
        {matches.length ? (
          <Combobox.List aria-label="Projects">
            {matches.map((item) => (
              <Combobox.Item
                key={item.id}
                value={item.id}
                aria-label={`${item.name} · ${item.computer ? `on ${item.computer.name}, ` : ""}${item.path}`}
                className={`headline-project-row ${item.computer && hostState(item.computer.id, paired.data) === "gone" ? "gone" : ""}`}
                onClick={() => {
                  // Picking the selected value fires no change.
                  if (item.id === current) onSelect(item);
                }}
              >
                <ProjectBadge project={item} />
                <span className="headline-project-row-label">
                  <strong>{item.name}</strong>
                  {item.computer ? (
                    <ProjectAddress
                      project={item}
                      computer={item.computer}
                      paired={paired.data}
                    />
                  ) : (
                    <MiddleTruncate
                      className="headline-project-path"
                      text={item.path}
                      kind="path"
                    />
                  )}
                </span>
                {item.computer &&
                  hostState(item.computer.id, paired.data) === "gone" && (
                    <span className="headline-project-note">not paired</span>
                  )}
                {item.id === current && <Check size={14} aria-hidden />}
              </Combobox.Item>
            ))}
          </Combobox.List>
        ) : (
          <p className="headline-project-empty">No matching projects.</p>
        )}
      </div>
    </Combobox.Root>
  );
}

type HostState = "on" | "connecting" | "offline" | "gone";

/** How the computer a project lives on is doing; "on" until the list says. */
function hostState(
  id: string,
  paired: readonly PairedComputer[] | undefined,
): HostState {
  if (!paired) return "on";
  const c = paired.find((x) => x.id === id);
  if (!c) return "gone";
  if (c.status === "online" || c.asleep) return "on";
  return c.status === "connecting" ? "connecting" : "offline";
}

const hostWord: Record<HostState, string> = {
  on: "connected",
  connecting: "connecting",
  offline: "offline",
  gone: "not paired anymore",
};

/**
 * Where a project on another computer lives, as ssh writes it: `host:path`.
 * A path there reads like one here; the host says which computer it's on.
 */
function ProjectAddress({
  project,
  computer,
  paired,
}: {
  project: Project;
  computer: NonNullable<Project["computer"]>;
  paired: readonly PairedComputer[] | undefined;
}) {
  const state = hostState(computer.id, paired);
  const wsl = paired?.find((c) => c.id === computer.id)?.route?.kind === "wsl";
  const Icon = state === "gone" ? ServerOff : wsl ? Monitor : Server;
  return (
    <span
      className="headline-project-address"
      title={`${computer.name}:${project.path} · ${hostWord[state]}`}
    >
      <span className={`headline-project-host ${state}`}>
        <Icon size={11} aria-hidden />
        <span>{shortHost(computer.name)}</span>
      </span>
      <span className="headline-project-colon">:</span>
      <MiddleTruncate
        className="headline-project-path"
        text={project.path}
        kind="path"
      />
    </span>
  );
}
