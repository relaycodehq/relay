// Settings → Integrations → Source control, on sample data.
// Open http://127.0.0.1:5177/previews/source-control.html
import "./desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/styles.css";
import "../src/components/settings.css";
import { initAppearance } from "../src/lib/appearance";
import { SourceControlSettings } from "../src/components/SourceControlSettings";
import type {
  SourceControlKind,
  SourceControlProvider,
} from "../shared/source-control";
import type { TeaSetup } from "../shared/source-control";
import type { Api } from "../shared/types";
import { TeaSignIn } from "../src/components/TeaSignIn";

initAppearance();

const github: SourceControlProvider = {
  kind: "github",
  name: "GitHub",
  cli: "gh",
  enabled: true,
  path: "/opt/homebrew/bin/gh",
  version: "2.101.0",
  signIn: "signed-in",
  account: "sample-user",
};
const gitea: SourceControlProvider = {
  kind: "gitea",
  name: "Gitea",
  cli: "tea",
  enabled: true,
  path: "/opt/homebrew/bin/tea",
  version: "0.16.0",
  signIn: "signed-in",
  account: "sample-user on git.example.com",
};
const giteaOut: SourceControlProvider = {
  ...gitea,
  signIn: "signed-out",
  account: undefined,
  detail: "tea is logged in to git.example.com. Connect to use one.",
};

// Sample data, not this machine's tools.
const samples: Record<string, SourceControlProvider[]> = {
  "Both ready": [github, gitea],
  "gh signed out": [
    {
      ...github,
      signIn: "signed-out",
      account: undefined,
      detail: "Run `gh auth login` in a terminal to sign in.",
    },
    gitea,
  ],
  "Gitea signed out": [github, giteaOut],
  "Nothing installed": [
    {
      ...github,
      path: undefined,
      version: undefined,
      signIn: "unknown",
      account: undefined,
      detail:
        "Install the GitHub CLI (`brew install gh`, or cli.github.com), or link it here if it lives somewhere else.",
    },
    {
      ...giteaOut,
      path: undefined,
      version: undefined,
      detail:
        "Connect with a token, or link tea to sign in with one of its logins.",
    },
  ],
  "gh linked": [
    {
      ...github,
      linked: true,
      path: "/home/sample/.local/share/mise/installs/gh/latest/bin/gh",
    },
    { ...gitea, enabled: false },
  ],
};

let state = samples["Both ready"];
const wait = () => new Promise((r) => setTimeout(r, 500));

Object.assign(window.relay as Partial<Api>, {
  sourceControl: async () => {
    await wait();
    return state;
  },
  setSourceControlEnabled: async (
    kind: SourceControlKind,
    enabled: boolean,
  ) => {
    state = state.map((p) => (p.kind === kind ? { ...p, enabled } : p));
    return state;
  },
  // The dialog is the desktop's; the sample links a mise install.
  linkSourceControlCli: async (kind: SourceControlKind) => {
    state = state.map((p) =>
      p.kind === kind
        ? {
            ...p,
            linked: true,
            path: `/home/sample/.local/share/mise/installs/${p.cli}/latest/bin/${p.cli}`,
          }
        : p,
    );
    return state;
  },
  unlinkSourceControlCli: async (kind: SourceControlKind) => {
    state = state.map((p) =>
      p.kind === kind ? { ...p, linked: undefined } : p,
    );
    return state;
  },
  teaSetup: async () => teaSample,
  connectWithTea: async () => {
    await wait();
    throw new Error("Sample: this preview doesn't sign in.");
  },
});

const teaSample: TeaSetup = {
  path: "/opt/homebrew/bin/tea",
  version: "0.16.0",
  logins: [
    {
      name: "work",
      url: "https://git.example.com",
      user: "ann",
      default: true,
    },
    {
      name: "home",
      url: "http://192.168.1.20:3000",
      user: "ann",
      default: false,
    },
  ],
};

const client = new QueryClient();

function Preview() {
  const [sample, setSample] = useState("Both ready");
  return (
    <div style={{ padding: 24, display: "grid", gap: 24, maxWidth: 760 }}>
      <div className="segmented settings-segmented">
        {Object.keys(samples).map((name) => (
          <button
            key={name}
            className={sample === name ? "active" : ""}
            onClick={() => {
              setSample(name);
              state = samples[name];
              client.invalidateQueries({ queryKey: ["source-control"] });
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <p className="setting-muted">Sample data.</p>
      <SourceControlSettings onConnect={() => {}} />
      <div style={{ width: 395 }}>
        <p className="setting-muted">The sign-in screen's tea section:</p>
        <TeaSignIn onConnected={async () => {}} />
      </div>
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
