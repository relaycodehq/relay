// Settings → Agents → More agents: browse, install and remove agents from the
// ACP registry. The registry's CDN allows no other origin, so the listing is a
// trimmed copy of the real one; installing and removing are sample actions.
// Claude Code and OpenCode are missing, so Relay offers to install them (the
// OpenCode install fails), and Amp lacks its amp-acp bridge.
// Open http://127.0.0.1:5177/previews/acp-registry/
import "../_shared/desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../src/styles.css";
import "../_shared/app-styles";
import { initAppearance } from "../../src/lib/appearance";
import { initTypography } from "../../src/lib/typography";
import { Settings } from "../../src/features/settings/Settings";
import { registryProvider } from "../../shared/agents";
import type {
  InstalledRegistryAgent,
  RegistryAgentsState,
  RegistryListing,
} from "../../shared/acp-registry";
import type { Api } from "../../shared/types";
import type { AgentVersion, AgentVersions } from "../../shared/agent-updates";
import type { AgentProvider } from "../../shared/agents";
import listing from "./sample-listing.json";

initAppearance();
initTypography();

const sample = listing as RegistryListing[];
const installedAs = (id: string, version: string): InstalledRegistryAgent => {
  const agent = sample.find((a) => a.id === id)!;
  return {
    provider: registryProvider(id),
    id,
    name: agent.name,
    version,
    via: agent.via!,
    ...(agent.icon && { icon: agent.icon }),
  };
};

let state: RegistryAgentsState = {
  installed: [
    // An older goose, so its row offers Update.
    installedAs("goose", "1.9.0"),
    installedAs("pi-acp", sample.find((a) => a.id === "pi-acp")!.version),
  ],
  busy: {},
};
const listeners = new Set<(state: RegistryAgentsState) => void>();
const set = (next: RegistryAgentsState) => {
  state = next;
  for (const listener of listeners) listener(state);
};
const busy = (id: string, what?: "installing" | "removing") => {
  const { [id]: _, ...rest } = state.busy;
  set({ ...state, busy: what ? { ...rest, [id]: what } : rest });
};
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

const npmInstall = (dir: string, ...packages: string[]) =>
  `npm install -g --prefix '~/Library/Application Support/Relay/agent-clis/${dir}' --no-audit --no-fund ${packages.join(" ")}`;
let versions: AgentVersions = {
  checking: false,
  checkedAt: Date.now() - 20 * 60_000,
  agents: [
    {
      provider: "codex",
      path: "/opt/homebrew/bin/codex",
      current: "0.162.0",
      latest: "0.162.0",
      installer: "homebrew",
      command: "brew upgrade codex",
    },
    {
      provider: "claude",
      installer: "relay",
      command: npmInstall(
        "claude",
        "--ignore-scripts=false",
        "--allow-scripts=@anthropic-ai/claude-code",
        "@anthropic-ai/claude-code@latest",
      ),
      error: "Relay couldn't find Claude Code. Install it here, or link the one you have.",
    },
    {
      provider: "opencode",
      installer: "relay",
      command: npmInstall("opencode", "opencode-ai@latest"),
      error: "Relay couldn't find OpenCode. Install it here, or link the one you have.",
    },
    {
      provider: "amp",
      path: "/Users/me/.amp/bin/amp",
      current: "0.0.1791288059-gdc93b0",
      latest: "0.0.1791288059-gdc93b0",
      installer: "native",
      command: "amp update",
      missing: ["amp-acp"],
    },
  ],
};
const versionListeners = new Set<(state: AgentVersions) => void>();
const putAgent = (agent: AgentVersion) => {
  versions = {
    ...versions,
    agents: versions.agents.map((a) =>
      a.provider === agent.provider ? agent : a,
    ),
  };
  for (const listener of versionListeners) listener(versions);
};
const agentOf = (provider: AgentProvider) =>
  versions.agents.find((a) => a.provider === provider)!;

Object.assign(window.relay as Partial<Api>, {
  agentVersions: async () => versions,
  onAgentVersions: (callback: (state: AgentVersions) => void) => {
    versionListeners.add(callback);
    return () => void versionListeners.delete(callback);
  },
  updateAgent: async (provider: AgentProvider) => {
    const before = agentOf(provider);
    putAgent({ ...before, update: { status: "running" } });
    await wait(2200);
    if (provider === "opencode")
      putAgent({
        ...before,
        update: {
          status: "failed",
          message: "npm install -g … failed with exit code 1.",
          output: "npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/opencode-ai failed",
          at: Date.now(),
        },
      });
    else
      putAgent({
        ...before,
        error: undefined,
        missing: undefined,
        path: before.path ?? `~/Library/Application Support/Relay/agent-clis/${provider}/bin/${provider}`,
        current: before.current ?? "2.1.291",
        latest: before.latest ?? "2.1.291",
        update: {
          status: "updated",
          version: before.current ?? "2.1.291",
          installed: true,
          at: Date.now(),
        },
      });
    return versions;
  },
});

Object.assign(window.relay as Partial<Api>, {
  updateState: async () => ({ status: "off", current: "preview" }),
  aiSettings: () => new Promise(() => {}),
  registryListing: async () => (await wait(600), sample),
  registryAgents: async () => state,
  onRegistryAgents: (callback: (state: RegistryAgentsState) => void) => {
    listeners.add(callback);
    return () => void listeners.delete(callback);
  },
  installRegistryAgent: async (id: string) => {
    busy(id, "installing");
    await wait(1800);
    const agent = sample.find((a) => a.id === id)!;
    set({
      ...state,
      installed: [
        ...state.installed.filter((a) => a.id !== id),
        installedAs(id, agent.version),
      ],
    });
    busy(id);
    return state;
  },
  removeRegistryAgent: async (id: string) => {
    busy(id, "removing");
    await wait(900);
    set({ ...state, installed: state.installed.filter((a) => a.id !== id) });
    busy(id);
    return state;
  },
});

const queryClient = new QueryClient();

function Preview() {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ padding: 32, maxWidth: 820 }}>
      <p style={{ color: "var(--muted)", fontSize: 12 }}>
        Sample data: a trimmed copy of the ACP registry and made-up agents;
        install and remove are pretend ·{" "}
        <button type="button" onClick={() => setOpen(true)}>
          Open settings
        </button>
      </p>
      {open && (
        <Settings
          account={null}
          initialCategory="agents"
          onClose={() => setOpen(false)}
          onDisconnect={async () => {}}
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
