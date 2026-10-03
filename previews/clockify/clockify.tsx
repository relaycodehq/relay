// The Clockify plugin on sample data: the sidebar timer, its settings and
// the end-of-day review, laid out by the real attribution from sample
// threads. Open http://127.0.0.1:5177/previews/clockify/
import "../_shared/desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/styles.css";
import "../../src/features/sidebar/sidebar.css";
import "../../src/features/settings/settings.css";
import { initAppearance } from "../../src/lib/appearance";
import { initTypography } from "../../src/lib/typography";
import { RefreshCw, Settings2 } from "lucide-react";
import { IconButton } from "../../src/ui/ui";
import { ClockifyTimer } from "../../src/features/plugins/ClockifyTimer";
import { PluginCard } from "../../src/features/plugins/PluginSettings";
import {
  defaultClockifySettings,
  tidy,
  type ClockifyBlockEdit,
  type ClockifyStatus,
} from "../../shared/clockify";
import { attributeTime } from "../../shared/time-attribution";
import type { Api } from "../../shared/types";

initAppearance();
initTypography();

const MIN = 60_000;
const projects = [
  { id: "pa", name: "Licensing", path: "/work/licensing" },
  { id: "pb", name: "Website", path: "/work/website" },
  { id: "pc", name: "Relay", path: "/work/relay" },
].map((p) => ({ ...p, repository: null, added: 1 }));
const clockifyProjects = [
  { id: "cA", name: "Licensing portal", clientName: "Contoso", color: "#4f8bf5" },
  { id: "cB", name: "Website", clientName: "Contoso", color: "#e0913b" },
  { id: "cC", name: "Internal tools", color: "#7bc47f" },
];
const settings = {
  ...defaultClockifySettings,
  workspaceId: "w1",
  projects: { pa: "cA", pb: "cB" } as Record<string, string>,
};
const descriptions: Record<string, string> = {
  pa: "Fixed license key import for multi-seat customers and the renewal seat count",
  pb: "Reworked the pricing page plan comparison and hero spacing",
};

let status: ClockifyStatus = {
  settings,
  hasToken: true,
  persistent: true,
  day: null,
  review: null,
};
const update = (next: Partial<ClockifyStatus>) =>
  (status = { ...status, ...next });

/** A sample morning: Licensing, a background agent on Website, lunch, then Relay (untracked). */
function sampleReview(start: number) {
  const at = (m: number) => start + m * MIN;
  const end = at(420);
  const pieces = attributeTime(
    { start, end, pauses: [{ start: at(210), end: at(255) }] },
    [
      { projectId: "pa", chatId: "a1", start: at(4), end: at(62) },
      { projectId: "pa", chatId: "a2", start: at(80), end: at(120) },
      { projectId: "pb", chatId: "b1", start: at(100), end: at(190) },
      { projectId: "pc", chatId: "c1", start: at(260), end: at(300) },
      { projectId: "pb", chatId: "b2", start: at(330), end: at(380) },
    ],
    [60, 70, 140, 150, 160, 310, 320].map((m) => ({
      projectId: m > 300 ? "pb" : m > 130 ? "pb" : "pa",
      at: at(m),
    })),
    {
      idleCap: 20 * MIN,
      maxTurn: 180 * MIN,
      minBlock: 5 * MIN,
      included: (id) => !!settings.projects[id],
    },
  );
  return {
    start,
    end,
    describing: true,
    threads: {
      a1: "Fix license key import for multi-seat customers",
      a2: "Seat count off by one after renewal",
      b1: "Pricing page: plan comparison table",
      b2: "Hero copy and CTA spacing",
    } as Record<string, string>,
    blocks: pieces.map((p, i) => ({
      id: `b${i}`,
      start: p.start,
      end: p.end,
      relayProjectId: p.projectId,
      clockifyProjectId: p.projectId ? settings.projects[p.projectId] : "",
      description: "",
      chatIds: p.chatIds,
      ...(p.reason ? { reason: p.reason } : {}),
    })),
  };
}
function describeLater() {
  setTimeout(() => {
    const review = status.review;
    if (!review) return;
    update({
      review: {
        ...review,
        describing: false,
        blocks: review.blocks.map((b) =>
          b.description || !b.relayProjectId
            ? b
            : { ...b, description: descriptions[b.relayProjectId] ?? "" },
        ),
      },
    });
  }, 2000);
}
function dayStart() {
  const d = new Date();
  d.setHours(8, 30, 0, 0);
  return d.getTime();
}

