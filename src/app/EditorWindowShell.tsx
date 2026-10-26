import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { EditorWindow } from "../../shared/editor-windows";
import { checkoutLabel } from "../../shared/working-tree";
import {
  NavigationLockProvider,
  useNavigationLockRoot,
} from "../lib/navigation-lock";
import { bootstrapQuery, projectsQuery } from "../lib/workspace-queries";
import { useEditorWindowShortcut } from "../features/editor-windows/EditorWindowButtons";
import {
  answerEditorReturn,
  bringBackEditor,
  editorOpens,
} from "../features/editor-windows/editor-windows";
import { ProjectFiles } from "../features/files/ProjectFiles";
import { FolderGoneEmpty } from "../features/projects/FolderGone";
import { WindowFlash } from "../features/thread-windows/WindowFlash";
import type { Viewing } from "../features/thread/useThreadView";
import { ErrorBox, Loading } from "../ui/ui";
import { EditorWindowTitlebar } from "./EditorWindowTitlebar";
import { useEditorFolder } from "./useEditorFolder";
import "./shell.css";
import "../features/editor-windows/editor-windows.css";

/**
 * A workspace's editor popped out of the main window: its file tree, tabs
 * and editor filling a window of its own, with the project and branch in
 * the title bar. Anything beyond editing stays in the main window.
 */
export default function EditorWindowShell({
  editor,
}: {
  editor: EditorWindow;
}) {
  const { where } = editor;
  const boot = useQuery(bootstrapQuery);
  const projects = useQuery({
    ...projectsQuery(boot.data?.account?.id),
    enabled: !!boot.data,
  });
  const project = projects.data?.find((p) => p.id === editor.projectId);
  const [error, setError] = useState<unknown>();
  const lock = useNavigationLockRoot((message) => setError(new Error(message)));
  const folder = useEditorFolder(project, where);
  const [viewing, setViewing] = useState<Viewing>();
  const name = project?.name;
  useEffect(() => {
    const file = viewing?.path?.split("/").pop();
    document.title = [file, name].filter(Boolean).join(" – ") || "Relay";
  }, [viewing?.path, name]);
  // Another window asks for the editor back: this one holds the unsaved edits.
  useEffect(() => {
    answerEditorReturn(setError);
  }, []);
  // A project that's been removed has no editor to keep.
  const projectRemoved = !!projects.data && !project;
  useEffect(() => {
    if (projectRemoved) void bringBackEditor(where).catch(setError);
  }, [projectRemoved, where]);
  useEditorWindowShortcut(editor.projectId, where, !!project, setError);
  const detail = useMemo(
    () => (folder.tree ? checkoutLabel(folder.tree) : undefined),
    [folder.tree],
  );
  if (boot.error) return <ErrorBox error={boot.error} />;
  if (!boot.data || !project) return <Loading text="Opening the editor…" />;
  return (
    <NavigationLockProvider value={lock}>
      <div className={`app project-app platform-${boot.data.platform}`}>
        <EditorWindowTitlebar
          projectName={project.name}
          detail={detail}
          where={where}
          onError={setError}
        />
        <div className="project-layout">
          <div className="editor-window-body">
            {folder.gone ? (
              <FolderGoneEmpty />
            ) : (
              <ProjectFiles
                active
                project={project}
                where={where}
                watched={folder.watched}
                checks={folder.checks}
                onViewing={setViewing}
                opens={editorOpens}
              />
            )}
          </div>
        </div>
        <WindowFlash />
        {!!error && (
          <div className="toast error">
            <ErrorBox error={error} />
            <button onClick={() => setError(undefined)}>Dismiss</button>
          </div>
        )}
      </div>
    </NavigationLockProvider>
  );
}
