// Linked folders, built: the thread's control and /add-dir run on the real
// hook and components, project settings on the real entries. The bridge
// is stubbed with sample folders. Sample data throughout.
// Open http://127.0.0.1:5177/previews/linked-folders/ (?view=settings)
import "../_shared/desktop-stub";
import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { ChevronDown, Folder, GitBranch } from "lucide-react";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../_shared/chrome.css";
import "../../src/features/settings/settings.css";
import "../../src/features/agents/composer-model-picker.css";
import "../../src/features/changes/worktrees.css";
import { initAppearance } from "../../src/lib/appearance";
import { SettingsNav } from "../../src/features/settings/sections/SettingsNav";
import { Setting } from "../../src/features/settings/sections/Setting";
import { projectEntries } from "../../src/features/settings/sections/projects";
import { useSettingsProject } from "../../src/features/projects/ProjectSettings";
import { sections } from "../../src/features/settings/settings-search";
import { Message } from "../../src/features/thread/ProjectMessage";
import { ProjectComposer } from "../../src/features/composer/ProjectComposer";
import { LinksControl } from "../../src/features/linked-folders/LinksControl";
import { useThreadLinks } from "../../src/features/linked-folders/useThreadLinks";
import { ErrorBox } from "../../src/ui/ui";
import { threadDraftKey } from "../../src/lib/thread-storage";
import { AppFrame, stubSidebar } from "../_shared/app-frame";
import type { Api } from "../../shared/types";
import type { ChatSummary, LinkedFolder } from "../../shared/projects";
import { chats, disk, home, messages, projects } from "./linked-folders-data";

initAppearance();
stubSidebar(chats);

const expand = (path: string) =>
  (path.startsWith("~") ? home + path.slice(1) : path).replace(/(.)\/+$/, "$1");
const repos = new Set(
  disk[`${home}/work`].map((name) => `${home}/work/${name}`),
);
projects[0].settings = {
  links: [
    {
      path: `${home}/work/acme-shared`,
      note: "TypeScript types and zod schemas both apps import",
      access: "write",
    },
  ],
};
Object.assign(window.relay, {
  projects: async () => projects,
  saveProjectSettings: async (id: string, settings: object) => {
    const project = projects.find((p) => p.id === id)!;
    project.settings = settings;
    return { ...project };
  },
  addProjectLinks: async (id: string, links: LinkedFolder[]) => {
    const project = projects.find((p) => p.id === id)!;
    const kept = project.settings?.links ?? [];
    project.settings = {
      ...project.settings,
      links: [
        ...kept,
        ...links.filter((l) => !kept.some((k) => k.path === l.path)),
      ],
    };
    return { ...project };
  },
  promoteProjectChatLink: async (id: string, path: string) => {
    const chat = chats.find((c) => c.id === id)!;
    const project = projects.find((p) => p.id === chat.projectId)!;
    const moving = chat.links!.find((l) => l.path === path)!;
    project.settings = {
      ...project.settings,
      links: [
        ...(project.settings?.links ?? []).filter((l) => l.path !== path),
        moving,
      ],
    };
    chat.links = chat.links!.filter((l) => l.path !== path);
    return { project: { ...project }, chat: { ...chat } };
  },
  revealProject: async () => {},
  // What the real composer asks on its way up.
  dictationState: async () => ({ status: "missing" }),
  onDictationState: () => () => {},
  agentAccounts: async () => ({
    accounts: [],
    inUse: { claude: "", codex: "" },
    signingIn: null,
    signInError: null,
  }),
  onAgentAccounts: () => () => {},
  projectCommands: async () => [],
  inspectFolder: async (path: string) => {
    const real = expand(path);
    if (repos.has(real)) return { path: real, kind: "repository" };
    if (disk[real]) return { path: real, kind: "plain" };
    return { path: real, kind: "missing" };
  },
  listFolders: async (dir: string) =>
    (disk[expand(dir)] ?? []).map((name) => ({
      name,
      path: `${expand(dir)}/${name}`,
      repository: repos.has(`${expand(dir)}/${name}`),
    })),
  linkSuggestions: async () => [
    ...["acme-api", "acme-docs", "acme-infra"].map((name) => ({
      path: `${home}/work/${name}`,
      project: name === "acme-api" ? "Acme API" : undefined,
      repository: true,
      beside: true,
    })),
    {
      path: `${home}/work/acme-mobile`,
      project: "Acme Mobile",
      repository: true,
      beside: false,
    },
  ],
  chooseFolder: async () => `${home}/work/acme-design-tokens`,
  setProjectChatLinks: async (id: string, links: LinkedFolder[]) => {
    const chat = chats.find((c) => c.id === id)!;
    chat.links = links.length ? links : undefined;
    return { ...chat };
  },
} satisfies Partial<Record<keyof Api, unknown>>);

