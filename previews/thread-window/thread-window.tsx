// A thread popped out into its own window, beside the main one. The main
// window keeps the real sidebar; the popped thread's card says where it is,
// and the pane it left shows where it went instead of a second live copy.
// Sample data. Open http://127.0.0.1:5177/previews/thread-window/
import "../_shared/desktop-stub";
import {
  StrictMode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  AppWindow,
  GitCompareArrows,
  MessageSquare,
  Moon,
  PanelBottom,
  PanelLeft,
  PanelRight,
  SquareArrowDownLeft,
  SquareArrowOutUpRight,
  Sun,
} from "lucide-react";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/ui/workspace-panes.css";
import "../../src/features/terminal/terminal-drawer.css";
import "../../src/features/sidebar/sidebar.css";
import "../../src/features/changes/working-tree.css";
import "../../src/features/changes/changed-files.css";
import "../../src/features/agent-turn/subagents.css";
import "../../src/features/handoff/handoff.css";
import "../_shared/chrome.css";
import "./thread-window.css";
import { initAppearance, setMode, useAppearance } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { RelayMark } from "../../src/ui/RelayMark";
import { FileEntryIcon } from "../../src/ui/FileEntryIcon";
import { MiddleTruncate } from "../../src/ui/MiddleTruncate";
import { Pane, PaneHeader, PaneToggles } from "../../src/ui/WorkspacePanes";
import { ProjectSidebar } from "../../src/features/sidebar/ProjectSidebar";
import { Message } from "../../src/features/thread/ProjectMessage";
import { ComposerToolbar } from "../../src/features/composer/ComposerToolbar";
import { useSampleControls } from "../../src/features/composer/ComposerToolbarSample";
import { defaultToolbar } from "../../src/features/composer/composer-toolbar";
import { SendButton } from "../../src/features/composer/ComposerSendButtons";
import { ChangesReview, ChangesSidebar } from "../../src/features/changes/ChangesPane";
import { DiffStatLabel } from "../../src/features/changes/DiffStatLabel";
import { activityIcons } from "../../src/features/agent-turn/Subagents";
import { useNow } from "../../src/lib/useNow";
import { doneLabel, liveLabel, plural } from "../../shared/activity-labels";
import { took } from "../../shared/subagents";
import { stubSidebar } from "../_shared/app-frame";
import type { AgentActivity, ChatMessage, ChatSummary, Project } from "../../shared/projects";
import type { FilePair } from "../../shared/types";
import type { PaneId } from "../../src/lib/workspace-panes";

localStorage.setItem("relay-sidebar-view", "activity");
initAppearance();
initWindowFocus();

const minute = 60_000;
const now = Date.now();
const root = "/Users/you/relay";
const projects: Project[] = ["relay", "openusage"].map((name, i) => ({
  id: name,
  name,
  path: `/Users/you/${name}`,
  repository: null,
  added: i,
}));

const chat = (c: Partial<ChatSummary> & Pick<ChatSummary, "id" | "title">) =>
  ({
    projectId: "relay",
    scope: { kind: "project" },
    created: now - 90 * minute,
    updated: now - 4 * minute,
    readUpTo: now,
    branch: "main",
    provider: "claude",
    ...c,
  }) as ChatSummary;

const POPPED = "rebind";
const chats: ChatSummary[] = [
  chat({
    id: POPPED,
    title: "Let every shortcut be rebound",
    branch: "relay/rebind-shortcuts",
    worktree: {
      path: `${root}/worktrees/rebind-shortcuts`,
      branch: "relay/rebind-shortcuts",
    },
    running: true,
    runningSince: now - 3 * minute,
    runningAgents: ["claude"],
  }),
  chat({
    id: "flicker",
    title: "Sidebar flickers when a turn finishes",
    updated: now - 12 * minute,
    provider: "codex",
  }),
  chat({
    id: "updater",
    projectId: "openusage",
    title: "Bump the Tauri updater and re-sign",
    branch: "export",
    updated: now - 40 * minute,
  }),
];
stubSidebar(chats);

const msg = (
  id: string,
  role: ChatMessage["role"],
  body: string,
  ago: number,
  provider: ChatMessage["provider"] = "claude",
): ChatMessage => ({
  id,
  role,
  body,
  created: now - ago * minute,
  provider,
  status: "complete",
  version: 1,
});

