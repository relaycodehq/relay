// Options for splitting a PR's changed files into unviewed and viewed.
// Open http://127.0.0.1:5177/previews/review-viewed.html (?option=fold|sink)
import "./desktop-stub";
import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  FileCode2,
  GitPullRequest,
  Info,
  Layers3,
  Search,
} from "lucide-react";
import "../src/styles.css";
import "./chrome.css";
import "./review-viewed.css";
import { initAppearance } from "../src/lib/appearance";
import { initWindowFocus } from "../src/lib/window-focus";
import type { ChangedFile } from "../shared/types";
import {
  changedSinceViewed,
  files,
  groups as sampleGroups,
  initiallyViewed,
  sampleDiff,
  type SampleGroup,
} from "./review-viewed-data";

initAppearance();
initWindowFocus();

const options = [
  {
    id: "fold",
    label: "A · Fold away",
    idea: "Viewed files drop into a collapsed section at the bottom. Click it to look back.",
  },
  {
    id: "sink",
    label: "B · Sink and dim",
    idea: "Viewed files stay listed below a divider as compact one-line rows.",
  },
] as const;
type Option = (typeof options)[number]["id"];

type Row =
  | { type: "file"; file: ChangedFile; grouped: boolean; viewedSection: boolean }
  | { type: "group"; group: SampleGroup }
  | { type: "label"; text: string }
  | { type: "fold"; count: number }
  | { type: "divider"; count: number }
  | { type: "done" };

const params = new URLSearchParams(location.search);
const byPath = new Map(files.map((f) => [f.filename, f]));

