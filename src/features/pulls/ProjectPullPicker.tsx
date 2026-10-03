// Searchable picker adapted from T3 Code's ref and pull-request candidate pickers.
// See THIRD_PARTY_NOTICES.md.
import { useRef, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Popover } from "@base-ui/react/popover";
import { Combobox } from "@base-ui/react/combobox";
import { ChevronDown, GitPullRequest, RefreshCw, Search } from "lucide-react";
import type { Project } from "../../../shared/projects";
import type { PullRef } from "../../../shared/types";
import { api } from "../../lib/api";
import "./pull-picker.css";

type PullState = "open" | "closed" | "all";

export function ProjectPullPicker({
  project,
  selected,
  onSelect,
  placement = "top",
  disabled = false,
  compact = false,
}: {
  project: Project;
  selected: PullRef | null;
  onSelect: (ref: PullRef) => void;
  placement?: "top" | "bottom";
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PullState>("open");
  const [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const highlighted = useRef<string | null>(null);
  const list = useInfiniteQuery({
    queryKey: ["project-pulls", project.id, state],
    queryFn: ({ pageParam }) => api.projectPulls(project.id, state, pageParam),
    initialPageParam: 1,
    getNextPageParam: (page) => page.nextPage ?? undefined,
    enabled: open,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const query = search.trim().toLocaleLowerCase();
  const matches = items.filter((pull) =>
    `${pull.number} ${pull.title} ${pull.user.login}`
      .toLocaleLowerCase()
      .includes(query),
  );

  function select(number: number) {
    if (!project.repository) return;
    onSelect({ ...project.repository, number });
    setOpen(false);
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSearch("");
          highlighted.current = null;
        }
      }}
    >
      <Popover.Trigger
        type="button"
        className={
          compact
            ? `thread-context-button ${selected ? "selected" : ""}`
            : "project-pull-trigger"
        }
        aria-label={selected ? `PR #${selected.number}` : "Review a PR"}
        disabled={disabled}
      >
        <GitPullRequest size={compact ? 14 : 16} aria-hidden />
        <span>
          {selected
            ? `PR #${selected.number}`
            : compact
              ? "Review a PR"
              : "Choose a pull request"}
        </span>
        <ChevronDown size={compact ? 12 : 14} aria-hidden />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          className="project-pull-positioner"
          side={placement}
          align="start"
          sideOffset={7}
          collisionPadding={12}
        >
          <Popover.Popup
            className="project-pull-popup"
            aria-label="Choose a pull request"
            initialFocus={input}
          >
            <Combobox.Root<string>
              inline
              open
              autoHighlight
              items={matches.map((pull) => String(pull.number))}
              filter={null}
              inputValue={search}
              onInputValueChange={(value) => {
                highlighted.current = null;
                setSearch(value);
              }}
              onItemHighlighted={(value) => {
                highlighted.current = value ?? null;
              }}
              value={selected ? String(selected.number) : null}
              onValueChange={(value) => {
                if (value) select(Number(value));
              }}
            >
              <div className="project-pull-search">
                <Search size={16} aria-hidden />
                <Combobox.Input
                  ref={input}
                  aria-label="Search pull requests"
                  placeholder="Search pull requests…"
                  autoComplete="off"
                  spellCheck={false}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      setOpen(false);
                    }
                    if (
                      event.key !== "Enter" ||
                      event.nativeEvent.isComposing ||
                      event.keyCode === 229
                    )
                      return;
                    const first = matches[0];
                    const number = highlighted.current
                      ? matches.find(
                          (pull) => String(pull.number) === highlighted.current,
                        )?.number
                      : first?.number;
                    if (number === undefined) return;
                    (
                      event as typeof event & {
                        preventBaseUIHandler?: () => void;
                      }
                    ).preventBaseUIHandler?.();
                    event.preventDefault();
                    event.stopPropagation();
                    select(number);
                  }}
                />
              </div>
              <div className="project-pull-options">
                <div
                  className="project-pull-states"
                  role="group"
                  aria-label="Pull request state"
                >
                  {(["open", "closed", "all"] as const).map((option) => (
                    <button
                      key={option}
                      type="button"
                      aria-pressed={state === option}
                      onClick={() => {
                        setState(option);
                        highlighted.current = null;
                        input.current?.focus();
                      }}
                    >
                      {option[0].toUpperCase() + option.slice(1)}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="project-pull-refresh"
                  aria-label="Refresh pull requests"
                  title="Refresh pull requests"
                  onClick={() => void list.refetch()}
                >
                  <RefreshCw size={14} aria-hidden />
                </button>
              </div>
              <div className="project-pull-scroll">
                {list.isPending ? (
                  <p className="project-pull-status">Loading pull requests…</p>
                ) : list.error ? (
                  <div className="project-pull-status" role="alert">
                    Couldn’t load pull requests.{" "}
                    <button type="button" onClick={() => void list.refetch()}>
                      Retry
                    </button>
                  </div>
                ) : matches.length ? (
                  <Combobox.List aria-label="Pull requests">
                    {matches.map((pull, index) => (
                      <Combobox.Item
                        key={pull.number}
                        value={String(pull.number)}
                        index={index}
                        aria-label={`#${pull.number} ${pull.title} by ${pull.user.login}`}
                        className="project-pull-row"
                        onClick={() => {
                          if (selected?.number === pull.number)
                            select(pull.number);
                        }}
                      >
                        <span className="project-pull-row-title">
                          {pull.title}
                        </span>
                        <span className="project-pull-row-detail">
                          #{pull.number} · {pull.user.login}
                        </span>
                      </Combobox.Item>
                    ))}
                  </Combobox.List>
                ) : (
                  <p className="project-pull-status">
                    {search
                      ? "No matching pull requests in loaded results."
                      : "No pull requests in this view."}
                  </p>
                )}
                {list.hasNextPage && (
                  <button
                    type="button"
                    className="project-pull-more"
                    disabled={list.isFetchingNextPage}
                    onClick={() => void list.fetchNextPage()}
                  >
                    {list.isFetchingNextPage
                      ? "Loading…"
                      : "Load more pull requests"}
                  </button>
                )}
              </div>
            </Combobox.Root>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