const conversations: Record<string, ChatMessage[]> = {
  [POPPED]: [
    msg(
      "r1",
      "user",
      "let every shortcut be rebound from Settings, not just the composer ones. menu ones too",
      18,
    ),
    msg(
      "r2",
      "assistant",
      "Every command now lives in one registry in `shared/shortcuts.ts`: its title, group and default keys. Settings → Shortcuts lists them by group and records a new combo on click.\n\n- **Menu shortcuts** (reload, zoom, full screen) are rebuilt into the app menu when a binding changes, so the menu shows the key you picked.\n- **Clashes** are refused while recording, naming the command that already has the key.\n\nThe unit tests pass. Now checking the recorder against the menu's own accelerators.",
      6,
    ),
  ],
  flicker: [
    msg(
      "f1",
      "user",
      "Can you fix the sidebar flicker when a thread finishes?",
      30,
      "codex",
    ),
    msg(
      "f2",
      "assistant",
      "Finishing a turn refetched the whole thread list, so every card remounted. It now patches the one thread that changed; the sidebar test covers it.",
      12,
      "codex",
    ),
  ],
  updater: [
    msg("u1", "user", "bump the tauri updater and re-sign the build", 50),
    msg(
      "u2",
      "assistant",
      "Updated `tauri-plugin-updater` to 2.9 and re-signed with the release key. The update feed validates.",
      40,
    ),
  ],
};

const changedFiles = [
  { path: "shared/shortcuts.ts", additions: 24, deletions: 3 },
  { path: "src/features/settings/sections/shortcuts.tsx", additions: 112, deletions: 0 },
  { path: "electron/app/menu.ts", additions: 18, deletions: 9 },
];
const before = `  terminal: {
    title: "Show or hide the terminal",
    group: "General",
  },
  settle: {
    title: "Settle thread",
    group: "Threads",
  },
`;
const after = `  terminal: {
    title: "Show or hide the terminal",
    group: "General",
  },
  "jump-thread": {
    title: "Open one of the first nine activity threads",
    group: "Threads",
    digits: true,
    defaults: one("mod+Digit1"),
  },
  settle: {
    title: "Settle the open thread",
    group: "Threads",
  },
`;
const pair: FilePair = {
  old: { name: "shared/shortcuts.ts", contents: before, cacheKey: "tw-old" },
  next: { name: "shared/shortcuts.ts", contents: after, cacheKey: "tw-new" },
  binary: false,
};
const diff = { data: pair, error: null } as UseQueryResult<FilePair>;

const noop = () => {};

function Lights({ onClose }: { onClose?: () => void }) {
  return (
    <span className="traffic-space tw-lights">
      <button type="button" aria-label="Close window" onClick={onClose} />
      <i />
      <i />
    </span>
  );
}

function Title({ c }: { c: ChatSummary }) {
  const project = projects.find((p) => p.id === c.projectId)!;
  return (
    <div className="project-window-title">
      <span
        className="sb-project-badge"
        style={{ "--hue": c.projectId === "relay" ? 250 : 30 } as React.CSSProperties}
      >
        {project.name[0]!.toUpperCase()}
      </span>
      <span>{project.name}</span>
      <span className="breadcrumb-slash">/</span>
      <strong>{c.title}</strong>
    </div>
  );
}

function Composer({ c }: { c: ChatSummary }) {
  const controls = useSampleControls({
    agent: c.provider ?? "claude",
    name: c.provider === "codex" ? "GPT-5.5" : "Opus 5.5",
    effort: "High",
    window: 1_000_000,
  });
  return (
    <div className="thread-bottom-composer">
      <div className="thread-compose-wrap">
        <form className="project-composer" onSubmit={(e) => e.preventDefault()}>
          <textarea
            className="composer-prompt-input"
            readOnly
            rows={1}
            aria-label="Message"
            placeholder="Ask for follow-up changes…"
          />
          <div className="composer-tools">
            <ComposerToolbar layout={defaultToolbar} controls={controls} />
            <SendButton
              disabled
              running={false}
              sendKey="enter"
              runningAction="queue"
              onSendLater={noop}
            />
          </div>
        </form>
      </div>
    </div>
  );
}

function Conversation({ c }: { c: ChatSummary }) {
  return (
    <section className="project-chat" aria-label="Thread">
      <div className="project-messages">
        <div className="thread-message-column">
          {conversations[c.id]!.map((m) => (
            <Message
              key={m.id}
              message={m}
              chatId=""
              projectRoot={root}
              onReply={noop}
              onChanges={noop}
              onTurnDiff={noop}
              onOpenFile={noop}
              onRewind={async () => ({ conflicts: [] })}
            />
          ))}
        </div>
      </div>
      <Composer c={c} />
    </section>
  );
}