function Preview() {
  const [option, setOption] = useState<Option>(
    () => options.find((o) => o.id === params.get("option"))?.id ?? "fold",
  );
  const [withGroups, setWithGroups] = useState(true);
  const [viewed, setViewed] = useState(() => new Set(initiallyViewed));
  const [selected, setSelected] = useState(files[1].filename);
  const [filter, setFilter] = useState("");
  const [foldOpen, setFoldOpen] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  // Rows marked viewed while the pointer is on the list keep their place until
  // it leaves, so nothing moves under the cursor.
  const [held, setHeld] = useState<Set<string>>(new Set());
  const pointerOnList = useRef(false);

  useEffect(() => {
    const url = new URL(location.href);
    url.searchParams.set("option", option);
    history.replaceState(null, "", url);
  }, [option]);

  const groups = withGroups ? sampleGroups : [];
  const settled = (p: string) => viewed.has(p) && !held.has(p);

  const setViewedPaths = (paths: string[], on: boolean) => {
    setViewed((prev) => {
      const next = new Set(prev);
      for (const p of paths) on ? next.add(p) : next.delete(p);
      return next;
    });
    if (on && pointerOnList.current)
      setHeld((prev) => new Set([...prev, ...paths]));
  };

  const toggleSelected = () => {
    const marking = !viewed.has(selected);
    setViewedPaths([selected], marking);
    if (!marking) return;
    const start = files.findIndex((f) => f.filename === selected);
    const unread = (f: ChangedFile) =>
      !viewed.has(f.filename) && f.filename !== selected;
    const next =
      files.slice(start + 1).find(unread) ?? files.slice(0, start).find(unread);
    if (next) setSelected(next.filename);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "v" || e.repeat || (e.target as HTMLElement).closest("input"))
        return;
      toggleSelected();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const rows = useMemo(() => {
    const matches = (f: ChangedFile) =>
      f.filename.toLowerCase().includes(filter.toLowerCase());
    const grouped = new Set(groups.flatMap((g) => g.paths));
    const membersOf = (g: SampleGroup) =>
      g.paths.map((p) => byPath.get(p)!).filter(matches);
    const groupDone = (g: SampleGroup) => g.paths.every(settled);
    const pushGroup = (out: Row[], g: SampleGroup) => {
      const members = membersOf(g);
      if (!members.length) return;
      out.push({ type: "group", group: g });
      if (open.has(g.id) || filter)
        out.push(
          ...members.map(
            (file) =>
              ({ type: "file", file, grouped: true, viewedSection: false }) as Row,
          ),
        );
    };

    const top: Row[] = [];
    for (const g of groups) if (!groupDone(g)) pushGroup(top, g);
    const loose = files.filter((f) => !grouped.has(f.filename) && matches(f));
    const todo = loose.filter((f) => !settled(f.filename));
    if (todo.length && groups.length)
      top.push({ type: "label", text: `Individual changes · ${todo.length}` });
    top.push(
      ...todo.map(
        (file) =>
          ({ type: "file", file, grouped: false, viewedSection: false }) as Row,
      ),
    );

    const bottom: Row[] = [];
    const doneGroups = groups.filter(groupDone);
    for (const g of doneGroups) pushGroup(bottom, g);
    const viewedLoose = loose.filter((f) => settled(f.filename));
    bottom.push(
      ...viewedLoose.map(
        (file) =>
          ({ type: "file", file, grouped: false, viewedSection: true }) as Row,
      ),
    );
    const count =
      viewedLoose.length +
      doneGroups.reduce((n, g) => n + membersOf(g).length, 0);

    if (!top.length && !filter) top.push({ type: "done" });
    if (!bottom.length) return top;
    if (option === "fold")
      return [
        ...top,
        { type: "fold", count } as Row,
        ...(foldOpen || filter ? bottom : []),
      ];
    return [...top, { type: "divider", count } as Row, ...bottom];
  }, [groups, viewed, held, filter, open, option, foldOpen]);

  // Selecting a viewed file (search, ↑/↓, a link) opens the fold it sits in.
  useEffect(() => {
    if (option === "fold" && settled(selected) && !foldOpen) setFoldOpen(true);
    document
      .querySelector(".rv-list .file-row.active")
      ?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const selectedFile = byPath.get(selected)!;
  const isRead = viewed.has(selected);
  const current = options.find((o) => o.id === option)!;

  return (
    <div className="preview-app">
      <div className="preview-bar">
        <strong>
          <GitPullRequest size={14} /> Review · viewed files
        </strong>
        <span className="preview-tag">Sample data</span>
        <div className="preview-segmented" role="radiogroup" aria-label="Option">
          {options.map((o) => (
            <button
              key={o.id}
              role="radio"
              aria-checked={option === o.id}
              onClick={() => setOption(o.id)}
            >
              {o.label}
            </button>
          ))}
        </div>
        <span>{current.idea}</span>
        <span className="preview-control">
          Change groups
          <span className="preview-segmented" role="radiogroup">
            <button
              role="radio"
              aria-checked={withGroups}
              onClick={() => setWithGroups(true)}
            >
              On
            </button>
            <button
              role="radio"
              aria-checked={!withGroups}
              onClick={() => setWithGroups(false)}
            >
              Off
            </button>
          </span>
        </span>
        <button
          className="text-button"
          onClick={() => {
            setViewed(new Set(initiallyViewed));
            setHeld(new Set());
            setFoldOpen(false);
            setOpen(new Set());
            setFilter("");
            setSelected(files[1].filename);
          }}
        >
          Reset
        </button>
      </div>
      <div className={`rv-body rv-option-${option}`}>
        <section className="files-pane" aria-label="Changed files">
          <div className="files-controls">
            <div className="search-field">
              <Search size={15} />
              <input
                aria-label="Filter files"
                placeholder="Filter files…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
          </div>
          <div className="files-context">
            <span>relay/licensing</span>
            <span>
              {viewed.size}/{files.length} viewed
            </span>
          </div>
          <div
            className="rv-list"
            onPointerEnter={() => (pointerOnList.current = true)}
            onPointerLeave={() => {
              pointerOnList.current = false;
              setHeld(new Set());
            }}
          >
            {rows.map((row, i) => (
              <ListRow
                key={
                  row.type === "file"
                    ? row.file.filename
                    : row.type === "group"
                      ? row.group.id
                      : `${row.type}-${i}`
                }
                row={row}
                option={option}
                selected={selected}
                viewed={viewed}
                open={open}
                foldOpen={foldOpen || !!filter}
                onSelect={setSelected}
                onFold={() => setFoldOpen((v) => !v)}
                onToggleGroup={(id) =>
                  setOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onReviewGroup={(g) =>
                  setViewedPaths(
                    g.paths,
                    !g.paths.every((p) => viewed.has(p)),
                  )
                }
              />
            ))}
          </div>
        </section>
        <main className="rv-diff">
          <div className="rv-diff-head">
            <code>{selected}</code>
            {!isRead && changedSinceViewed.has(selected) && (
              <span className="read-changed">Changed since viewed</span>
            )}
            <button
              className={`read-button ${isRead ? "is-read" : ""}`}
              onClick={toggleSelected}
            >
              <span className="checkbox">{isRead && <Check size={11} />}</span>
              Viewed<kbd>V</kbd>
            </button>
          </div>
          <div className="rv-diff-body" aria-label="Sample diff">
            <p className="rv-diff-note">
              Sample diff · press V or tick Viewed to mark this file and jump to
              the next unviewed one
            </p>
            {sampleDiff.map((line, i) => (
              <div
                key={i}
                className={`rv-line ${line[0] === "+" ? "add" : line[0] === "-" ? "del" : ""}`}
              >
                {line}
              </div>
            ))}
            <p className="rv-diff-note">
              {selectedFile.status === "added" ? "New file" : "Modified"} ·
              Hover the file list, then mark a group viewed: it stays put until
              the pointer leaves the list.
            </p>
          </div>
        </main>
      </div>
    </div>
  );
}

function ListRow({
  row,
  option,
  selected,
  viewed,
  open,
  foldOpen,
  onSelect,
  onFold,
  onToggleGroup,
  onReviewGroup,
}: {
  row: Row;
  option: Option;
  selected: string;
  viewed: Set<string>;
  open: Set<string>;
  foldOpen: boolean;
  onSelect: (path: string) => void;
  onFold: () => void;
  onToggleGroup: (id: string) => void;
  onReviewGroup: (group: SampleGroup) => void;
}) {
  if (row.type === "done")
    return (
      <div className="rv-done">
        <CheckCheck size={15} /> Every file is viewed
      </div>
    );
  if (row.type === "label")
    return <div className="file-section-label">{row.text}</div>;
  if (row.type === "fold")
    return (
      <button className="rv-fold" aria-expanded={foldOpen} onClick={onFold}>
        {foldOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        Viewed
        <span>{row.count}</span>
      </button>
    );
  if (row.type === "divider")
    return (
      <div className="rv-divider">
        Viewed · {row.count}
      </div>
    );
  if (row.type === "group") {
    const { group } = row,
      count = group.paths.filter((p) => viewed.has(p)).length,
      done = count === group.paths.length,
      expanded = open.has(group.id);
    return (
      <div className={`change-group ${done ? "is-viewed" : ""}`}>
        <div className="group-heading-row">
          <button
            className="group-heading"
            aria-expanded={expanded}
            onClick={() => onToggleGroup(group.id)}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <strong>{group.name}</strong>
            <span>{group.paths.length}</span>
          </button>
          <button
            className="group-info icon-button"
            aria-label={`About ${group.name}`}
          >
            <Info size={15} />
          </button>
        </div>
        <div className="group-bottom">
          <span>
            {done ? <CheckCheck size={12} /> : <Layers3 size={12} />} {count}/
            {group.paths.length} viewed
          </span>
          <button onClick={() => onReviewGroup(group)}>
            {done ? "Mark as unviewed" : "Mark as viewed"}
          </button>
        </div>
      </div>
    );
  }
  const f = row.file,
    parts = f.filename.split("/"),
    name = parts.pop(),
    read = viewed.has(f.filename),
    changed = !read && changedSinceViewed.has(f.filename),
    compact = option === "sink" && row.viewedSection;
  return (
    <button
      className={`file-row ${row.grouped ? "group-member" : ""} ${selected === f.filename ? "active" : ""} ${read ? "read" : ""} ${compact ? "rv-compact" : ""}`}
      title={f.filename}
      onClick={() => onSelect(f.filename)}
    >
      {read ? <Check size={compact ? 13 : 15} /> : <FileCode2 size={15} />}
      <div>
        <strong>{name}</strong>
        <small>
          {changed && "Changed since viewed · "}
          {parts.join("/") || "Repository root"}
        </small>
      </div>
      <span className={`file-status ${f.status}`}>
        {f.status === "added"
          ? "A"
          : f.status === "deleted"
            ? "D"
            : f.status === "renamed"
              ? "R"
              : "M"}
      </span>
    </button>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
