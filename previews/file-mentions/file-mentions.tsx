// @ file mentions on the real composer: the menu, its keys and the pill it
// leaves are the feature's own code. The project is sample data (Relay's own
// source stands in for its files).
// Open http://127.0.0.1:5177/previews/file-mentions/
import "../_shared/desktop-stub";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChevronDown, Folder, GitBranch } from "lucide-react";
import "../../src/styles.css";
import "../_shared/app-styles";
import "../_shared/chrome.css";
import "../../src/features/agents/composer-model-picker.css";
import { initAppearance } from "../../src/lib/appearance";
import { Message } from "../../src/features/thread/ProjectMessage";
import { ProjectComposer } from "../../src/features/composer/ProjectComposer";
import { threadDraftKey } from "../../src/lib/thread-storage";
import { AppFrame, stubSidebar } from "../_shared/app-frame";
import type { Api } from "../../shared/types";
import {
  chats,
  files,
  messages,
  projects,
  readSample,
  workingTree,
} from "./file-mentions-data";

initAppearance();
stubSidebar(chats);
Object.assign(window.relay, {
  projects: async () => projects,
  projectFiles: async () => files,
  projectFile: async (_where: string, path: string) => {
    const contents = await readSample(path);
    return {
      path,
      contents,
      original: contents,
      version: "",
      head: "",
      branch: "main",
    };
  },
  projectWorkingTree: async () => workingTree,
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
} satisfies Partial<Record<keyof Api, unknown>>);

function Thread() {
  const chat = chats[0];
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
              projectRoot={projects[0].path}
              onOpenFile={() => {}}
            />
          ))}
        </div>
      </div>
      <div className="thread-bottom-composer">
        <ProjectComposer
          projectId="relay"
          keys={{
            draft: threadDraftKey(chat.id),
            settings: "preview-mentions",
          }}
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
            </>
          }
          onSend={async () => false}
          onStop={() => {}}
          onCommand={() => false}
        />
      </div>
    </section>
  );
}

function Preview() {
  return (
    <div className="preview-app">
      <div className="preview-bar">
        <strong>@ file mentions</strong>
        <span>Sample data. Type @ in the composer, then a few letters.</span>
      </div>
      <AppFrame
        title={
          <>
            <span>Relay</span>
            <span className="muted"> / </span>
            <strong>{chats[0].title}</strong>
          </>
        }
        projects={projects}
        showing={{ projectId: "relay", chatId: chats[0].id }}
      >
        <Thread />
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