const clockify: Partial<Api> = {
  plugins: async () => ({ clockify: true, devops: false }),
  setPluginEnabled: async (_id, enabled) => ({
    clockify: enabled,
    devops: false,
  }),
  projects: async () => projects,
  clockifyStatus: async () => status,
  clockifyWorkspaces: async () => [{ id: "w1", name: "Contoso" }],
  clockifyProjects: async () => clockifyProjects,
  saveClockifySettings: async (next) =>
    update({ settings: next }) && { ...status, account: "Sample Person" },
  clockifyTouch: async () => {},
  clockifyTimer: async (action) => {
    const now = Date.now();
    if (action === "start") update({ day: { start: dayStart(), pauses: [] } });
    else if (action === "pause")
      update({ day: { ...status.day!, pauses: [{ start: now }] } });
    else if (action === "resume")
      update({
        day: { ...status.day!, pauses: [{ start: now - 10 * MIN, end: now }] },
      });
    else {
      update({ day: null, review: sampleReview(status.day!.start) });
      describeLater();
    }
    return status;
  },
  saveClockifyReview: async (edits: ClockifyBlockEdit[]) => {
    const byId = new Map(edits.map((e) => [e.id, e]));
    return update({
      review: {
        ...status.review!,
        blocks: tidy(
          status.review!.blocks.map((b) => ({ ...b, ...byId.get(b.id) })),
        ),
      },
    });
  },
  describeClockifyReview: async () => {
    update({
      review: {
        ...status.review!,
        describing: true,
        blocks: status.review!.blocks.map((b) => ({ ...b, description: "" })),
      },
    });
    describeLater();
    return status;
  },
  submitClockifyReview: async () => {
    await new Promise((r) => setTimeout(r, 700));
    return update({
      review: {
        ...status.review!,
        blocks: status.review!.blocks.map((b) =>
          b.clockifyProjectId ? { ...b, submittedId: `e-${b.id}` } : b,
        ),
      },
    });
  },
  discardClockifyReview: async () => update({ review: null }),
};
Object.assign(window.relay, clockify);

const client = new QueryClient();
const states = {
  fresh: () => update({ day: null, review: null }),
  tracking: () =>
    update({ day: { start: dayStart(), pauses: [] }, review: null }),
  paused: () =>
    update({
      day: { start: dayStart(), pauses: [{ start: Date.now() - 12 * MIN }] },
      review: null,
    }),
  review: () => {
    update({ day: null, review: sampleReview(dayStart()) });
    describeLater();
  },
};

function Preview() {
  const [state, setState] = useState<keyof typeof states>("fresh");
  const [thread, setThread] = useState("pa");
  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <aside
        style={{
          width: 270,
          display: "flex",
          flexDirection: "column",
          background: "var(--sidebar)",
          borderRight: "1px solid var(--border)",
        }}
      >
        <div className="sb">
          <p
            className="muted"
            style={{ margin: 0, padding: "10px 12px", flex: 1 }}
          >
            Sample data · sidebar
            <br />
            Open project:{" "}
            <select value={thread} onChange={(e) => setThread(e.target.value)}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </p>
          <div className="sb-footer">
            <span className="sb-avatar" style={{ marginRight: "auto" }}>
              SP
            </span>
            <ClockifyTimer
              projectId={thread}
              projectName={projects.find((p) => p.id === thread)?.name}
              onSetUp={() => {}}
            />
            <IconButton label="Check for updates">
              <RefreshCw size={15} />
            </IconButton>
            <IconButton label="Open settings">
              <Settings2 size={15} />
            </IconButton>
          </div>
        </div>
      </aside>
      <main style={{ flex: 1, overflow: "auto", padding: 24 }}>
        <p className="muted" style={{ marginTop: 0 }}>
          Sample data · jump to:{" "}
          {(Object.keys(states) as (keyof typeof states)[]).map((s) => (
            <button
              key={s}
              aria-pressed={state === s}
              style={{ marginRight: 6 }}
              onClick={() => {
                states[s]();
                setState(s);
                void client.invalidateQueries();
              }}
            >
              {s}
            </button>
          ))}
        </p>
        <h3>Settings → Plugins → Clockify</h3>
        <div
          className="settings-screen"
          style={{
            display: "block",
            height: "auto",
            maxWidth: 700,
            padding: 16,
          }}
        >
          <PluginCard id="clockify" title="Clockify time tracking" />
        </div>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <Preview />
    </QueryClientProvider>
  </StrictMode>,
);
