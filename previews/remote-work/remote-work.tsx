// A thread handed off to another computer, in the real sidebar and strip:
// its card works like a local run's, and both peek at the run on hover.
// Open http://127.0.0.1:5177/previews/remote-work/ (?s=<state>)
import "../_shared/desktop-stub";
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/styles.css";
import "../_shared/app-styles";
import "./remote-work.css";
import { initAppearance } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { ProjectSidebar } from "../../src/features/sidebar/ProjectSidebar";
import { awayPlaceholder, HandoffStrip } from "../../src/features/handoff/HandoffStrip";
import type { HandoffRemoteStatus, HandoffView } from "../../shared/handoff";
import type { AgentActivity, ChatSummary, Project } from "../../shared/projects";
import type { Api } from "../../shared/types";

localStorage.setItem("relay-sidebar-view", "activity");
initAppearance();
initWindowFocus();

const minute = 60_000;
const now = Date.now();
const computer = "macmini";
const root = "/Users/mini/relay/";
const projects: Project[] = ["relay", "openusage"].map((name, i) => ({
  id: name,
  name,
  path: `/Users/you/${name}`,
  repository: null,
  added: i,
}));

// What the agent on the mini works through; the preview loops it.
const script: (Pick<AgentActivity, "kind" | "label"> & { says?: string })[] = [
  {
    kind: "read",
    label: `${root}src/components/ComposerInput.tsx`,
    says: "Looking at how the composer keeps pasted images today.",
  },
  { kind: "search", label: "imagePill" },
  { kind: "read", label: `${root}src/lib/composer-images.ts` },
  {
    kind: "file",
    label: `${root}src/components/ComposerInput.tsx`,
    says: "Putting each image inline as a pill, so Backspace takes the whole one.",
  },
  { kind: "file", label: `${root}src/components/composer.css` },
  { kind: "command", label: "npx tsc --noEmit" },
  {
    kind: "command",
    label: "npx vitest run tests/unit/composer-images.test.ts",
    says: "Types pass. Running the image tests.",
  },
  { kind: "read", label: `${root}tests/e2e/composer.spec.ts` },
  {
    kind: "command",
    label: "npx playwright test tests/e2e/composer.spec.ts",
    says: "Checking paste and Backspace in the real composer.",
  },
];

const states = {
  working: "Working",
  waiting: "Needs input",
  finished: "Finished",
  stopped: "Stopped with an error",
  offline: "Can't reach it",
  older: "Older Relay there",
  sending: "Handing off",
} as const;
type State = keyof typeof states;

const started = now - (4 * 60 + 12) * 1000;
const sentTo = {
  id: "h1",
  computerId: "c1",
  computer,
  at: now - 25 * minute,
};

function remoteStatus(state: State, step: number): HandoffRemoteStatus {
  const running = state === "working" || state === "waiting";
  const calls: AgentActivity[] = Array.from({ length: step + 1 }, (_, i) => {
    const s = script[i % script.length]!;
    return {
      id: `c${i}`,
      kind: s.kind,
      label: s.label,
      status: running && i === step ? "running" : "complete",
    };
  });
  const says = [...Array(step + 1).keys()]
    .reverse()
    .map((i) => script[i % script.length]!.says)
    .find(Boolean);
  const base: HandoffRemoteStatus = {
    title: "Inline image pills in prompt input",
    running,
    waiting: state === "waiting",
    settled: false,
    updated: state === "finished" ? now - 2 * minute : Date.now(),
    returned: false,
  };
  if (state === "older") return { ...base, running: true };
  return {
    ...base,
    provider: "claude",
    model: "claude-opus-5-5",
    calls: calls.length,
    recent: calls.slice(-6),
    ...(says ? { says } : {}),
    ...(running ? { runningSince: started } : {}),
    ...(state === "waiting"
      ? {
          question:
            "Should a pill show the file name, or only a thumbnail when the name is the default “image.png”?",
        }
      : {}),
    ...(state === "finished"
      ? {
          latest:
            "Images now sit inline as pills where you pasted them. Backspace removes the whole pill, and dragging one moves it. Unit tests and the composer spec pass.",
        }
      : {}),
    ...(state === "stopped"
      ? {
          failed:
            "npm ERR! code ENOSPC: no space left on device, write\n  at ...",
        }
      : {}),
  };
}

function viewOf(state: State, step: number): HandoffView {
  if (state === "sending")
    return { sentTo: { ...sentTo, state: "sending" }, online: true };
  return {
    sentTo: { ...sentTo, state: "away" },
    online: state !== "offline",
    remote: remoteStatus(state === "offline" ? "working" : state, step),
  };
}

