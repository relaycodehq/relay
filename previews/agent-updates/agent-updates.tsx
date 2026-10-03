// Agent CLI updates: the sidebar footer control and Settings' Installed agents.
// Open http://127.0.0.1:5177/previews/agent-updates/
import "../_shared/desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Settings2 } from "lucide-react";
import "../../src/styles.css";
import "../../src/features/sidebar/sidebar.css";
import "../../src/features/settings/settings.css";
import { initAppearance } from "../../src/lib/appearance";
import {
  AgentUpdateButton,
  AgentVersionSettings,
} from "../../src/features/updates/AgentUpdates";
import { UpdateButton } from "../../src/features/updates/UpdateButton";
import { IconButton } from "../../src/ui/ui";
import type { AgentVersion, AgentVersions } from "../../shared/agent-updates";
import type { AgentProvider } from "../../shared/agents";
import type { Api } from "../../shared/types";

initAppearance();

const codex: AgentVersion = {
  provider: "codex",
  path: "/home/sample/.bun/bin/codex",
  current: "0.157.0",
  latest: "0.158.0",
  installer: "bun",
  command: "bun add -g @openai/codex@latest",
};
const claude: AgentVersion = {
  provider: "claude",
  path: "/home/sample/.local/bin/claude",
  current: "2.1.284",
  latest: "2.1.284",
  installer: "native",
  command: "claude update",
};
const opencode: AgentVersion = {
  provider: "opencode",
  path: "/home/sample/.opencode/bin/opencode",
  current: "1.18.32",
  latest: "1.18.33",
  installer: "native",
  command: "opencode upgrade",
};

const notFound =
  "Relay couldn't find OpenCode. If it's installed, link it here.";

// Sample data, not this machine's agents.
const samples: Record<string, AgentVersion[]> = {
  "Two behind": [codex, claude, opencode],
  "One behind": [codex, claude, { ...opencode, latest: "1.18.32" }],
  "Can't update": [
    { ...codex, installer: undefined, command: undefined },
    claude,
    { ...opencode, error: "OpenCode isn't installed.", current: undefined },
  ],
  "Not found": [
    codex,
    {
      provider: "claude",
      error:
        "Relay couldn't find Claude Code. If it's installed, link it here.",
    },
    { ...opencode, path: undefined, current: undefined, error: notFound },
  ],
  "Won't say version": [
    codex,
    {
      provider: "claude",
      path: "/home/sample/.local/share/mise/shims/claude",
      error: "Claude Code didn't say which version it is.",
      output: "mise ERROR No version is set for shim: claude",
    },
    opencode,
  ],
  Updating: [
    { ...codex, update: { status: "running" } },
    claude,
    { ...opencode, update: { status: "queued" } },
  ],
  Failed: [
    {
      ...codex,
      update: {
        status: "failed",
        message: "bun add -g @openai/codex@latest failed with exit code 1.",
        output:
          "bun add v1.2.21\nerror: GET https://registry.npmjs.org/@openai%2fcodex - 503\nerror: @openai/codex@latest failed to resolve",
        at: Date.now(),
      },
    },
    claude,
    opencode,
  ],
  "All current": [
    { ...codex, latest: "0.157.0" },
    claude,
    { ...opencode, latest: "1.18.32" },
  ],
};

let state: AgentVersions = {
  agents: samples["Two behind"],
  checking: false,
  checkedAt: Date.now() - 12 * 60_000,
};
let emit: (next: AgentVersions) => void = () => {};
let queue: Promise<unknown> = Promise.resolve();
const set = (next: AgentVersions) => emit((state = next));
const put = (agent: AgentVersion) =>
  set({
    ...state,
    agents: state.agents.map((a) =>
      a.provider === agent.provider ? agent : a,
    ),
  });
const find = (provider: AgentProvider) =>
  state.agents.find((a) => a.provider === provider)!;

Object.assign(window.relay as Partial<Api>, {
  updateState: async () => ({ status: "idle", current: "preview" }),
  onUpdate: () => () => {},
  agentVersions: async () => state,
  onAgentVersions: (callback: (next: AgentVersions) => void) => {
    emit = callback;
    return () => {};
  },
  checkAgentVersions: async () => {
    set({ ...state, checking: true });
    await new Promise((r) => setTimeout(r, 1200));
    set({ ...state, checking: false, checkedAt: Date.now() });
    return state;
  },
  // The dialog is the desktop's; the sample links a mise install.
  linkAgent: async (provider: AgentProvider) => {
    if (provider === "opencode")
      throw new Error(
        "That doesn't look like OpenCode: it didn't say which version it is.\nmise ERROR No version is set for shim: opencode",
      );
    put({
      provider,
      path: `/home/sample/.local/share/mise/installs/${provider}/latest/bin/${provider}`,
      linked: true,
      current: "2.1.284",
      latest: "2.1.284",
    });
    return state;
  },
  unlinkAgent: async (provider: AgentProvider) => {
    put({
      provider,
      error: "Relay couldn't find it. If it's installed, link it here.",
    });
    return state;
  },
  // Updates take a moment, then land on the newer version.
  updateAgent: async (provider: AgentProvider) => {
    put({ ...find(provider), update: { status: "queued" } });
    const turn = queue.then(() => {
      put({ ...find(provider), update: { status: "running" } });
      return new Promise((r) => setTimeout(r, 2000));
    });
    queue = turn;
    await turn;
    const agent = find(provider);
    put({
      ...agent,
      current: agent.latest,
      update: { status: "updated", version: agent.latest!, at: Date.now() },
    });
    return state;
  },
});

function Preview() {
  const [sample, setSample] = useState("Two behind");
  const [opened, setOpened] = useState(false);
  return (
    <div style={{ padding: 24, display: "grid", gap: 24, maxWidth: 760 }}>
      <div className="segmented settings-segmented">
        {Object.keys(samples).map((name) => (
          <button
            key={name}
            className={sample === name ? "active" : ""}
            onClick={() => {
              setSample(name);
              set({ ...state, agents: samples[name] });
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <p className="setting-muted">
        Sample data. The footer below is the sidebar's, at its usual width.
        {opened && " (Settings would open at AI models.)"}
      </p>
      <div
        className="sb"
        style={{
          width: 264,
          flex: "none",
          background: "var(--sidebar)",
          border: "1px solid var(--border)",
          borderRadius: 10,
        }}
      >
        <div className="sb-footer">
          <button className="sb-account">
            <span className="sb-avatar" aria-hidden>
              LM
            </span>
            <span>lubomirmolin</span>
          </button>
          <UpdateButton />
          <AgentUpdateButton onDetails={() => setOpened(true)} />
          <IconButton label="Open settings" onClick={() => setOpened(true)}>
            <Settings2 size={15} />
          </IconButton>
        </div>
      </div>
      <section>
        <h3 style={{ margin: "0 0 4px", fontSize: 13 }}>Installed agents</h3>
        <p className="setting-muted" style={{ margin: "0 0 10px" }}>
          Relay runs the agent CLIs installed on this computer and tells you
          when a newer release is out.
        </p>
        <AgentVersionSettings />
      </section>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
