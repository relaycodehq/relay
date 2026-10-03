// The branch sync button when the checkout has diverged from its upstream:
// it rebases on click, and on a conflict offers a new thread to resolve it.
// Three takes on the conflict drop-up, on sample data.
// Open http://127.0.0.1:5177/previews/diverged-sync.html (?v=menu|card|worktree&o=conflict|clean)
import "../_shared/desktop-stub";
import { StrictMode, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import {
  ArrowDown,
  ArrowUp,
  Check,
  FileWarning,
  Folder,
  FolderGit2,
  GitBranch,
  MessageSquarePlus,
  PencilLine,
} from "lucide-react";
import "../../src/styles.css";
import "../../src/app/projects.css";
import "../../src/features/agents/composer-model-picker.css";
import "../../src/features/changes/worktrees.css";
import "./diverged-sync.css";
import { initAppearance } from "../../src/lib/appearance";
import { Spinner } from "../../src/ui/ui";

initAppearance();

type Variant = "menu" | "card" | "worktree";
type Outcome = "conflict" | "clean";
type Phase =
  | "diverged"
  | "rebasing"
  | "conflict"
  | "resolving"
  | "pushable"
  | "pushing"
  | "synced";
type Thread = { title: string; state: "running" | "done" | "draft" };

const variants: Record<Variant, { label: string; about: string }> = {
  menu: {
    label: "A · Menu",
    about:
      "One line of why, one item. The new thread starts right away in the project folder, so the rebase is in progress there until it's done and the button waits.",
  },
  card: {
    label: "B · Card",
    about:
      "Shows what clashed: the incoming commit, yours, and the files both touched. Start the thread, or open it as a draft to pick the agent and add context first.",
  },
  worktree: {
    label: "C · Worktree",
    about:
      "Same drop-up as A, but the agent resolves in a scratch worktree, so the project folder never sits mid-rebase. The button follows the thread and turns into ↑3 when it lands.",
  },
};

const upstream = "origin/main";
const incoming = [{ sha: "9e75dad", subject: "Pin the Electron version" }];
const yours = [
  { sha: "720ea18", subject: "Fold the Scratchpad and Projects lists" },
  { sha: "d38fd1c", subject: "Add a right-click menu to threads" },
  { sha: "2b6342a", subject: "Show a handed-off thread's work on its card" },
];
const clashing = ["package.json", "src/components/Sidebar.tsx"];
const threadTitle = `Rebase main onto ${upstream}`;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const params = new URLSearchParams(location.search);

function Preview() {
  const [variant, setVariant] = useState<Variant>(
    (params.get("v") as Variant) in variants
      ? (params.get("v") as Variant)
      : "menu",
  );
  const [outcome, setOutcome] = useState<Outcome>(
    params.get("o") === "clean" ? "clean" : "conflict",
  );
  const [phase, setPhase] = useState<Phase>("diverged");
  const [open, setOpen] = useState(false);
  const [thread, setThread] = useState<Thread>();
  const run = useRef(0);

  const reset = () => {
    run.current++;
    setPhase("diverged");
    setOpen(false);
    setThread(undefined);
  };
  useEffect(() => {
    history.replaceState(null, "", `?v=${variant}&o=${outcome}`);
    reset();
  }, [variant, outcome]);

  async function click() {
    const id = run.current;
    if (phase === "diverged") {
      setPhase("rebasing");
      await wait(900);
      if (id !== run.current) return;
      if (outcome === "clean") return setPhase("pushable");
      setPhase("conflict");
      setOpen(true);
    } else if (phase === "conflict") {
      setOpen(true);
    } else if (phase === "pushable") {
      setPhase("pushing");
      await wait(700);
      if (id === run.current) setPhase("synced");
    } else if (phase === "resolving") {
      console.log(`open thread “${threadTitle}”`);
    }
  }

  async function resolve(draft?: boolean) {
    const id = run.current;
    setOpen(false);
    if (draft) return setThread({ title: threadTitle, state: "draft" });
    setThread({ title: threadTitle, state: "running" });
    setPhase("resolving");
    await wait(3500);
    if (id !== run.current) return;
    setThread({ title: threadTitle, state: "done" });
    setPhase("pushable");
  }

  const behind = phase === "diverged" || phase === "rebasing" || phase === "conflict";
  const arrows = (
    <>
      {behind && (
        <span>
          <ArrowDown size={12} />
          {incoming.length}
        </span>
      )}
      <span>
        <ArrowUp size={12} />
        {yours.length}
      </span>
    </>
  );
  const label =
    phase === "conflict"
      ? `Couldn’t rebase onto ${upstream}`
      : phase === "pushable"
        ? `Push ${yours.length} commits to ${upstream}`
        : phase === "resolving"
          ? `“${threadTitle}” is resolving the rebase`
          : `Rebase ${yours.length} commits onto ${upstream}`;

  let sync: React.ReactNode = null;
  if (phase === "resolving" && variant !== "worktree")
    sync = (
      <span
        className="composer-branch-trigger workspace-trigger static ds-status"
        title={`Rebase in progress in the project folder: “${threadTitle}”`}
      >
        Rebasing…
      </span>
    );
  else if (phase !== "synced") {
    const content =
      phase === "rebasing" || phase === "pushing" ? (
        <Spinner size={12} />
      ) : phase === "resolving" ? (
        <span className="ds-status">
          <Spinner size={12} steady />
          Resolving
        </span>
      ) : (
        arrows
      );
    const props = {
      className: "composer-branch-sync",
      "data-state": phase,
      "aria-label": label,
      title: label,
      disabled: phase === "rebasing" || phase === "pushing",
    };
    sync =
      variant === "card" ? (
        <Popover.Root
          open={open}
          onOpenChange={(next) => phase === "conflict" && setOpen(next)}
        >
          <Popover.Trigger
            {...props}
            onClick={(e) => {
              if (phase !== "conflict") {
                e.preventDefault();
                void click();
              }
            }}
          >
            {content}
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Positioner
              className="composer-popup-positioner"
              side="top"
              align="end"
              sideOffset={6}
            >
              <Popover.Popup className="composer-select-popup ds-card">
                <ConflictCard onResolve={resolve} />
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>
      ) : (
        <Menu.Root
          open={open}
          onOpenChange={(next) => phase === "conflict" && setOpen(next)}
        >
          <Menu.Trigger
            {...props}
            onClick={(e) => {
              if (phase !== "conflict") {
                e.preventDefault();
                void click();
              }
            }}
          >
            {content}
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner
              className="composer-popup-positioner"
              side="top"
              align="end"
              sideOffset={6}
            >
              <Menu.Popup
                className="composer-select-popup ds-menu"
                aria-label="Rebase conflict"
              >
                <ConflictMenu
                  worktree={variant === "worktree"}
                  onResolve={() => void resolve()}
                />
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      );
  }

  return (
    <div className="ds-page">
      <p className="ds-switcher">
        Sample data.{" "}
        {(Object.keys(variants) as Variant[]).map((v) => (
          <button
            key={v}
            aria-pressed={v === variant}
            onClick={() => setVariant(v)}
          >
            {variants[v].label}
          </button>
        ))}
        <span style={{ margin: "0 8px" }}>·</span>
        Rebase{" "}
        {(["conflict", "clean"] as Outcome[]).map((o) => (
          <button
            key={o}
            aria-pressed={o === outcome}
            onClick={() => setOutcome(o)}
          >
            {o === "conflict" ? "conflicts" : "applies cleanly"}
          </button>
        ))}
        <span style={{ margin: "0 8px" }}>·</span>
        <button onClick={reset}>Reset</button>
      </p>
      <p className="ds-about">{variants[variant].about}</p>
      <div className="ds-layout">
        <aside className="ds-sidebar">
          <h4>Relay</h4>
          <div className="ds-thread" data-current="">
            <span>Cache guard behavior</span>
          </div>
          {thread && (
            <div className="ds-thread" data-new="">
              <span>{thread.title}</span>
              {thread.state === "running" ? (
                <Spinner size={11} steady />
              ) : thread.state === "draft" ? (
                <PencilLine size={12} />
              ) : (
                <Check size={12} />
              )}
            </div>
          )}
          <div className="ds-thread">
            <span>Settings polish</span>
          </div>
        </aside>
        <div className="ds-main">
          <div className="project-chat">
            <form
              className="project-composer ds-composer"
              onSubmit={(e) => e.preventDefault()}
            >
              <textarea placeholder="Ask about the code, plan a change, or build something…" />
            </form>
            <div className="thread-context-controls">
              <span
                className="composer-branch-trigger workspace-trigger static"
                title="Project folder"
              >
                <Folder size={13} />
                <span>Project folder</span>
              </span>
              <span
                className="composer-branch-trigger workspace-trigger static"
                style={{ marginLeft: 0 }}
                title="Branch"
              >
                <GitBranch size={13} />
                <span>main</span>
              </span>
              {sync}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConflictMenu({
  worktree,
  onResolve,
}: {
  worktree: boolean;
  onResolve: () => void;
}) {
  return (
    <>
      <Menu.Group>
        <Menu.GroupLabel className="composer-menu-label">
          Couldn’t rebase onto {upstream}
        </Menu.GroupLabel>
        <p className="ds-menu-note">
          Your {yours.length} commits and the {incoming.length} new one both
          change <code>{clashing[0]}</code> and {clashing.length - 1} more.
          {worktree
            ? " Nothing here was touched; the agent works it out on the side."
            : " The rebase was undone, nothing here changed."}
        </p>
      </Menu.Group>
      <Menu.Item className="composer-select-item ds-item" onClick={onResolve}>
        {worktree ? <FolderGit2 size={14} /> : <MessageSquarePlus size={14} />}
        {worktree ? "Resolve in a worktree thread…" : "Resolve in a new thread…"}
      </Menu.Item>
    </>
  );
}

function ConflictCard({
  onResolve,
}: {
  onResolve: (draft?: boolean) => void;
}) {
  return (
    <>
      <h3>Couldn’t rebase onto {upstream}</h3>
      <p>
        Both sides changed the same lines. The rebase was undone, so nothing in
        the project folder moved.
      </p>
      <div className="ds-side">
        <h5>Incoming · {incoming.length}</h5>
        <ul>
          {incoming.map((c) => (
            <li key={c.sha}>
              <code>{c.sha}</code>
              <span>{c.subject}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="ds-side">
        <h5>Yours · {yours.length}</h5>
        <ul>
          {yours.map((c) => (
            <li key={c.sha}>
              <code>{c.sha}</code>
              <span>{c.subject}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="ds-side">
        <h5>Both changed</h5>
        {clashing.map((f) => (
          <div key={f} className="ds-file">
            <FileWarning size={12} />
            <code>{f}</code>
          </div>
        ))}
      </div>
      <div className="ds-actions">
        <button type="button" onClick={() => onResolve(true)}>
          Open as draft
        </button>
        <button type="button" className="primary" onClick={() => onResolve()}>
          Resolve in new thread
        </button>
      </div>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
