// Settings → Computers, the real panel on sample data.
// Open http://127.0.0.1:5177/previews/computers-settings/ (?s=paired|one|empty)
import "../_shared/desktop-stub";
import { StrictMode, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Moon, Sun } from "lucide-react";
import "../../src/styles.css";
import "../../src/features/settings/settings.css";
import "./computers-settings.css";
import { setMode } from "../../src/lib/appearance";
import {
  ComputersMap,
  TakeThreadsOver,
} from "../../src/features/handoff/ComputersSettings";
import type { ComputersOverview, PairedComputer } from "../../shared/handoff";
import type { PhoneRemoteState } from "../../shared/remote";
import type { Api } from "../../shared/types";

const min = 60_000;
type Computer = ComputersOverview["computers"][number];
const mini: Computer = {
  id: "mini",
  name: "Mac mini",
  status: "online",
  address: "100.64.12.34",
  version: "0.14.2",
  update: {
    status: "available",
    current: "0.14.2",
    version: "0.14.3",
    install: "auto",
  },
  threads: [
    {
      chatId: "t1",
      projectId: "p1",
      project: "Relay",
      title: "Add a changelog",
      state: "working",
      since: Date.now() - 12 * min,
    },
    {
      chatId: "t2",
      projectId: "p1",
      project: "Relay",
      title: "Why does the sidebar spec flake?",
      state: "waiting",
      since: Date.now() - 31 * min,
    },
    {
      chatId: "t3",
      projectId: "p1",
      project: "Relay",
      title: "Fix the flaky sidebar spec",
      state: "finished",
      since: Date.now() - 4 * min,
    },
  ],
};
const pi: Computer = {
  id: "pi",
  name: "raspberrypi",
  status: "online",
  address: "100.77.3.18",
  version: "0.13.0",
  outdated: true,
  update: { status: "idle", current: "0.13.0" },
  threads: [
    {
      chatId: "t4",
      projectId: "p2",
      project: "Home",
      title: "Nightly dependency bumps",
      state: "working",
      since: Date.now() - 48 * min,
    },
  ],
};
const vps: Computer = {
  id: "vps",
  name: "hetzner-vps",
  status: "offline",
  detail: "Can't reach hetzner-vps.",
  address: "100.101.4.22",
  threads: [],
};
const samples: Record<
  string,
  { label: string; computers: Computer[]; accepting: boolean }
> = {
  paired: {
    label: "Three computers",
    computers: [mini, pi, vps],
    accepting: true,
  },
  one: {
    label: "One computer",
    computers: [{ ...mini, threads: mini.threads.slice(0, 1) }],
    accepting: false,
  },
  empty: { label: "Nothing paired", computers: [], accepting: false },
};

let current = new URLSearchParams(location.search).get("s") ?? "paired";
if (!(current in samples)) current = "paired";
let computers = [...samples[current]!.computers];
let accepting = samples[current]!.accepting;
let incoming = [
  {
    id: "d1",
    name: "work-laptop",
    kind: "computer" as const,
    created: 0,
    online: false,
  },
];
const remote = (): PhoneRemoteState => ({
  enabled: accepting,
  listening: accepting,
  port: 47821,
  hosts: accepting ? ["100.88.10.3"] : [],
  tailnet: {
    status: "connected",
    addresses: ["100.88.10.3"],
    name: "macbook-pro",
  },
  devices: accepting ? incoming : [],
});
const paired = (): PairedComputer[] =>
  computers.map(({ threads: _, ...c }) => c);