const chat = (c: Partial<ChatSummary> & Pick<ChatSummary, "id" | "title">) =>
  ({
    projectId: "relay",
    scope: { kind: "project" },
    created: now - 60 * minute,
    updated: now - minute,
    branch: "main",
    provider: "claude",
    ...c,
  }) as ChatSummary;

const away = chat({
  id: "away",
  title: "Inline image pills in prompt input",
  branch: "relay/lets-add-a-functionality-that-makes-it-s",
  updated: now - 60 * minute,
  worktree: {
    path: "/Users/you/relay/worktrees/inline-image-pills",
    branch: "relay/lets-add-a-functionality-that-makes-it-s",
  },
  sentTo: { ...sentTo, state: "away" },
});
const chats: ChatSummary[] = [
  chat({
    id: "local",
    title: "Let every shortcut be rebound",
    branch: "relay/rebind-shortcuts",
    running: true,
    runningSince: now - 95_000,
    runningAgents: ["claude"],
  }),
  away,
  chat({
    id: "done",
    projectId: "openusage",
    title: "Bump the Tauri updater and re-sign",
    branch: "export",
    updated: now - 20 * minute,
  }),
];

const asked = new URLSearchParams(location.search).get("s");
let current: { state: State; step: number } = {
  state: asked && asked in states ? (asked as State) : "working",
  step: 5,
};
const view = () => viewOf(current.state, current.step);
Object.assign(window.relay, {
  projectChats: async (id: string) =>
    chats
      .filter((c) => c.projectId === id)
      .map((c) => (c.id === "away" ? { ...c, sentTo: view().sentTo } : c)),
  scratchChats: async () => [],
  projectGroups: async () => [],
  updateState: async () => ({ status: "off", current: "0.1.0" }),
  onUpdate: () => () => {},
  agentVersions: async () => ({ agents: [], checking: false }),
  onAgentVersions: () => () => {},
  onProjectChat: () => () => {},
  triageProjectChat: async () => {},
  handoffViews: async () => ({ away: view() }),
  handoffView: async () => view(),
  bringBackThread: async () => {},
} satisfies Partial<Record<keyof Api, unknown>>);

const queryClient = new QueryClient();

function Preview() {
  const [state, setState] = useState(current.state);
  const [step, setStep] = useState(current.step);
  current = { state, step };
  useEffect(() => {
    history.replaceState(null, "", `?s=${state}`);
    void queryClient.invalidateQueries();
  }, [state, step]);
  useEffect(() => {
    if (state !== "working" && state !== "older") return;
    const timer = setInterval(() => setStep((s) => s + 1), 2600);
    return () => clearInterval(timer);
  }, [state]);
  const thread = { ...away, sentTo: view().sentTo };
  return (
    <div className="rw-page">
      <header className="rw-controls">
        <p>
          Sample data, real sidebar and strip. The thread was handed off to{" "}
          <b>{computer}</b>. Hover its card or the strip to peek.
        </p>
        <div className="rw-choice" role="radiogroup" aria-label="There">
          <span>There</span>
          {(Object.keys(states) as State[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={state === k}
              className={state === k ? "primary" : "secondary"}
              onClick={() => setState(k)}
            >
              {states[k]}
            </button>
          ))}
        </div>
      </header>
      <div className="rw-window">
        <aside className="projects-sidebar" style={{ width: 300 }}>
          <ProjectSidebar
            projects={projects}
            showing={{ chatId: "away" }}
            onOpen={() => {}}
            onPickNew={() => {}}
            onNewScratch={() => {}}
            onSendDraft={() => {}}
            onAdd={() => {}}
            onSettings={() => {}}
            onInbox={() => {}}
          />
        </aside>
        <section className="rw-thread">
          <div className="rw-thread-scroll">
            <div className="rw-message user">
              lets add a functionality that makes it so pasted images show as
              pills inline in the prompt, where I pasted them
            </div>
            <div className="rw-message">
              Started on this here: the paste handler now keeps where each image
              went. Handing it to {computer} to finish and run the e2e specs.
            </div>
          </div>
          <div className="project-chat rw-composer">
            <HandoffStrip chat={thread} onError={(e) => console.error(e)} />
            <form
              className="project-composer"
              onSubmit={(e) => e.preventDefault()}
            >
              <textarea
                className="composer-prompt-input rw-textarea"
                disabled
                placeholder={awayPlaceholder(thread)}
              />
            </form>
          </div>
        </section>
      </div>
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
