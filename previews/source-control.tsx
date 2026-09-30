// Settings → Integrations → Source control, and the Gitea sign-in's tea logins.
// Open http://127.0.0.1:5177/previews/source-control.html
import "./desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/styles.css";
import "../src/components/projects.css";
import { initAppearance } from "../src/lib/appearance";
import { Settings } from "../src/components/Settings";
import { SignIn } from "../src/ReviewSurface";
import { Modal } from "../src/components/ui";
import type {
  SourceControlKind,
  SourceControlProvider,
  TeaSetup,
} from "../shared/source-control";
import type { Api } from "../shared/types";

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
  account: "sample-user",
  server: "git.example.com",
};
const giteaOut: SourceControlProvider = {
  ...gitea,
  signIn: "signed-out",
  account: undefined,
  server: undefined,
};
const ghMissing: SourceControlProvider = {
  ...github,
  path: undefined,
  version: undefined,
  signIn: "unknown",
  account: undefined,
};

// Sample data, not this machine's tools.
const scenarios: Record<
  string,
  { providers: SourceControlProvider[]; tea: TeaSetup }
> = {
  "All set": {
    providers: [github, gitea],
    tea: { path: gitea.path, version: "0.16.0", logins: [] },
  },
  "tea has logins": {
    providers: [
      github,
      { ...giteaOut, detail: "tea has a login for git.example.com." },
    ],
    tea: {
      path: gitea.path,
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
    },
  },
  "gh signed out": {
    providers: [{ ...github, signIn: "signed-out", account: undefined }, gitea],
    tea: { path: gitea.path, version: "0.16.0", logins: [] },
  },
  "Nothing installed": {
    providers: [
      { ...ghMissing, detail: "Install it with `brew install gh`." },
      { ...giteaOut, path: undefined, version: undefined },
    ],
    tea: { logins: [] },
  },
  "Gitea off": {
    providers: [github, { ...gitea, enabled: false }],
    tea: { path: gitea.path, version: "0.16.0", logins: [] },
  },
};

// Also settable from the URL (?s=All%20set&v=signin), since the dialogs are modal.
const params = new URLSearchParams(location.search);
let current = scenarios[params.get("s") ?? ""] ?? scenarios["All set"];
const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms));

Object.assign(window.relay as Partial<Api>, {
  updateState: async () => ({ status: "off", current: "preview" }),
  sourceControl: async () => {
    await wait();
    return current.providers;
  },
  setSourceControlEnabled: async (
    kind: SourceControlKind,
    enabled: boolean,
  ) => {
    current = {
      ...current,
      providers: current.providers.map((p) =>
        p.kind === kind ? { ...p, enabled } : p,
      ),
    };
    return current.providers;
  },
  // The file dialog is the desktop's; the sample links a mise install.
  linkSourceControlCli: async (kind: SourceControlKind) => {
    await wait();
    current = {
      ...current,
      providers: current.providers.map((p) =>
        p.kind === kind
          ? {
              ...p,
              linked: true,
              path: `/home/sample/.local/share/mise/installs/${p.cli}/latest/bin/${p.cli}`,
              version: p.version ?? (kind === "github" ? "2.101.0" : "0.16.0"),
            }
          : p,
      ),
    };
    return current.providers;
  },
  unlinkSourceControlCli: async (kind: SourceControlKind) => {
    await wait();
    current = {
      ...current,
      providers: current.providers.map((p) =>
        p.kind === kind ? { ...p, linked: undefined } : p,
      ),
    };
    return current.providers;
  },
  teaSetup: async () => {
    await wait(200);
    return current.tea;
  },
  connectWithTea: async () => {
    await wait(700);
    throw new Error("Sample: this preview doesn't sign in.");
  },
});

const client = new QueryClient();

function Preview() {
  const [name, setName] = useState(
    params.get("s") && scenarios[params.get("s")!]
      ? params.get("s")!
      : "All set",
  );
  const [view, setView] = useState<"settings" | "signin">(
    params.get("v") === "signin" ? "signin" : "settings",
  );
  const pick = (next: string) => {
    setName(next);
    current = scenarios[next];
    client.removeQueries();
  };
  return (
    <div style={{ padding: 16, display: "grid", gap: 10 }}>
      <div
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          zIndex: 10000,
          position: "relative",
        }}
      >
        <div className="segmented settings-segmented">
          {Object.keys(scenarios).map((key) => (
            <button
              key={key}
              className={name === key ? "active" : ""}
              onClick={() => pick(key)}
            >
              {key}
            </button>
          ))}
        </div>
        <div className="segmented settings-segmented">
          <button
            className={view === "settings" ? "active" : ""}
            onClick={() => setView("settings")}
          >
            Settings
          </button>
          <button
            className={view === "signin" ? "active" : ""}
            onClick={() => setView("signin")}
          >
            Sign-in
          </button>
        </div>
        <span className="setting-muted">Sample data</span>
      </div>
      {view === "settings" ? (
        <Settings
          key={name}
          account={null}
          initialCategory="integrations"
          onClose={() => {}}
          onConnect={() => setView("signin")}
          onDisconnect={async () => {}}
        />
      ) : (
        <Modal
          key={name}
          title="Gitea account"
          className="project-signin"
          onClose={() => setView("settings")}
        >
          <SignIn
            onConnected={async () => {}}
            loginRestore="idle"
            platform="darwin"
            onRestoreAction={async () => {}}
          />
        </Modal>
      )}
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
