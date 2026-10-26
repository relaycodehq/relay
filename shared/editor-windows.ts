import { z } from "zod";
import { boundsSchema } from "./thread-windows";
import { digestSchema } from "./validation";
import { parseWorkspaceId } from "./workspaces";

/**
 * A workspace's editor popped out of the main window into one of its own:
 * the project, and `where`, the checkout or thread worktree its Files show.
 */
export interface EditorWindow {
  projectId: string;
  where: string;
}

/** Which workspaces have their editor in a window of its own. */
export interface EditorWindowsState {
  open: EditorWindow[];
  /** The `where` whose window has focus; null while none does. */
  focused: string | null;
  /**
   * Workspaces with something held for a window to take (`takeEditorHandoff`):
   * buffers moving between windows, files to open. Whichever window it's
   * for takes it; the others get nothing.
   */
  waiting: string[];
}

export interface SavedEditorWindow extends EditorWindow {
  bounds: { x: number; y: number; width: number; height: number };
}

/** A file's unsaved text, on its way from one window's editor to another's. */
export interface UnsavedBuffer {
  /** Relative to the workspace; absolute when `outside` it. */
  path: string;
  outside?: true;
  /** Its folder has no Git, as the document was opened. */
  plain?: true;
  text: string;
  /** The file's version on disk the text was edited over; a save over any other is refused. */
  version?: string;
}

/** What a file's changes are shown against instead of its last commit, like the file before an agent's turn. */
export interface ChangeBaseline {
  /** Says what it is: "before turn", "main". */
  label: string;
  text: string;
}

/** A file or folder for the editor to open, as a link clicked in the chat names one. */
export interface EditorFileTarget {
  path: string;
  line?: number;
  endLine?: number;
  directory: boolean;
  outside?: boolean;
  /** Lists the files matching this instead of opening one. */
  search?: string;
  /** Shows the file's changes inline, against its last commit unless `baseline` says otherwise. */
  changes?: boolean;
  baseline?: ChangeBaseline;
}

/** What a window takes for a workspace: buffers to adopt, files to open. */
export interface EditorHandoff {
  buffers: UnsavedBuffer[];
  opens: EditorFileTarget[];
}

export const unsavedBuffersSchema = z
  .array(
    z.object({
      path: z.string().min(1).max(4096),
      outside: z.literal(true).optional(),
      plain: z.literal(true).optional(),
      text: z.string().max(64_000_000),
      version: digestSchema.optional(),
    }),
  )
  .max(500);

export const editorFileTargetSchema = z.object({
  path: z.string().min(1).max(4096),
  line: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  directory: z.boolean(),
  outside: z.boolean().optional(),
  search: z.string().max(4096).optional(),
  changes: z.boolean().optional(),
  baseline: z
    .object({ label: z.string().min(1).max(200), text: z.string().max(64_000_000) })
    .optional(),
});

const savedSchema = z.object({
  projectId: z.string().min(1),
  where: z.string().min(1),
  bounds: boundsSchema,
});

/** The saved windows that still read right; hand edits or old shapes drop out. */
export const savedEditorWindows = (saved: unknown): SavedEditorWindow[] =>
  Array.isArray(saved)
    ? saved.flatMap((w) => {
        const parsed = savedSchema.safeParse(w);
        return parsed.success ? [parsed.data] : [];
      })
    : [];

/** The query string a workspace's editor window loads Relay's page with. */
export const editorWindowSearch = (w: EditorWindow) =>
  new URLSearchParams({ editor: w.where, project: w.projectId }).toString();

/** The editor a page was loaded for, or null anywhere else. */
export function editorWindowOf(search: string): EditorWindow | null {
  const params = new URLSearchParams(search);
  const where = params.get("editor"),
    projectId = params.get("project");
  return where && projectId ? { projectId, where } : null;
}

/**
 * Whether a saved editor window still has its workspace to show: its project
 * isn't removed, and a thread's worktree still has the thread.
 */
export function editorWindowExists(
  { projectId, where }: EditorWindow,
  projects: readonly { id: string; removed?: unknown }[],
  chats: readonly { id: string }[],
) {
  const { chatId } = parseWorkspaceId(where);
  return (
    projects.some((p) => p.id === projectId && !p.removed) &&
    (!chatId || chats.some((c) => c.id === chatId))
  );
}

/** The calls and events behind editors in windows of their own. */
export interface EditorWindowsApi {
  /** Which workspaces have their editor popped out into a window of its own. */
  editorWindows(): Promise<EditorWindowsState>;
  onEditorWindows(callback: (state: EditorWindowsState) => void): () => void;
  /**
   * Pops a workspace's editor out into its own window, or brings its window
   * up. `buffers` are the calling window's unsaved text, which it lets go of.
   */
  openEditorWindow(
    projectId: string,
    where: string,
    buffers?: UnsavedBuffer[],
  ): Promise<void>;
  /** The editor window is asked to put its editor back; it hands over its edits first. */
  onEditorReturn(callback: (where: string) => void): () => void;
  /**
   * Puts a workspace's editor back in the window it came from. The editor
   * window calls it with its unsaved text; from any other window, with none
   * given, it asks the editor window to.
   */
  returnEditorWindow(where: string, buffers?: UnsavedBuffer[]): Promise<void>;
  /** Shows a file in the workspace's editor window; false when it has none. */
  openInEditorWindow(where: string, target: EditorFileTarget): Promise<boolean>;
  /** What the calling window should take for a workspace's editor, once; see `EditorWindowsState.waiting`. */
  takeEditorHandoff(where: string): Promise<EditorHandoff>;
}
