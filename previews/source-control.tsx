// Settings → Integrations (Git, Source control, work items), and the Gitea
// sign-in's tea logins. Open http://127.0.0.1:5177/previews/source-control.html
import "./desktop-stub";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../src/styles.css";
import "../src/components/projects.css";
import { initAppearance } from "../src/lib/appearance";
import { Settings } from "../src/components/Settings";
import { SignIn } from "../src/components/SignIn";
import { Modal } from "../src/components/ui";
import {
  defaultDevOpsSettings,
  organizationLabel,
  type DevOpsSecrets,
  type DevOpsSettings,
  type DevOpsStatus,
} from "../shared/devops";
import type {
  SourceControlKind,
  SourceControlProvider,
  TeaSetup,
} from "../shared/source-control";
import type { GitInfo } from "../shared/working-tree";
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
  fix: "connect",
  account: undefined,
  server: undefined,
};
const azure: SourceControlProvider = {
  kind: "azure-devops",
  name: "Azure DevOps",
  cli: "az",
  enabled: false,
  path: "/opt/homebrew/bin/az",
  version: "2.86.0",
  signIn: "signed-out",
  fix: "set-up",
};
const git: GitInfo = {
  path: "/opt/homebrew/bin/git",
  chosen: false,
  version: "git version 2.47.1",
  error: null,
};
const tea: TeaSetup = { path: gitea.path, version: "0.16.0", logins: [] };
const connected: DevOpsSettings = {
  ...defaultDevOpsSettings,
  enabled: true,
  organization: "sample-org",
  project: "Software",
  hiddenProjects: ["p0"],
  filter: {
    ...defaultDevOpsSettings.filter,
    enabled: true,
    keywords: { p2: "WS, Web Store, cloud instances", p3: "AT, Atlas" },
  },
};

interface Scenario {
  providers: SourceControlProvider[];
  tea: TeaSetup;
  git: GitInfo;
  devops: DevOpsStatus;
}
const devops = (settings: DevOpsSettings, hasPat = false): DevOpsStatus => ({
  settings,
  hasPat,
  hasOpenRouterKey: false,
  persistent: true,
});

