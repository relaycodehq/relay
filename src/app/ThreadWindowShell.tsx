import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RelayCommand } from "../../shared/commands";
import type { Project } from "../../shared/projects";
import type { ThreadWindow } from "../../shared/thread-windows";
import { api } from "../lib/api";
import {
  NavigationLockProvider,
  useNavigationLockRoot,
} from "../lib/navigation-lock";
import { useThreadView } from "../features/thread/useThreadView";
import type { GitActionsHandle } from "../features/changes/GitActions";
import type { ComposerControls } from "../features/composer/ProjectComposer";
import { useEveryThread } from "../features/sidebar/useSidebarThreads";
import { useUnread } from "../features/sidebar/useUnread";
import { BackButton } from "../features/thread-windows/ThreadWindowButtons";
import { ErrorBox, Loading } from "../ui/ui";
import { fitHeader } from "./header-fit";
import { ProjectTitle } from "./ShellTitlebar";
import { useShellNavigation } from "./useShellNavigation";
import {
  ThreadHeaderActions,
  ThreadWorkspace,
  useThreadTools,
} from "./ThreadWorkspace";
import "./shell.css";

const NO_PROJECTS: Project[] = [];

/**
 * A thread popped out of the main window: its header and panes, without the
 * sidebar. Anything that would leave the thread opens in the main window.
 */
export default function ThreadWindowShell({
  thread,
}: {
  thread: ThreadWindow;
}) {
  const boot = useQuery({
    queryKey: ["bootstrap"],
    queryFn: () => api.bootstrap(),
    staleTime: Infinity,
  });
  const projects = useQuery({
    queryKey: ["projects", boot.data?.account?.id],
    queryFn: () => api.projects(),
    enabled: !!boot.data,
  });
  const gitActions = useRef<GitActionsHandle>(null);
  const composer = useRef<ComposerControls>(null);
  const [error, setError] = useState<unknown>();
  const lock = useNavigationLockRoot((message) => setError(new Error(message)));
  const view = useThreadView();
  const nav = useShellNavigation(projects.data, lock, view, thread);
  const { project, chat } = nav;
  const tools = useThreadTools(nav, view, lock, boot.data?.account, setError);
  const realProjects = projects.data?.filter((p) => !p.scratch) ?? [];
  const everyThread = useEveryThread(realProjects);
  // Read while this window is in front, its "New" divider and all.
  useUnread(chat?.id, nav.chats.data ?? []);
  useEffect(() => {
    document.title = chat?.title ?? "Relay";
  }, [chat?.title]);
  // A thread that's gone, archived away or its project removed, goes back.
  const gone = !!nav.chats.data && !chat;
  useEffect(() => {
    if (gone) void api.returnThreadWindow(thread.chatId).catch(setError);
  }, [gone]);
  /** Everything else the main window does, in the main window. */
  const toMain = () =>
    void api.openInMainWindow(thread.projectId).catch(setError);
  function runCommand(command: RelayCommand) {
    if (lock.blocked()) return false;
    if (command === "openpr") gitActions.current?.openPr();
    else if (command === "files" || command === "changes")
      tools.opens.openCode(command);
    else return false;
    return true;
  }
  if (boot.error) return <ErrorBox error={boot.error} />;
  if (!boot.data || !project || !chat)
    return <Loading text="Opening the thread…" />;
  const page = (
    <div className={`app project-app platform-${boot.data.platform}`}>
      <header className="titlebar project-titlebar sidebar-collapsed">
        <div className="project-titlebar-brand">
          <span className="traffic-space" />
        </div>
        <div className="project-titlebar-main" ref={fitHeader}>
          <ProjectTitle project={project} chat={chat} onError={setError} />
          <span className="spacer" />
          <ThreadHeaderActions
            tools={tools}
            project={project}
            gitActions={gitActions}
            move={<BackButton chatId={chat.id} />}
            onConnectHost={toMain}
            onSettings={toMain}
          />
        </div>
      </header>
      <div className="project-layout">
        <ThreadWorkspace
          tools={tools}
          project={project}
          projects={realProjects}
          allProjects={projects.data ?? NO_PROJECTS}
          everyThread={everyThread}
          composer={composer}
          onCommand={runCommand}
          onStartThread={async () => toMain()}
          onCreated={async () => {}}
          onOpened={async (c) => {
            await api.openInMainWindow(c.projectId, c.id).catch(setError);
          }}
          onAddProject={toMain}
          onSettings={toMain}
        />
      </div>
      {!!error && (
        <div className="toast error">
          <ErrorBox error={error} />
          <button onClick={() => setError(undefined)}>Dismiss</button>
        </div>
      )}
    </div>
  );
  return <NavigationLockProvider value={lock}>{page}</NavigationLockProvider>;
}
