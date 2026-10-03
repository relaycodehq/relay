// The thread header, squeezed: the current one against three tighter takes.
// Open http://127.0.0.1:5177/previews/compact-header/
import "../_shared/desktop-stub";
import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  AlertTriangle,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  Files,
  GitBranch,
  GitCompareArrows,
  GitGraph,
  Info,
  MessageSquare,
  MonitorUp,
  PanelBottom,
  PanelLeft,
} from "lucide-react";
import "../../src/styles.css";
import "../../src/app/projects.css";
import "../../src/ui/workspace-panes.css";
import "../../src/features/changes/git-actions.css";
import "../../src/app/ci-status.css";
import "../../src/features/sidebar/sidebar.css";
import "../_shared/chrome.css";
import "./compact-header.css";
import { initAppearance } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { RelayMark } from "../../src/ui/RelayMark";

initAppearance();
initWindowFocus();

type Variant = "now" | "a" | "b" | "c";
type PaneId = "chat" | "changes" | "files" | "history";

const variants: { id: Variant; label: string; about: string }[] = [
  { id: "now", label: "Now", about: "What ships today." },
  {
    id: "a",
    label: "A · Trim the noise",
    about:
      "Checks show only what needs fixing, idle Push folds into one Git button, terminal and handoff join the pane strip. Labels stay.",
  },
  {
    id: "b",
    label: "B · Label the open panes",
    about:
      "A, plus closed panes drop to icons. The label tells you what's showing; icons are the switches.",
  },
  {
    id: "c",
    label: "C · Icons only",
    about:
      "A, plus every pane is an icon with a tooltip. Changes keeps its +/− so the one number that matters stays visible.",
  },
];

const PANES: { id: PaneId; label: string; icon: ReactNode }[] = [
  { id: "chat", label: "Chat", icon: <MessageSquare size={14} /> },
  { id: "changes", label: "Changes", icon: <GitCompareArrows size={14} /> },
  { id: "files", label: "Files", icon: <Files size={14} /> },
  { id: "history", label: "History", icon: <GitGraph size={14} /> },
];

type Sample = {
  errors: number;
  warnings: number;
  suggestions: number;
  ahead: number;
  lines?: { additions: number; deletions: number };
};

const samples: Record<string, Sample> = {
  clean: { errors: 0, warnings: 0, suggestions: 25, ahead: 0 },
  dirty: {
    errors: 2,
    warnings: 5,
    suggestions: 25,
    ahead: 0,
    lines: { additions: 48, deletions: 12 },
  },
  ahead: {
    errors: 0,
    warnings: 1,
    suggestions: 25,
    ahead: 3,
    lines: { additions: 48, deletions: 12 },
  },
};

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="preview-segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function ChecksNow({ s }: { s: Sample }) {
  const Icon = s.errors
    ? AlertCircle
    : s.warnings
      ? AlertTriangle
      : s.suggestions
        ? Info
        : CheckCircle2;
  const severity = s.errors
    ? "error"
    : s.warnings
      ? "warning"
      : s.suggestions
        ? "info"
        : "clean";
  return (
    <button className={`checks-button ${s.errors ? "has-errors" : ""}`}>
      <Icon size={16} className={`diagnostic-icon ${severity}`} />
      <span>
        {plural(s.errors, "error")} · {plural(s.warnings, "warning")} ·{" "}
        {plural(s.suggestions, "suggestion")}
      </span>
    </button>
  );
}

/** Only what needs fixing; suggestions live in the tooltip and the modal. */
function ChecksTight({ s }: { s: Sample }) {
  const title = `${plural(s.errors, "error")} · ${plural(s.warnings, "warning")} · ${plural(s.suggestions, "suggestion")}`;
  return (
    <button className="ch-checks" title={title} aria-label={title}>
      {!s.errors && !s.warnings ? (
        <CheckCircle2 size={15} className="ch-ok" />
      ) : (
        <>
          {!!s.errors && (
            <span className="ch-count error">
              <AlertCircle size={14} />
              {s.errors}
            </span>
          )}
          {!!s.warnings && (
            <span className="ch-count warning">
              <AlertTriangle size={14} />
              {s.warnings}
            </span>
          )}
        </>
      )}
    </button>
  );
}