// Sample data, not this machine's tools or accounts.
const scenarios: Record<string, Scenario> = {
  "All set": {
    providers: [
      github,
      gitea,
      {
        ...azure,
        enabled: true,
        signIn: "signed-in",
        fix: undefined,
        account: "Sample Person",
        server: "sample-org",
      },
    ],
    tea,
    git,
    devops: devops(connected, true),
  },
  "Azure via az": {
    providers: [
      github,
      gitea,
      {
        ...azure,
        enabled: true,
        signIn: "signed-in",
        fix: undefined,
        account: "sample@example.com",
        server: "sample-org",
      },
    ],
    tea,
    git,
    devops: devops({ ...connected, auth: "azure-cli" }),
  },
  "Token rejected": {
    providers: [
      github,
      gitea,
      {
        ...azure,
        enabled: true,
        fix: "sign-in",
        server: "sample-org",
        detail:
          "Azure DevOps rejected the credentials. Check the token and its Work Items (Read) scope.",
      },
    ],
    tea,
    git,
    devops: devops(connected, true),
  },
  "Fresh install": {
    providers: [
      {
        ...github,
        path: undefined,
        version: undefined,
        signIn: "unknown",
        account: undefined,
        fix: "link",
        detail: "Install it with `brew install gh`.",
      },
      { ...giteaOut, path: undefined, version: undefined },
      { ...azure, path: undefined, version: undefined },
    ],
    tea: { logins: [] },
    git: {
      path: null,
      chosen: false,
      version: null,
      error: "Git was not found. Install it, or choose it in Settings.",
    },
    devops: devops(defaultDevOpsSettings),
  },
  "tea has logins": {
    providers: [
      github,
      { ...giteaOut, detail: "tea has a login for git.example.com." },
      azure,
    ],
    tea: {
      ...tea,
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
    git,
    devops: devops(defaultDevOpsSettings),
  },
};

// Also settable from the URL (?s=All%20set&v=signin), since the dialogs are modal.
const params = new URLSearchParams(location.search);
let current = scenarios[params.get("s") ?? ""] ?? scenarios["All set"];
const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const put = (kind: SourceControlKind, change: Partial<SourceControlProvider>) =>
  (current = {
    ...current,
    providers: current.providers.map((p) =>
      p.kind === kind ? { ...p, ...change } : p,
    ),
  }).providers;
const cliNames = { github: "gh", gitea: "tea", "azure-devops": "az" } as const;

Object.assign(window.relay as Partial<Api>, {
  updateState: async () => ({ status: "off", current: "preview" }),
  projects: async () =>
    ["Flowise", "Onboarding", "Web Store", "Atlas"].map((name, i) => ({
      id: `p${i}`,
      name,
      path: `/home/sample/${name.toLowerCase().replace(" ", "-")}`,
      repository: null,
      added: i,
    })),
  sourceControl: async () => {
    await wait();
    return current.providers;
  },
  setSourceControlEnabled: async (
    kind: SourceControlKind,
    enabled: boolean,
  ) => {
    if (kind === "azure-devops")
      current.devops = devops(
        { ...current.devops.settings, enabled },
        current.devops.hasPat,
      );
    return put(kind, { enabled });
  },
  // The file dialog is the desktop's; the sample picks a mise install. A
  // typed path is accepted when it ends in the CLI's name, like the real check.
  linkSourceControlCli: async (kind: SourceControlKind, typed?: string) => {
    await wait();
    const cli = cliNames[kind];
    const path =
      typed ??
      `/home/sample/.local/share/mise/installs/${cli}/latest/bin/${cli}`;
    if (!path.endsWith(`/${cli}`))
      throw new Error(
        `That doesn't look like ${cli}: it didn't say which version it is.`,
      );
    return put(kind, { linked: true, path, version: "2.101.0" });
  },
  unlinkSourceControlCli: async (kind: SourceControlKind) => {
    await wait();
    return put(kind, { linked: undefined });
  },
  teaSetup: async () => {
    await wait(200);
    return current.tea;
  },
  connectWithTea: async () => {
    await wait(700);
    throw new Error("Sample: this preview doesn't sign in.");
  },
  gitInfo: async () => current.git,
  chooseGit: async (typed?: string) => {
    await wait();
    if (typed && !typed.endsWith("/git"))
      throw new Error("That program didn’t run as Git.");
    current.git = {
      path: typed ?? "/usr/local/bin/git",
      chosen: true,
      version: "git version 2.47.1",
      error: null,
    };
    return current.git;
  },
  resetGit: async () => (current.git = git),
  devopsStatus: async () => current.devops,
  saveDevOpsSettings: async (
    settings: DevOpsSettings,
    secrets: DevOpsSecrets,
  ) => {
    await wait();
    const hasPat =
      secrets.pat === null ? false : !!secrets.pat || current.devops.hasPat;
    current.devops = devops(settings, hasPat);
    put("azure-devops", {
      enabled: settings.enabled,
      server: settings.organization
        ? organizationLabel(settings.organization)
        : undefined,
      ...(settings.organization && (hasPat || settings.auth === "azure-cli")
        ? {
            signIn: "signed-in",
            fix: undefined,
            detail: undefined,
            account: "Sample Person",
          }
        : { signIn: "signed-out", fix: "sign-in", account: undefined }),
    });
    return current.devops;
  },
  devopsWorkItems: async () => ({
    items: [{}, {}, {}],
    relevance: null,
    threshold: 0.5,
  }),
});

const client = new QueryClient();

function Preview() {
  const [view, setView] = useState<"settings" | "signin">(
    params.get("v") === "signin" ? "signin" : "settings",
  );
  return view === "settings" ? (
    <Settings
      account={null}
      initialCategory="integrations"
      onClose={() => {}}
      onConnect={() => setView("signin")}
      onDisconnect={async () => {}}
    />
  ) : (
    <Modal
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
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <p className="setting-muted" style={{ padding: 12 }}>
        Sample data · scenarios: {Object.keys(scenarios).join(", ")} (?s=…)
      </p>
      <Preview />
    </QueryClientProvider>
  </StrictMode>,
);
