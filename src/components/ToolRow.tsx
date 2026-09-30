import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, FolderOpen, RefreshCw } from "lucide-react";
import { Switch } from "./SettingsCard";
import { IconButton, Spinner } from "./ui";
import "./tool-row.css";

/** Green when it works, amber when it needs something, grey when it's off. */
export type ToolState = "ready" | "attention" | "off";

/** Text with `code` spans, as the CLIs' advice comes. */
export function withCode(text: string) {
  return text
    .split("`")
    .map((part, i) =>
      i % 2 ? <code key={i}>{part}</code> : <Fragment key={i}>{part}</Fragment>,
    );
}

/** The card the rows sit in. */
export function ToolRows({ children }: { children: ReactNode }) {
  return <div className="settings-card tool-rows">{children}</div>;
}

/**
 * One tool or host in Settings → Integrations: its mark with a status dot,
 * name and version, one line of status, then its details behind a chevron
 * and, for what can be turned off, a switch.
 */
export function ToolRow({
  mark,
  name,
  version,
  state,
  summary,
  toggle,
  details,
}: {
  mark: ReactNode;
  name: string;
  /** As the CLI says it, e.g. `gh 2.101.0`. */
  version?: string;
  state: ToolState;
  /** Given what opens the details, for a fix that happens there. */
  summary: (openDetails: () => void) => ReactNode;
  toggle?: {
    checked: boolean;
    disabled?: boolean;
    onChange: (on: boolean) => void;
  };
  details?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="tool-row-row" data-state={state}>
      <div className="tool-row-main">
        <span className="tool-row-mark">
          {mark}
          <span className="tool-row-dot" aria-hidden />
        </span>
        <div className="tool-row-text">
          <div className="tool-row-title">
            <span>{name}</span>
            {version && <code>{version}</code>}
          </div>
          <p>{summary(() => setOpen(true))}</p>
        </div>
        {details && (
          <IconButton
            label={`${open ? "Hide" : "Show"} ${name} details`}
            className="tool-row-toggle"
            active={open}
            onClick={() => setOpen(!open)}
          >
            <ChevronDown size={15} data-open={open || undefined} />
          </IconButton>
        )}
        {toggle && (
          <Switch
            label={`Use ${name}`}
            checked={toggle.checked}
            disabled={toggle.disabled}
            onChange={toggle.onChange}
          />
        )}
      </div>
      {open && details && <div className="tool-row-details">{details}</div>}
    </div>
  );
}

/**
 * Where a CLI is, typed or picked. Enter uses a typed path, Esc goes back to
 * the one Relay runs now; a folder means the program inside it.
 */
export function CliPathField({
  program,
  path = "",
  linked,
  busy,
  autoFocus = !path,
  onUse,
  onUnlink,
}: {
  program: string;
  path?: string;
  linked?: boolean;
  busy: boolean;
  autoFocus?: boolean;
  /** Links `typed`, or asks in a file dialog without it. */
  onUse: (typed?: string) => void;
  /** Forgets the linked one, so Relay searches again. */
  onUnlink: () => void;
}) {
  const [draft, setDraft] = useState(path);
  // A rescan or a link from elsewhere moves the field along.
  useEffect(() => setDraft(path), [path]);
  const dirty = draft.trim() !== path && !!draft.trim();
  return (
    <div className="tool-row-path">
      <label>
        <span>{program}</span>
        <input
          value={draft}
          spellCheck={false}
          autoComplete="off"
          aria-label={`Path to ${program}`}
          autoFocus={autoFocus}
          placeholder={`Not found. Type where ${program} is, e.g. /usr/local/bin/${program}`}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && dirty) onUse(draft.trim());
            if (e.key === "Escape" && draft !== path) {
              // Esc would otherwise close Settings too.
              e.stopPropagation();
              e.preventDefault();
              setDraft(path);
            }
          }}
        />
        <IconButton
          label={`Choose ${program}…`}
          className="tool-row-browse"
          disabled={busy}
          onClick={() => onUse()}
        >
          <FolderOpen size={14} />
        </IconButton>
      </label>
      <div className="tool-row-path-foot">
        <small>
          {dirty
            ? "Enter to use it, Esc to go back."
            : !path
              ? "Relay looked on PATH and in the usual install folders."
              : linked
                ? "Linked by you."
                : "Found automatically."}
        </small>
        {dirty ? (
          <button
            className="text-button"
            disabled={busy}
            onClick={() => onUse(draft.trim())}
          >
            Use this path
          </button>
        ) : (
          linked && (
            <button className="text-button" disabled={busy} onClick={onUnlink}>
              Find automatically
            </button>
          )
        )}
      </div>
    </div>
  );
}

/** The section header's rescan button. */
export function RescanButton({
  busy,
  onClick,
}: {
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <IconButton
      label="Check again"
      disabled={busy}
      className="tool-row-rescan"
      onClick={onClick}
    >
      {busy ? <Spinner size={13} /> : <RefreshCw size={14} />}
    </IconButton>
  );
}