function GitNow({ s }: { s: Sample }) {
  return (
    <div className="git-actions">
      <button className="git-actions-main" disabled={!s.ahead}>
        <ArrowUp size={14} />
        Push
      </button>
      <button className="git-actions-more" aria-label="More Git actions">
        <ChevronDown size={13} />
      </button>
    </div>
  );
}

/** Idle: one icon that opens the menu. Something to push: the label earns its room. */
function GitTight({ s }: { s: Sample }) {
  if (!s.ahead)
    return (
      <button className="ch-icon" title="Git actions" aria-label="Git actions">
        <GitBranch size={14} />
        <ChevronDown size={11} className="ch-caret" />
      </button>
    );
  return (
    <div className="git-actions">
      <button className="git-actions-main" title={`Push ${s.ahead} commits`}>
        <ArrowUp size={14} />
        <span className="ch-push-label">Push</span>
        <span className="ch-ahead">{s.ahead}</span>
      </button>
      <button className="git-actions-more" aria-label="More Git actions">
        <ChevronDown size={13} />
      </button>
    </div>
  );
}

function Stat({ lines }: { lines?: Sample["lines"] }) {
  if (!lines) return null;
  return (
    <span className="pane-toggle-stat">
      <span className="pane-toggle-add">+{lines.additions}</span>
      <span className="pane-toggle-del">−{lines.deletions}</span>
    </span>
  );
}