Object.assign(window.relay as Partial<Api>, {
  computersOverview: async () => ({ name: "MacBook-Pro", computers }),
  pairComputer: async (link: string) => {
    await new Promise((r) => setTimeout(r, 600));
    if (!link.trim().startsWith("relay-remote://pair"))
      throw new Error(
        "That isn't a Relay pairing link. Copy it from Settings → Computers on the other computer.",
      );
    const name = new URLSearchParams(link.split("?")[1]).get("n") || "Studio";
    computers = [
      ...computers,
      { id: name, name, status: "online", address: "100.64.0.9", threads: [] },
    ];
    return paired();
  },
  forgetComputer: async (id: string) => {
    computers = computers.filter((c) => c.id !== id);
    return paired();
  },
  // Asked to update: it downloads for a few seconds, restarts, and comes back newer.
  updateComputer: async (id: string) => {
    const at = (update: Computer["update"], extra: Partial<Computer> = {}) =>
      (computers = computers.map((c) =>
        c.id === id ? { ...c, update, ...extra } : c,
      ));
    const c = computers.find((c) => c.id === id)!;
    const version =
      c.update?.status === "available" ? c.update.version : "0.14.3";
    const current = c.version!;
    if (current === version) return { status: "idle" as const, current };
    for (let i = 1; i <= 4; i++)
      setTimeout(
        () => at({ status: "downloading", current, version, progress: i / 4 }),
        i * 900,
      );
    setTimeout(() => at({ status: "installing", current, version }), 4500);
    setTimeout(
      () =>
        at(
          { status: "idle", current: version },
          { version, outdated: undefined, status: "online" },
        ),
      7500,
    );
    setTimeout(
      () =>
        at(
          { status: "installing", current, version },
          { status: "offline", detail: undefined },
        ),
      5500,
    );
    return at({ status: "checking", current }, {}).find((c) => c.id === id)!
      .update!;
  },
  bringBackThread: async (chatId: string) => {
    computers = computers.map((c) => ({
      ...c,
      threads: c.threads.filter((t) => t.chatId !== chatId),
    }));
  },
  readClipboard: async () =>
    "relay-remote://pair?h=100.64.0.9&p=47821&k=q2mZ8f0vX3lK9pQwE7rT1yU4iO6aS5dF2gH8jK0lZxC&c=4f9a2c7e1b8d3f6a0c5e&n=Studio",
  writeClipboard: async () => {},
  openExternal: async (url: string) => console.log("open", url),
  phoneRemoteState: async () => remote(),
  setPhoneRemote: async (on: boolean) => {
    accepting = on;
    return remote();
  },
  phonePairing: async () => ({
    url: "relay-remote://pair?h=100.88.10.3&p=47821&k=q2mZ8f0vX3lK9pQwE7rT1yU4iO6aS5dF2gH8jK0lZxC&c=4f9a2c7e1b8d3f6a0c5e&n=MacBook-Pro",
    expiresAt: Date.now() + 10 * min,
  }),
  revokePhone: async (id: string) => {
    incoming = incoming.filter((d) => d.id !== id);
    return remote();
  },
});

const queryClient = new QueryClient();

/** The entry as Settings draws it: title, description, then the control. */
function Entry({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="setting block" aria-label={title}>
      <div className="setting-text">
        <h4>{title}</h4>
        <p>{description}</p>
      </div>
      <div className="setting-control">{children}</div>
    </section>
  );
}

function Preview() {
  const [sample, setSample] = useState(current);
  const [dark, setDark] = useState(true);
  return (
    <div className="cm-page">
      <div className="cm-bar">
        <span className="cm-sample">Sample data</span>
        <div className="cm-seg" role="tablist" aria-label="State">
          {Object.entries(samples).map(([id, s]) => (
            <button
              key={id}
              role="tab"
              aria-selected={sample === id}
              onClick={() => {
                current = id;
                computers = [...s.computers];
                accepting = s.accepting;
                setSample(id);
                history.replaceState(null, "", `?s=${id}`);
                queryClient.clear();
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <button
          className="cm-icon-button"
          aria-label="Toggle light and dark"
          onClick={() => {
            setMode(dark ? "light" : "dark");
            setDark(!dark);
          }}
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
      </div>
      <div className="cm-dialog">
        <main className="settings-pane">
          <header>
            <div>
              <h3>Computers</h3>
              <p>
                Hand a thread to another computer running Relay, like a Mac mini
                at home, and bring it back later.
              </p>
            </div>
          </header>
          <div className="settings-content" key={sample}>
            <div className="settings-group">
              <Entry
                title="Your computers"
                description="Pick one to see the threads on it. Hand a thread over from its header; its agent writes a note, the worktree is committed and it carries on there."
              >
                <ComputersMap
                  onOpenChat={(p, c) => console.log("open", p, c)}
                />
              </Entry>
            </div>
            <div className="settings-group">
              <h5>Take threads over</h5>
              <Entry
                title="On the computer that stays on"
                description="Turn this on on the Mac mini or server, then pair the other computer with the link it shows."
              >
                <TakeThreadsOver />
              </Entry>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

setMode("dark");
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Preview />
    </QueryClientProvider>
  </StrictMode>,
);
