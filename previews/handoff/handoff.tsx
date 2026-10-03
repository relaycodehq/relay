// Handing a thread to another computer: the header button, the strip on the
// composer through each step, and Settings → Computers, on sample data.
// Open http://127.0.0.1:5177/previews/handoff/ (?s=<scene>)
import "../_shared/desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../../src/features/settings/settings.css";
import "../../src/ui/workspace-panes.css";
import "../../src/features/agents/composer-model-picker.css";
import { initAppearance } from "../../src/lib/appearance";
import { HandoffButton } from "../../src/features/handoff/HandoffButton";
import {
  awayPlaceholder,
  HandoffStrip,
  ReturnedStrip,
} from "../../src/features/handoff/HandoffStrip";
import type {
  HandoffTarget,
  HandoffView,
  PairedComputer,
} from "../../shared/handoff";
import type { ChatSummary } from "../../shared/projects";
import type { PhoneRemoteState } from "../../shared/remote";
import type { Api } from "../../shared/types";

initAppearance();

const mini: PairedComputer = { id: "c1", name: "Mac mini", status: "online" };
const pi: PairedComputer = {
  id: "c2",
  name: "raspberrypi",
  status: "offline",
  detail: "Can't reach raspberrypi.",
};
const thread: ChatSummary = {
  id: "0f0e0d0c-0000-4000-8000-000000000001",
  projectId: "p1",
  title: "Add a changelog",
  scope: { kind: "project" },
  created: Date.now() - 3_600_000,
  updated: Date.now() - 60_000,
  worktree: {
    path: "/Users/you/relay/worktrees/app/add-a-changelog",
    branch: "relay/add-a-changelog",
  },
};
const sentTo = {
  id: "h1",
  computerId: "c1",
  computer: "Mac mini",
  at: Date.now() - 20 * 60_000,
};
const remote = {
  title: "Add a changelog",
  running: false,
  waiting: false,
  settled: false,
  updated: Date.now(),
  returned: false,
};

type Scene = {
  label: string;
  computers?: PairedComputer[];
  targets?: HandoffTarget[];
  view?: HandoffView;
  chat?: Partial<ChatSummary>;
  settings?: boolean;
};
const scenes: Record<string, Scene> = {
  "not-paired": { label: "Button · nothing paired", computers: [] },
  paired: {
    label: "Button · paired",
    computers: [mini, pi],
    targets: [
      {
        id: "c1",
        name: "Mac mini",
        online: true,
        project: { id: "p9", name: "App" },
      },
      { id: "c2", name: "raspberrypi", online: false, problem: "Offline" },
    ],
  },
  "not-cloned": {
    label: "Button · not cloned",
    computers: [mini],
    targets: [
      {
        id: "c1",
        name: "Mac mini",
        online: true,
        problem: "Not cloned on Mac mini",
      },
    ],
  },
  checkout: {
    label: "Button · checkout thread",
    computers: [mini],
    targets: [],
    chat: { worktree: undefined },
  },
  sending: {
    label: "Strip · handing off",
    view: { sentTo: { ...sentTo, state: "sending" }, online: true },
  },
  working: {
    label: "Strip · working there",
    view: {
      sentTo: { ...sentTo, state: "away" },
      online: true,
      remote: { ...remote, running: true },
    },
  },
  waiting: {
    label: "Strip · waiting there",
    view: {
      sentTo: { ...sentTo, state: "away" },
      online: true,
      remote: { ...remote, running: true, waiting: true },
    },
  },
  finished: {
    label: "Strip · finished",
    view: {
      sentTo: { ...sentTo, state: "away" },
      online: true,
      remote: {
        ...remote,
        latest:
          "Added CHANGELOG.md with one line per release, newest first, and linked it from the README.",
      },
    },
  },
  offline: {
    label: "Strip · offline",
    view: { sentTo: { ...sentTo, state: "away" }, online: false },
  },
  failed: {
    label: "Strip · handoff failed",
    view: {
      sentTo: {
        ...sentTo,
        state: "sending",
        error:
          "No project here has me/app. Clone it and add it to Relay first.",
      },
      online: true,
    },
  },
  returning: {
    label: "Strip · bringing back",
    view: { sentTo: { ...sentTo, state: "returning" }, online: true },
  },
  "return-failed": {
    label: "Strip · couldn't bring back",
    view: {
      sentTo: {
        ...sentTo,
        state: "returning",
        error:
          "The worktree moved on while the thread was away, so its work can't simply come back. It's kept at refs/relay/handoffs/h1.",
      },
      online: true,
    },
  },
  "return-clash": {
    label: "Strip · came back clashing",
    view: {
      sentTo: {
        ...sentTo,
        state: "returning",
        error:
          "Its work and what was committed here meanwhile both change src/lib/cache.ts. It's kept at refs/relay/handoffs/h1.",
        conflicts: ["src/lib/cache.ts"],
      },
      online: true,
    },
  },
  returned: { label: "Strip · on the mini, handed back" },
};