function Header({
  variant,
  s,
  open,
  onToggle,
  terminal,
  onTerminal,
}: {
  variant: Variant;
  s: Sample;
  open: Record<PaneId, boolean>;
  onToggle: (id: PaneId) => void;
  terminal: boolean;
  onTerminal: () => void;
}) {
  const showLabel = (id: PaneId) =>
    variant === "now" || variant === "a" || (variant === "b" && open[id]);
  const toggles = PANES.map((p) => (
    <button
      key={p.id}
      type="button"
      className={`pane-toggle ${open[p.id] ? "active" : ""}`}
      aria-pressed={open[p.id]}
      aria-label={p.label}
      title={`${open[p.id] ? "Hide" : "Show"} ${p.label.toLowerCase()}`}
      onClick={() => onToggle(p.id)}
    >
      {p.icon}
      {showLabel(p.id) && <span className="ch-pane-label">{p.label}</span>}
      {p.id === "changes" && <Stat lines={s.lines} />}
    </button>
  ));
  const terminalButton = (
    <button
      type="button"
      className={`pane-toggle ${terminal ? "active" : ""}`}
      aria-label="Terminal"
      aria-pressed={terminal}
      title={`${terminal ? "Hide" : "Show"} terminal`}
      onClick={onTerminal}
    >
      <PanelBottom size={14} />
    </button>
  );
  const handoff = (
    <button
      type="button"
      className="pane-toggle"
      aria-label="Hand off"
      title="Hand off to another computer"
    >
      <MonitorUp size={14} />
    </button>
  );
  return (
    <header className={`titlebar project-titlebar ch-header ch-${variant}`}>
      <div className="project-titlebar-brand">
        <span className="traffic-space ch-traffic">
          <i />
          <i />
          <i />
        </span>
        <button type="button" className="icon-button" aria-label="Hide sidebar">
          <PanelLeft size={16} />
        </button>
        <RelayMark size={38} />
      </div>
      <div className="ch-main">
        <div className="project-window-title">
          <a className="ci-trigger" href="#" aria-label="CI passing on main">
            <span
              className="sb-project-badge"
              style={{ "--hue": 250 } as React.CSSProperties}
            >
              R
            </span>
            <span className="sb-status ci-dot" data-state="success">
              <i />
            </span>
          </a>
          <span>Relay</span>
          <span className="breadcrumb-slash">/</span>
          <strong>Finding the project's first commit date</strong>
        </div>
        <span className="spacer" />
        <div className="thread-header-actions">
          {variant === "now" ? (
            <>
              <ChecksNow s={s} />
              <GitNow s={s} />
              <div className="pane-toggles">{handoff}</div>
              <div className="pane-toggles">{toggles}</div>
              <div className="pane-toggles">{terminalButton}</div>
            </>
          ) : (
            <>
              <ChecksTight s={s} />
              <GitTight s={s} />
              <div className="pane-toggles">
                {handoff}
                <span className="ch-sep" aria-hidden />
                {toggles}
                <span className="ch-sep" aria-hidden />
                {terminalButton}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

function App() {
  const [variant, setVariant] = useState<Variant>("a");
  const [state, setState] = useState<keyof typeof samples>("clean");
  const [width, setWidth] = useState(1400);
  const [height, setHeight] = useState<"52" | "44" | "40">("52");
  const [open, setOpen] = useState<Record<PaneId, boolean>>({
    chat: true,
    changes: false,
    files: false,
    history: false,
  });
  const [terminal, setTerminal] = useState(false);
  const s = samples[state];
  const toggle = (id: PaneId) =>
    setOpen((o) => {
      const next = { ...o, [id]: !o[id] };
      return Object.values(next).some(Boolean) ? next : o;
    });
  const rows: Variant[] = ["now", variant === "now" ? "a" : variant];
  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>Compact header</strong>
        <span className="preview-tag">Preview · sample data</span>
        <Segmented
          label="Option"
          value={variant}
          options={variants.map((v) => ({ id: v.id, label: v.label }))}
          onChange={setVariant}
        />
        <Segmented
          label="Project state"
          value={state}
          options={[
            { id: "clean", label: "Clean" },
            { id: "dirty", label: "Errors + edits" },
            { id: "ahead", label: "Commits to push" },
          ]}
          onChange={setState}
        />
        <Segmented
          label="Bar height"
          value={height}
          options={[
            { id: "52", label: "52px" },
            { id: "44", label: "44px" },
            { id: "40", label: "40px" },
          ]}
          onChange={setHeight}
        />
        <label className="preview-control">
          Window {width}px
          <input
            type="range"
            min={760}
            max={1800}
            step={10}
            value={width}
            onChange={(e) => setWidth(+e.target.value)}
          />
        </label>
      </div>
      <div className="ch-stage">
        <p className="ch-about">
          {variants.find((v) => v.id === variant)!.about} Click the pane
          toggles; hover anything for its tooltip.
        </p>
        {rows.map((v, i) => (
          <div key={`${v}-${i}`} className="ch-row">
            <div className="ch-label">
              {variants.find((x) => x.id === v)!.label}
              <Measure />
            </div>
            <div
              className="ch-window platform-darwin"
              style={
                {
                  width,
                  "--ch-height": `${v === "now" ? 52 : +height}px`,
                } as React.CSSProperties
              }
            >
              <Header
                variant={v}
                s={s}
                open={open}
                onToggle={toggle}
                terminal={terminal}
                onTerminal={() => setTerminal((t) => !t)}
              />
              <div className="ch-body" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Width the right-hand controls take, measured after layout. */
function Measure() {
  const [px, setPx] = useState<number>();
  return (
    <span
      className="ch-measure"
      ref={(el) => {
        if (!el) return;
        requestAnimationFrame(() => {
          const actions = el
            .closest(".ch-row")
            ?.querySelector<HTMLElement>(".thread-header-actions");
          const w =
            actions && Math.round(actions.getBoundingClientRect().width);
          if (w && w !== px) setPx(w);
        });
      }}
    >
      {px ? `controls ${px}px` : ""}
    </span>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
