// Activity cards showing who's answering, previewed on sample data.
// Open http://127.0.0.1:5177/previews/running-agents.html
import "../_shared/desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/styles.css";
import "../../src/app/projects.css";
import { initAppearance } from "../../src/lib/appearance";
import { initWindowFocus } from "../../src/lib/window-focus";
import { ProjectSidebar } from "../../src/features/sidebar/ProjectSidebar";
import type { Api } from "../../shared/types";
import type { ChatSummary, Project } from "../../shared/projects";

localStorage.setItem("relay-sidebar-view", "activity");
initAppearance();
initWindowFocus();

const minute = 60_000;
const now = Date.now();
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
    created: now - 30 * minute,
    updated: now - minute,
    branch: "main",
    ...c,
  }) as ChatSummary;

// `provider` is what the old card had to go on: the last finished answer.
const sample: ChatSummary[] = [
  chat({
    id: "first-turn",
    title: "lets make it so all the shortcuts can be rebound",
    running: true,
    runningSince: now - 8.5 * minute,
    runningAgents: ["claude"],
  }),
  chat({
    id: "deep-review",
    title: "Deep review · Share snapshots without Gitea",
    scope: { kind: "pr", ref: { owner: "you", name: "relay", number: 412 } },
    branch: "share-snapshots",
    provider: "claude",
    running: true,
    runningSince: now - 3 * minute,
    runningAgents: ["claude", "codex", "cursor", "opencode"],
  }),
  chat({
    id: "ultraplan",
    projectId: "openusage",
    title: "Plan the usage history export",
    branch: "export",
    provider: "claude",
    running: true,
    runningSince: now - 90_000,
    runningAgents: ["codex", "claude", "opencode"],
  }),
  chat({
    id: "switched",
    title: "Why does the dock icon badge lag behind?",
    provider: "claude",
    running: true,
    waiting: true,
    runningSince: now - 5 * minute,
    runningAgents: ["codex"],
  }),
  chat({
    id: "done",
    projectId: "openusage",
    title: "Bump the Tauri updater and re-sign",
    provider: "cursor",
    updated: now - 20 * minute,
  }),
];
const before = sample.map(({ runningAgents: _, ...c }) => c);

function install(chats: ChatSummary[]) {
  Object.assign(window.relay, {
    projectChats: async (id: string) => chats.filter((c) => c.projectId === id),
    scratchChats: async () => [],
    projectGroups: async () => [],
    updateState: async () => ({ status: "off", current: "0.1.0" }),
    onUpdate: () => () => {},
    agentVersions: async () => ({ agents: [], checking: false }),
    onAgentVersions: () => () => {},
    onProjectChat: () => () => {},
    triageProjectChat: async () => {},
  } satisfies Partial<Record<keyof Api, unknown>>);
}

function Preview() {
  const [mode, setMode] = useState<"after" | "before">("after");
  install(mode === "after" ? sample : before);
  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <aside className="projects-sidebar" style={{ width: 300 }}>
        <QueryClientProvider key={mode} client={clients[mode]}>
          <ProjectSidebar
            projects={projects}
            showing={{}}
            onOpen={() => {}}
            onPickNew={() => {}}
            onNewScratch={() => {}}
            onSendDraft={() => {}}
            onAdd={() => {}}
            onShared={() => {}}
            onSettings={() => {}}
            onAccount={() => {}}
            onInbox={() => {}}
          />
        </QueryClientProvider>
      </aside>
      <main style={{ padding: 24, color: "var(--muted)", fontSize: 13 }}>
        <p style={{ marginTop: 0 }}>Sample data</p>
        <div role="radiogroup" style={{ display: "flex", gap: 8 }}>
          {(["after", "before"] as const).map((m) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              className={mode === m ? "primary" : "secondary"}
              onClick={() => setMode(m)}
            >
              {m === "after" ? "After" : "Before"}
            </button>
          ))}
        </div>
        <ul style={{ lineHeight: 1.7, maxWidth: 440 }}>
          <li>First turn, Claude: no icon before.</li>
          <li>
            Deep review: Claude leads, Codex, Cursor and OpenCode review; past
            three agents the last slot counts the rest.
          </li>
          <li>Ultraplan: Codex leads a council with Claude and OpenCode.</li>
          <li>
            Switched to Codex, waiting on you: before, the card still said
            Claude.
          </li>
          <li>Finished: last answer's agent, same as before.</li>
        </ul>
      </main>
    </div>
  );
}

// One cache per mode, so switching doesn't show the other mode's lists.
const clients = { after: new QueryClient(), before: new QueryClient() };
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