const accept: PhoneRemoteState = {
  enabled: true,
  listening: true,
  port: 47821,
  hosts: ["100.64.12.34"],
  tailnet: {
    status: "connected",
    addresses: ["100.64.12.34"],
    name: "mac-mini",
  },
  devices: [
    {
      id: "d1",
      name: "MacBook-Pro",
      kind: "computer",
      created: Date.now() - 86_400_000,
      lastSeen: Date.now(),
      online: true,
    },
    {
      id: "d2",
      name: "Galaxy Z Fold7",
      created: Date.now() - 86_400_000,
      online: false,
    },
  ],
};

let current = new URLSearchParams(location.search).get("s") ?? "paired";
const scene = () => scenes[current] ?? scenes.paired!;
const queryClient = new QueryClient();
Object.assign(window.relay as Partial<Api>, {
  pairedComputers: async () => scene().computers ?? [mini, pi],
  handoffTargets: async () => {
    await new Promise((r) => setTimeout(r, 400));
    return scene().targets ?? [];
  },
  handOffThread: async (_chat: string, id: string) => {
    console.log("hand off to", id);
    current = "sending";
  },
  handoffView: async () => scene().view ?? null,
  bringBackThread: async () => {
    current = "returning";
  },
  retryHandoff: async () => {
    current = "sending";
  },
  keepThreadHere: async () => {},
  pairComputer: async () => [mini, pi],
  forgetComputer: async () => [mini],
  phoneRemoteState: async () => accept,
  setPhoneRemote: async () => accept,
  phonePairing: async () => ({
    url: "relay-remote://pair?h=100.64.12.34&p=47821&k=sampleKeySampleKeySampleKeySampleKeySample&c=sample-code-1234&n=Mac+mini",
    expiresAt: Date.now() + 600_000,
  }),
  revokePhone: async () => accept,
  writeClipboard: async () => {},
});

function Preview() {
  const [name, setName] = useState(current);
  const s = scene();
  const chat: ChatSummary = {
    ...thread,
    ...s.chat,
    ...(s.view ? { sentTo: s.view.sentTo } : {}),
    ...(name === "returned"
      ? {
          cameFrom: {
            id: "h1",
            computer: "MacBook-Pro",
            deviceId: "d1",
            at: 0,
            carried: 4,
            tip: "abc",
            returnedAt: Date.now(),
          },
        }
      : {}),
  };
  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 16 }}>
      <p style={{ color: "var(--muted)", fontSize: 12, lineHeight: 2 }}>
        Sample data.{" "}
        {Object.entries(scenes).map(([id, { label }]) => (
          <button
            key={id}
            aria-pressed={id === name}
            style={{ marginRight: 6, fontWeight: id === name ? 600 : 400 }}
            onClick={() => {
              current = id;
              setName(id);
              history.replaceState(null, "", `?s=${id}`);
              void queryClient.resetQueries();
            }}
          >
            {label}
          </button>
        ))}
      </p>
      {s.settings ? null : (
        <>
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
            <span className="spacer" style={{ flex: 1 }} />
            <HandoffButton
              key={name}
              chat={chat}
              onSettings={() => console.log("open Settings → Computers")}
              onError={(e) => console.error(e)}
            />
          </header>
          <div className="project-chat" style={{ marginTop: 160 }}>
            {chat.sentTo ? (
              <HandoffStrip
                key={name}
                chat={chat}
                onError={(e) => console.error(e)}
              />
            ) : chat.cameFrom?.returnedAt ? (
              <ReturnedStrip computer={chat.cameFrom.computer} />
            ) : null}
            <form
              className="project-composer"
              onSubmit={(e) => e.preventDefault()}
            >
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
                disabled={!!chat.sentTo || !!chat.cameFrom?.returnedAt}
                placeholder={awayPlaceholder(chat) ?? "Ask Claude anything…"}
              />
            </form>
          </div>
        </>
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
