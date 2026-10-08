// The app's window around a preview's main pane: the titlebar and the real
// sidebar on sample projects and threads. Mount it inside a QueryClientProvider.
import type { ReactNode } from "react";
import { ProjectSidebar } from "../../src/features/sidebar/ProjectSidebar";
import type { Api } from "../../shared/types";
import type { ChatSummary, Project } from "../../shared/projects";

/** Answers the sidebar's own questions from `chats`. */
export function stubSidebar(chats: ChatSummary[]) {
  Object.assign(window.relay, {
    projectChats: async (id: string) => chats.filter((c) => c.projectId === id),
    scratchChats: async () => [],
    projectGroups: async () => [],
    updateState: async () => ({ status: "off", current: "0.9.1" }),
    onUpdate: () => () => {},
    agentVersions: async () => ({ agents: [], checking: false }),
    onAgentVersions: () => () => {},
    onProjectChat: () => () => {},
    triageProjectChat: async () => {},
    devBuildState: async () => [],
  } satisfies Partial<Record<keyof Api, unknown>>);
}

export function AppFrame({
  title,
  projects,
  showing,
  sidebar = true,
  onAdd = () => {},
  children,
}: {
  /** What the titlebar names, e.g. the thread or "Settings". */
  title: ReactNode;
  projects: Project[];
  showing?: { projectId?: string; chatId?: string };
  /** Settings hides the sidebar, as in the app. */
  sidebar?: boolean;
  onAdd?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="app project-app" style={{ flex: 1, minHeight: 0 }}>
      <header className="titlebar project-titlebar" style={{ paddingLeft: 84 }}>
        <div className="project-titlebar-main">
          <div className="project-window-title">{title}</div>
        </div>
      </header>
      <div className="project-layout">
        {sidebar && (
          <aside className="projects-sidebar" aria-label="Projects">
            <ProjectSidebar
              initialView="threads"
              projects={projects}
              showing={showing ?? {}}
              account="you"
              onOpen={() => {}}
              onPickNew={() => {}}
              onNewScratch={() => {}}
              onSendDraft={() => {}}
              onAdd={onAdd}
              onSettings={() => {}}
              onAccount={() => {}}
              onInbox={() => {}}
            />
          </aside>
        )}
        {children}
      </div>
    </div>
  );
}