function Changes() {
  const [path, setPath] = useState(changedFiles[0]!.path);
  return (
    <div className="working-content">
      <ChangesSidebar title="Changed in this worktree" count={changedFiles.length}>
        {changedFiles.map((f) => (
          <div
            key={f.path}
            className={`working-file ${f.path === path ? "selected" : ""}`}
          >
            <button
              className="working-select turn-file"
              title={f.path}
              onClick={() => setPath(f.path)}
            >
              <FileEntryIcon path={f.path} directory={false} />
              <MiddleTruncate text={f.path} kind="path" title={null} />
              <DiffStatLabel stat={f} />
            </button>
          </div>
        ))}
      </ChangesSidebar>
      <ChangesReview
        path={path}
        sides={{ deletions: "main", additions: "worktree" }}
        diff={diff}
        loading="Loading diff…"
        empty="Pick a file"
        onOpenFile={noop}
      />
    </div>
  );
}

/** The thread's header actions: pop out or back, then the panes, then the terminal. */
function HeaderStrip({
  move,
  panes,
  onToggle,
}: {
  move: { label: string; icon: ReactNode; onClick: () => void };
  panes?: Record<PaneId, boolean>;
  onToggle?: (id: PaneId) => void;
}) {
  return (
    <div className="thread-header-actions">
      <div className="header-strip">
        <button
          type="button"
          className="pane-toggle"
          aria-label={move.label}
          title={`${move.label} · ⇧⌘O`}
          onClick={move.onClick}
        >
          {move.icon}
        </button>
        {panes && onToggle && (
          <>
            <span className="header-strip-sep" aria-hidden="true" />
            <PaneToggles
              onToggle={onToggle}
              onMove={noop}
              panes={[
                { id: "chat", label: "Chat", icon: <MessageSquare size={14} />, open: panes.chat, disabled: panes.chat && !panes.changes && !panes.panel },
                { id: "changes", label: "Changes", icon: <GitCompareArrows size={14} />, open: panes.changes, stat: { additions: 154, deletions: 12 } },
                { id: "panel", label: "Panel", icon: <PanelRight size={14} />, open: panes.panel },
              ]}
            />
            <span className="header-strip-sep" aria-hidden="true" />
            <button type="button" className="pane-toggle" aria-label="Terminal">
              <PanelBottom size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** The thread's panes, as the main window lays them out. */
function Workspace({
  c,
  panes,
  onToggle,
}: {
  c: ChatSummary;
  panes: Record<PaneId, boolean>;
  onToggle: (id: PaneId) => void;
}) {
  const visible = (["chat", "changes"] as PaneId[]).filter((id) => panes[id]);
  const grow = 1 / visible.length;
  return (
    <div className="workspace-column">
      <div className="workspace-panes">
        <Pane id="chat" label="Chat" order={0} weight={1} grow={grow} open={panes.chat} onResize={noop} onMove={noop} className="project-chat-pane">
          <Conversation c={c} />
        </Pane>
        <Pane
          id="changes"
          label="Changes"
          order={1}
          weight={1}
          grow={grow}
          open={panes.changes}
          previous={panes.chat ? { id: "chat", weight: 1 } : undefined}
          onResize={noop}
          onMove={noop}
        >
          <PaneHeader
            id="changes"
            icon={<GitCompareArrows size={14} />}
            title="Changes"
            onClose={() => onToggle("changes")}
          />
          <Changes />
        </Pane>
      </div>
    </div>
  );
}

/** What the popped thread's agent goes through while you look at the main window; the preview loops it. */
const script: Pick<AgentActivity, "kind" | "label">[] = [
  { kind: "read", label: `${root}/electron/app/menu.ts` },
  { kind: "search", label: "accelerator" },
  { kind: "file", label: `${root}/electron/app/menu.ts` },
  { kind: "command", label: "npx vitest run shared/shortcuts.test.ts" },
  { kind: "read", label: `${root}/src/features/settings/sections/shortcuts.tsx` },
  { kind: "file", label: `${root}/src/features/settings/sections/shortcuts.tsx` },
  { kind: "command", label: "npm run typecheck" },
];
const says = [
  "Checking the recorder against the menu's own accelerators.",
  "The menu rebuilds on every binding change; making it skip unchanged ones.",
  "Typecheck next, then the Settings spec.",
];

function useLiveCalls() {
  const [step, setStep] = useState(4);
  useEffect(() => {
    const timer = setInterval(() => setStep((s) => s + 1), 2600);
    return () => clearInterval(timer);
  }, []);
  const calls: AgentActivity[] = Array.from({ length: 4 }, (_, i) => {
    const n = step - 3 + i;
    return {
      id: `c${n}`,
      ...script[n % script.length]!,
      status: i === 3 ? "running" : "complete",
    };
  });
  return { calls, count: 10 + step, says: says[Math.floor(step / 3) % says.length]! };
}

/**
 * Where the popped thread was: a small picture of its window with what its
 * agent is doing, read-only. Clicking it brings the window up; there is no
 * composer here, so the thread is never live in two places.
 */
function Elsewhere({ c, onShow, onBack }: { c: ChatSummary; onShow(): void; onBack(): void }) {
  const now = useNow(1000);
  const live = useLiveCalls();
  const project = projects.find((p) => p.id === c.projectId)!;
  return (
    <div className="workspace-column">
      <div className="tw-away">
        <button
          type="button"
          className="tw-mini"
          title="Show its window"
          onClick={onShow}
        >
          <span className="tw-mini-bar" aria-hidden="true">
            <span className="tw-mini-lights">
              <i />
              <i />
              <i />
            </span>
            <span className="tw-mini-title">
              {project.name} <span>/</span> <b>{c.title}</b>
            </span>
            <SquareArrowOutUpRight size={13} className="tw-mini-raise" />
          </span>
          <span className="remote-peek">
            <span className="subagents-title">
              <b>Working in its own window</b>
              <span>
                {["Claude", "Opus 5.5", plural(live.count, "call"), c.runningSince && took(now - c.runningSince)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            <span className="subagents-now">{live.says}</span>
            <span className="subagents-calls tw-mini-calls">
              {live.calls.map((call) => {
                const Icon = activityIcons[call.kind];
                const running = call.status === "running";
                return (
                  <span key={call.id} className={`subagents-call${running ? " live" : ""}`}>
                    <Icon size={12} />
                    <span className={call.kind === "command" ? "mono" : undefined}>
                      {running ? liveLabel(call) : doneLabel(call)}
                    </span>
                  </span>
                );
              })}
            </span>
          </span>
        </button>
        <p className="tw-away-foot">
          <button type="button" className="text-button" onClick={onBack}>
            Bring it back here
          </button>
          <kbd>⇧⌘O</kbd>
        </p>
      </div>
    </div>
  );
}

/** The popped thread's card in the real sidebar gets a "where" line, like a handed-off thread's. */
function CardWhere({ popped }: { popped: boolean }) {
  const [meta, setMeta] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const find = () =>
      setMeta(document.querySelector<HTMLElement>(`[data-card="${POPPED}"] .sb-card-meta`));
    find();
    const watch = new MutationObserver(find);
    watch.observe(document.body, { childList: true, subtree: true });
    return () => watch.disconnect();
  }, []);
  if (!popped || !meta) return null;
  return createPortal(
    <span className="sb-card-where" title="Open in its own window">
      <AppWindow size={11} />
      Own window
    </span>,
    meta,
  );
}

/** Scales the windows down to fit the page, side by side or stacked. */
function useFit(stage: React.RefObject<HTMLDivElement | null>, width: number) {
  const [fit, setFit] = useState({ zoom: 1, stacked: false });
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const measure = () => {
      const room = el.clientWidth - 48;
      const side = room / width;
      const stacked = side < 0.62;
      setFit({ zoom: Math.min(1, stacked ? room / 1180 : side), stacked });
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(el);
    return () => watch.disconnect();
  }, [stage, width]);
  return fit;
}

function Preview() {
  const mode = useAppearance().palette.kind;
  const [popped, setPopped] = useState(true);
  const [mainShows, setMainShows] = useState(POPPED);
  const [panes, setPanes] = useState<Record<PaneId, boolean>>({
    chat: true,
    changes: true,
    panel: false,
  });
  const [mainPanes, setMainPanes] = useState<Record<PaneId, boolean>>({
    chat: true,
    changes: false,
    panel: false,
  });
  const [flash, setFlash] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const poppedWidth = 1040;
  const fit = useFit(stage, 1180 + poppedWidth + 40);
  const raise = () => setFlash((n) => n + 1);
  const popOut = () => setPopped(true);
  const bringBack = () => {
    setPopped(false);
    setMainShows(POPPED);
  };
  const toggle =
    (set: typeof setPanes) =>
    (id: PaneId) =>
      set((p) => {
        const next = { ...p, [id]: !p[id] };
        return next.chat || next.changes ? next : p;
      });

  useEffect(() => {
    const keys = (e: KeyboardEvent) => {
      if (e.metaKey && e.shiftKey && e.code === "KeyO") {
        e.preventDefault();
        if (popped) bringBack();
        else if (mainShows === POPPED) popOut();
      }
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  });

  const shown = chats.find((c) => c.id === mainShows)!;
  const thread = chats.find((c) => c.id === POPPED)!;
  const mainIsElsewhere = popped && mainShows === POPPED;
  return (
    <div className="preview-app">
      <div className="preview-bar" aria-label="Preview controls">
        <strong>A thread in its own window</strong>
        <span className="preview-tag">Preview · sample data</span>
        <button
          type="button"
          className="icon-button"
          aria-label={mode === "dark" ? "Light" : "Dark"}
          onClick={() => setMode(mode === "dark" ? "light" : "dark")}
        >
          {mode === "dark" ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
      <p className="tw-note">
        The thread works on in its own window, panes and all. Where it was, the
        main window shows what it's doing; click that to bring the window up.
        Try the sidebar card, ⇧⌘O, or the popped window's red light too.
      </p>
      <div
        ref={stage}
        className="tw-stage"
      >
        <div
          className={`tw-desk ${fit.stacked ? "stacked" : ""}`}
          style={{ zoom: fit.zoom }}
        >
        <div className="tw-window platform-darwin" style={{ width: 1180 }}>
          <span className="tw-caption">Main window</span>
          <div className="app project-app">
            <header className="titlebar project-titlebar">
              <div className="project-titlebar-brand">
                <Lights />
                <button type="button" className="icon-button relay-sidebar-toggle" aria-label="Hide sidebar" aria-pressed>
                  <PanelLeft size={16} />
                </button>
                <RelayMark size={38} />
              </div>
              <div className="project-titlebar-main">
                <Title c={shown} />
                <span className="spacer" />
                {!mainIsElsewhere && (
                  <HeaderStrip
                    move={{
                      label: "Open in new window",
                      icon: <SquareArrowOutUpRight size={14} />,
                      onClick: () => {
                        if (shown.id === POPPED) popOut();
                      },
                    }}
                    panes={mainPanes}
                    onToggle={toggle(setMainPanes)}
                  />
                )}
              </div>
            </header>
            <div className="project-layout">
              <aside className="projects-sidebar" aria-label="Projects">
                <ProjectSidebar
                  initialView="activity"
                  projects={projects}
                  showing={{ projectId: shown.projectId, chatId: shown.id }}
                  onOpen={(_p, c) => {
                    if (!c) return;
                    // A popped thread's card raises its window; the pane stays where it was.
                    if (c.id === POPPED && popped) raise();
                    else setMainShows(c.id);
                  }}
                  onPickNew={noop}
                  onNewScratch={noop}
                  onSendDraft={noop}
                  onAdd={noop}
                  onSettings={noop}
                  onInbox={noop}
                />
                <CardWhere popped={popped} />
              </aside>
              {mainIsElsewhere ? (
                <Elsewhere c={thread} onShow={raise} onBack={bringBack} />
              ) : (
                <Workspace
                  key={shown.id}
                  c={shown}
                  panes={mainPanes}
                  onToggle={toggle(setMainPanes)}
                />
              )}
            </div>
          </div>
        </div>

        <div
          className="tw-window tw-popped platform-darwin"
          style={{ width: poppedWidth }}
          hidden={!popped}
        >
          <span className="tw-caption">Its own window</span>
          <div key={flash} className={`app project-app ${flash ? "tw-raised" : ""}`}>
            <header className="titlebar project-titlebar sidebar-collapsed">
              <div className="project-titlebar-brand">
                <Lights onClose={bringBack} />
              </div>
              <div className="project-titlebar-main">
                <Title c={thread} />
                <span className="spacer" />
                <HeaderStrip
                  move={{
                    label: "Back to the main window",
                    icon: <SquareArrowDownLeft size={14} />,
                    onClick: bringBack,
                  }}
                  panes={panes}
                  onToggle={toggle(setPanes)}
                />
              </div>
            </header>
            <div className="project-layout">
              <Workspace c={thread} panes={panes} onToggle={toggle(setPanes)} />
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <Preview />
    </QueryClientProvider>
  </StrictMode>,
);
