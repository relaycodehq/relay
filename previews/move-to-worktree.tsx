// Moving a project-folder thread into its own worktree mid-conversation:
// the footer's Project folder menu, the handoff menu, the confirm dialog and
// the footer afterwards, on sample data.
// Open http://127.0.0.1:5177/previews/move-to-worktree.html (?s=<scene>)
import "./desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GitBranch } from "lucide-react";
import "../src/styles.css";
import "../src/components/projects.css";
import "../src/components/workspace-panes.css";
import "../src/components/composer-model-picker.css";
import { initAppearance } from "../src/lib/appearance";
import { HandoffButton } from "../src/components/HandoffButton";
import { MoveToWorktreeDialog } from "../src/components/MoveToWorktreeDialog";
import {
  CheckoutControl,
  WorktreeMenu,
} from "../src/components/WorktreeControls";
import type { PairedComputer } from "../shared/handoff";
import type {
  ChatSummary,
  WorktreeMove,
  WorktreeStatus,
} from "../shared/projects";
import type { Api } from "../shared/types";

initAppearance();

const mini: PairedComputer = { id: "c1", name: "macmini", status: "online" };
const thread: ChatSummary = {
  id: "0f0e0d0c-0000-4000-8000-000000000002",
  projectId: "p1",
  title: "Cache guard behavior",
  scope: { kind: "project" },
  created: Date.now() - 3_600_000,
  updated: Date.now() - 60_000,
};
const files: WorktreeMove["files"] = [
  { path: "README.md", additions: 3, deletions: 1 },
  { path: "src/lib/cache.ts", additions: 42, deletions: 7 },
  {
    path: "src/components/Settings.tsx",
    additions: 5,
    deletions: 2,
    threads: ["Settings polish"],
  },
  { path: "src/lib/guard.ts", additions: 18, deletions: 0 },
  { path: "notes.txt", additions: 1, deletions: 0 },
  { path: "public/logo.png", additions: 0, deletions: 0, binary: true },
];
const worktree: WorktreeStatus = {
  branch: "relay/cache-guard-behavior",
  path: "/Users/you/Library/Application Support/Relay/worktrees/app/cache-guard-behavior",
  from: "main",
  files: files.map(({ threads: _, ...f }) => f),
  removed: false,
};

type Scene = { label: string; move: WorktreeMove; moved?: boolean };
const scenes: Record<string, Scene> = {
  footer: { label: "Footer · project folder", move: { files } },
  handoff: { label: "Handoff menu · project-folder thread", move: { files } },
  clean: { label: "Dialog · nothing uncommitted", move: { files: [] } },
  blocked: {
    label: "Dialog · blocked",
    move: {
      blocked:
        "“Settings polish” is working in the project folder. Wait for it to finish first.",
      files: [],
    },
  },
  failed: { label: "Dialog · move fails", move: { files } },
  moved: { label: "After · in its worktree", move: { files }, moved: true },
};

let current = new URLSearchParams(location.search).get("s") ?? "footer";
const scene = () => scenes[current] ?? scenes.footer!;
const queryClient = new QueryClient();
let onMoved = () => {};
Object.assign(window.relay as Partial<Api>, {
  pairedComputers: async () => [mini],
  handoffTargets: async () => [],
  projectWorktreeMove: async () => {
    await new Promise((r) => setTimeout(r, 300));
    return scene().move;
  },
  moveProjectChatToWorktree: async () => {
    await new Promise((r) => setTimeout(r, 900));
    if (current === "failed")
      throw new Error("src/lib/cache.ts changed while moving. Try again.");
    onMoved();
    return thread;
  },
});

function Preview() {
  const [name, setName] = useState(current);
  const [dialog, setDialog] = useState(false);
  const [moved, setMoved] = useState(!!scene().moved);
  onMoved = () => setMoved(true);
  const pick = (id: string) => {
    current = id;
    setName(id);
    setMoved(!!scenes[id]!.moved);
    setDialog(false);
    history.replaceState(null, "", `?s=${id}`);
    void queryClient.resetQueries();
  };
  const chat: ChatSummary = moved
    ? { ...thread, worktree: { path: worktree.path, branch: worktree.branch } }
    : thread;
  return (
    <div style={{ maxWidth: 820, margin: "0 auto", padding: 16 }}>
      <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 2 }}>
        Sample data.{" "}
        {Object.entries(scenes).map(([id, { label }]) => (
          <button
            key={id}
            aria-pressed={id === name}
            style={{ marginRight: 6, fontWeight: id === name ? 600 : 400 }}
            onClick={() => pick(id)}
          >
            {label}
          </button>
        ))}
      </p>
      <header
        className="project-header"
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          padding: "8px 0",
        }}
      >
        <strong style={{ fontSize: 13 }}>App / {chat.title}</strong>
        <span style={{ flex: 1 }} />
        <HandoffButton
          key={`${name}-${moved}`}
          chat={chat}
          onSettings={() => console.log("open Settings → Computers")}
          onError={(e) => console.error(e)}
        />
      </header>
      <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 24 }}>
        {moved
          ? "Moved: the footer now shows the worktree and its branch, and the handoff button lists computers."
          : name === "handoff"
            ? "Open the handoff button (top right): the dead end now offers the move."
            : "Open “Project folder” in the footer below."}
      </p>
      <div className="project-chat" style={{ marginTop: 200 }}>
        <div className="thread-context-controls">
          {moved ? (
            <WorktreeMenu
              status={worktree}
              running={false}
              busy={false}
              onShowChanges={() => console.log("show changes")}
              onReveal={() => console.log("reveal")}
              onRemove={() => console.log("remove")}
            />
          ) : (
            <CheckoutControl
              onReveal={() => {}}
              onMove={() => setDialog(true)}
            />
          )}
          <span
            className="composer-branch-trigger workspace-trigger static"
            title="Branch"
          >
            <GitBranch size={13} />
            <span>{moved ? worktree.branch : "main"}</span>
          </span>
        </div>
        <form className="project-composer" onSubmit={(e) => e.preventDefault()}>
          <textarea
            className="composer-prompt-input"
            style={{
              width: "100%",
              minHeight: 60,
              border: 0,
              background: "transparent",
              padding: 14,
              resize: "none",
              color: "var(--text)",
            }}
            placeholder="Ask about the code, plan a change, or build something…"
          />
        </form>
      </div>
      {dialog && (
        <MoveToWorktreeDialog
          chatId={thread.id}
          onClose={() => setDialog(false)}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Preview />
    </QueryClientProvider>
  </StrictMode>,
);
