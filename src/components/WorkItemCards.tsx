import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Bug,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Crown,
  ExternalLink,
  EyeOff,
  RefreshCw,
  Search,
  Sparkles,
  SquareCheckBig,
  Trophy,
  X,
} from "lucide-react";
import type { WorkItem } from "../../shared/devops";
import type { Project } from "../../shared/projects";
import { api } from "../lib/api";
import { useDevOpsStatus } from "./DevOpsSettings";
import { relativeDate } from "./ui";
import "./work-items.css";

/** Azure Boards colours by state name; unknown states stay neutral. */
const stateTone = (state: string) => {
  const s = state.toLowerCase();
  if (/hold|block/.test(s)) return "orange";
  if (/test|review|verif/.test(s)) return "green";
  if (/shap|design|analy|refin/.test(s)) return "purple";
  if (/active|progress|doing|commit|develop/.test(s)) return "blue";
  if (/new|proposed|to do|todo|backlog/.test(s)) return "gray";
  return "teal";
};

/** Azure Boards icons and colours by work item type. */
function TypeIcon({ type }: { type: string }) {
  const t = type.toLowerCase();
  const [Icon, color] = t.includes("bug")
    ? [Bug, "#cc293d"]
    : t.includes("story") || t.includes("requirement")
      ? [BookOpen, "#009ccc"]
      : t.includes("task")
        ? [SquareCheckBig, "#d8a800"]
        : t.includes("feature")
          ? [Trophy, "#773b93"]
          : t.includes("epic")
            ? [Crown, "#ff7b00"]
            : [CircleDot, "var(--muted)"];
  return (
    <Icon
      className="work-item-type"
      size={13}
      style={{ color }}
      aria-label={type}
    />
  );
}

/** The last segment of an area path, e.g. `Software\WEB` → `WEB`. */
const areaName = (path: string) => path.split("\\").at(-1) || path;