type View = "thread" | "settings";

function ThreadView({ onSettings }: { onSettings: () => void }) {
  const list = useQuery({
    queryKey: ["project-chats", "acme-web"],
    queryFn: async () => chats.filter((c) => c.projectId === "acme-web"),
  });
  const project = useQuery({
    queryKey: ["projects", "you"],
    queryFn: async () => projects.map((p) => ({ ...p })),
  }).data?.[0];
  const chat = list.data?.[0];
  if (!project || !chat) return null;
  return <Thread project={project} chat={chat} onSettings={onSettings} />;
}

function Thread({
  project,
  chat,
  onSettings,
}: {
  project: (typeof projects)[number];
  chat: ChatSummary;
  onSettings: () => void;
}) {
  const [error, setError] = useState<unknown>();
  const links = useThreadLinks({
    project,
    chat,
    draftId: "draft",
    onError: setError,
  });
  return (
    <section className="project-chat" aria-label="Thread">
      <div className="project-messages">
        <div className="thread-message-column">
          {messages.map((m) => (
            <Message
              key={m.id}
              message={m}
              chatId=""
              onReply={() => {}}
              onFork={() => {}}
              onChanges={() => {}}
              onTurnDiff={() => {}}
              onRewind={async () => ({ conflicts: [] })}
              projectRoot={project.path}
              onOpenFile={() => {}}
            />
          ))}
        </div>
      </div>
      <div className="thread-bottom-composer">
        {!!error && <ErrorBox error={error} />}
        <ProjectComposer
          projectId={project.id}
          keys={{ draft: threadDraftKey(chat.id), settings: "preview-linked" }}
          conversation={{ running: false, busy: false }}
          context={
            <>
              <span className="composer-branch-trigger workspace-trigger static">
                <Folder size={13} />
                <span>Project folder</span>
              </span>
              <button type="button" className="composer-branch-trigger">
                <GitBranch size={13} />
                <span>main</span>
                <ChevronDown size={12} />
              </button>
              <LinksControl links={links} onProjectSettings={onSettings} />
            </>
          }
          onSend={async () => false}
          onStop={() => {}}
          onCommand={(command, args) => {
            setError(undefined);
            return links.command(command, args) ?? false;
          }}
          commandOptions={links.options}
        />
      </div>
    </section>
  );
}

function SettingsView({ onClose }: { onClose: () => void }) {
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const project = useSettingsProject("you", "acme-web");
  const entries = projectEntries(project);
  return (
    <section className="settings-screen" aria-labelledby="settings-heading">
      <SettingsNav
        headingId="settings-heading"
        inputRef={search}
        query={query}
        setQuery={setQuery}
        category="project"
        projectId="acme-web"
        results={null}
        showResults={false}
        onShowResults={() => {}}
        onPick={() => {}}
        onClose={onClose}
      />
      <main className="settings-pane">
        <header>
          <h3>{project?.name} settings</h3>
          <p>What this project does its own way.</p>
        </header>
        <div className="settings-content">
          {sections(entries).map(({ section, list }, i) => (
            <div key={section ?? i} className="settings-group">
              {section && <h5>{section}</h5>}
              {list.map((e) => (
                <Setting key={e.id} entry={e} query="" />
              ))}
            </div>
          ))}
        </div>
      </main>
    </section>
  );
}

function Preview() {
  const [view, setView] = useState<View>(
    new URLSearchParams(location.search).get("view") === "settings"
      ? "settings"
      : "thread",
  );
  const show = (v: View) => {
    setView(v);
    history.replaceState(null, "", v === "thread" ? "?" : `?view=${v}`);
  };
  return (
    <div className="preview-app">
      <div className="preview-bar">
        <strong>Linked folders</strong>
        <span>Sample data. Try /add-dir in the composer.</span>
        <span className="preview-control">
          Where
          <span className="preview-segmented" role="radiogroup">
            {(
              [
                ["thread", "In a thread"],
                ["settings", "Project settings"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                role="radio"
                aria-checked={view === v}
                onClick={() => show(v)}
              >
                {label}
              </button>
            ))}
          </span>
        </span>
      </div>
      <AppFrame
        title={
          view === "settings" ? (
            <span>Settings</span>
          ) : (
            <>
              <span>Acme Web</span>
              <span className="muted"> / </span>
              <strong>{chats[0].title}</strong>
            </>
          )
        }
        projects={projects}
        showing={{ projectId: "acme-web", chatId: chats[0].id }}
        sidebar={view === "thread"}
      >
        {view === "thread" ? (
          <ThreadView onSettings={() => show("settings")} />
        ) : (
          <SettingsView onClose={() => show("thread")} />
        )}
      </AppFrame>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <Preview />
    </QueryClientProvider>
  </StrictMode>,
);