/** The attached work item above the composer. */
export function WorkItemChip({
  item,
  onRemove,
}: {
  item: WorkItem;
  onRemove: () => void;
}) {
  return (
    <div className="work-item-chip">
      <TypeIcon type={item.type} />
      <span className="work-item-id">#{item.id}</span>
      <span className="work-item-chip-title" title={item.title}>
        {item.title}
      </span>
      <span className={`work-item-state tone-${stateTone(item.state)}`}>
        {item.state}
      </span>
      <button
        type="button"
        aria-label="Remove work item"
        title="Remove work item"
        onClick={onRemove}
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function WorkItemCards({
  project,
  selected,
  onPick,
}: {
  project: Project;
  selected?: number;
  onPick: (item: WorkItem) => void;
}) {
  const status = useDevOpsStatus(),
    qc = useQueryClient();
  const settings = status.data?.settings;
  const hidden = !!settings?.hiddenProjects.includes(project.id);
  const enabled = !!settings?.enabled && !hidden;
  // Set once this card row hid the project, so the user can take it back.
  const [justHidden, setJustHidden] = useState(false);
  const [hideError, setHideError] = useState<string>();
  const setHidden = async (hide: boolean) => {
    if (!settings) return;
    setHideError(undefined);
    const others = settings.hiddenProjects.filter((id) => id !== project.id);
    try {
      const next = await api.saveDevOpsSettings(
        {
          ...settings,
          hiddenProjects: hide ? [...others, project.id] : others,
        },
        {},
      );
      qc.setQueryData(["devops-status"], next);
      setJustHidden(hide);
    } catch (e) {
      setHideError(
        e instanceof Error ? e.message : "The setting could not be saved.",
      );
    }
  };
  const items = useQuery({
    queryKey: ["devops-items", project.id],
    queryFn: () => api.devopsWorkItems(project.id),
    enabled,
    staleTime: 2 * 60_000,
    retry: false,
  });
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const data = items.data;
  const matched = useMemo(
    () =>
      data?.relevance
        ? data.items.filter(
            (w) => (data.relevance![w.id] ?? 0) >= data.threshold,
          )
        : null,
    [data],
  );
  const pool = matched && !showAll ? matched : (data?.items ?? []);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = pool.filter((w) => {
    const text = [w.id, w.title, w.type, w.state, w.areaPath, w.tags.join(" ")]
      .join(" ")
      .toLowerCase();
    return words.every((word) => text.includes(word));
  });

  // The row fades out only on the sides that have more cards to scroll to.
  const measure = () => {
    const el = row.current;
    if (!el) return;
    setEdges({
      start: el.scrollLeft <= 1,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
    });
  };
  useEffect(() => {
    measure();
    const el = row.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [shown.length, !!data]);

  if (hidden && justHidden)
    return (
      <p className="work-items-note work-items-hidden" role="status">
        Work items are hidden in {project.name}.{" "}
        <button className="link" onClick={() => void setHidden(false)}>
          Undo
        </button>
        {hideError && <span className="error"> {hideError}</span>}
      </p>
    );
  if (!enabled) return null;
  const page = (direction: 1 | -1) =>
    row.current?.scrollBy({
      left: direction * row.current.clientWidth * 0.6,
      behavior: "smooth",
    });

  return (
    <section className="work-items" aria-label="Your work items">
      <header className="work-items-header">
        <h2>
          Your work items
          {data && <small>{pool.length}</small>}
        </h2>
        {matched && (
          <div
            className="work-items-scope"
            role="group"
            aria-label="Which work items to show"
          >
            <button
              className={!showAll ? "active" : ""}
              aria-pressed={!showAll}
              title="Items Jev matched to this project"
              onClick={() => setShowAll(false)}
            >
              <Sparkles size={11} />
              {project.name}
            </button>
            <button
              className={showAll ? "active" : ""}
              aria-pressed={showAll}
              onClick={() => setShowAll(true)}
            >
              All
            </button>
          </div>
        )}
        <label className="work-items-search">
          <Search size={12} />
          <input
            aria-label="Search work items"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && query) {
                e.stopPropagation();
                setQuery("");
              }
            }}
          />
          {query && (
            <button aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={11} />
            </button>
          )}
        </label>
        <div className="work-items-tools">
          <button
            aria-label="Scroll work items left"
            disabled={edges.start}
            onClick={() => page(-1)}
          >
            <ChevronLeft size={14} />
          </button>
          <button
            aria-label="Scroll work items right"
            disabled={edges.end}
            onClick={() => page(1)}
          >
            <ChevronRight size={14} />
          </button>
          <button
            aria-label="Refresh work items"
            title="Refresh work items"
            disabled={items.isFetching}
            onClick={() => {
              setRefreshing(true);
              // Bypass the main process cache, then pick up its fresh answer.
              void api
                .devopsWorkItems(project.id, true)
                .then(() => items.refetch())
                .catch(() => items.refetch())
                .finally(() => setRefreshing(false));
            }}
          >
            <RefreshCw
              size={12}
              className={refreshing || items.isFetching ? "spin" : ""}
            />
          </button>
          <button
            aria-label={`Hide work items in ${project.name}`}
            title="Hide work items in this project"
            onClick={() => void setHidden(true)}
          >
            <EyeOff size={12} />
          </button>
        </div>
      </header>
      {hideError && (
        <p className="work-items-note error" role="alert">
          {hideError}
        </p>
      )}
      {data?.filterError && (
        <p className="work-items-note" role="status">
          Showing every item: {data.filterError}
        </p>
      )}
      {items.error ? (
        <p className="work-items-note error" role="alert">
          {items.error instanceof Error
            ? items.error.message
            : "Work items could not be loaded."}{" "}
          <button className="link" onClick={() => void items.refetch()}>
            Try again
          </button>
        </p>
      ) : !data || shown.length ? (
        <div
          ref={row}
          className="work-items-row"
          data-fade-start={!edges.start || undefined}
          data-fade-end={!edges.end || undefined}
          aria-busy={!data}
          onScroll={measure}
        >
          {!data
            ? [0, 1, 2, 3].map((i) => (
                <div key={i} className="work-item-card skeleton" />
              ))
            : shown.map((w) => {
                const isSelected = w.id === selected;
                return (
                  <article
                    key={w.id}
                    className={`work-item-card ${isSelected ? "selected" : ""}`}
                  >
                    <button
                      className="work-item-pick"
                      aria-pressed={isSelected}
                      title={
                        isSelected
                          ? "Remove from the message"
                          : "Attach to your message"
                      }
                      onClick={() => onPick(w)}
                    >
                      <span className="work-item-meta">
                        <TypeIcon type={w.type} />
                        <span className="work-item-id">#{w.id}</span>
                        {w.changed && (
                          <time dateTime={w.changed}>
                            {relativeDate(w.changed)}
                          </time>
                        )}
                      </span>
                      <strong className="work-item-title">{w.title}</strong>
                      <span className="work-item-footer">
                        <span
                          className={`work-item-state tone-${stateTone(w.state)}`}
                        >
                          {w.state}
                        </span>
                        <span className="work-item-area" title={w.areaPath}>
                          {areaName(w.areaPath)}
                        </span>
                        {w.tags.slice(0, 2).map((t) => (
                          <span key={t} className="work-item-tag">
                            {t}
                          </span>
                        ))}
                      </span>
                    </button>
                    {isSelected && (
                      <span className="work-item-check" aria-hidden="true">
                        <Check size={11} strokeWidth={3} />
                      </span>
                    )}
                    <button
                      className="work-item-open"
                      aria-label={`Open #${w.id} in Azure DevOps`}
                      title="Open in Azure DevOps"
                      onClick={() => void api.openExternal(w.url)}
                    >
                      <ExternalLink size={12} />
                    </button>
                  </article>
                );
              })}
        </div>
      ) : (
        <p className="work-items-note">
          {words.length
            ? `No work items match “${query.trim()}”.`
            : matched && !showAll && data.items.length
              ? `None of your ${data.items.length} work items look like ${project.name}.`
              : "Nothing open is assigned to you."}
          {matched && !showAll && data.items.length > 0 && (
            <>
              {" "}
              <button className="link" onClick={() => setShowAll(true)}>
                Show all
              </button>
            </>
          )}
        </p>
      )}
    </section>
  );
}
