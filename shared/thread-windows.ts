import { z } from "zod";

/** A thread popped out of the main window into one of its own. */
export interface ThreadWindow {
  projectId: string;
  chatId: string;
}

/**
 * What a thread's window asks the main window to do, as its own commands
 * would there: "meme" sets memes up in a new Scratchpad thread, "jump-N"
 * opens Activity's Nth thread as `jump-thread` does. `SettingsCommand`
 * opens Settings there.
 */
export const mainWindowCommands = [
  "meme",
  "jump-1",
  "jump-2",
  "jump-3",
  "jump-4",
  "jump-5",
  "jump-6",
  "jump-7",
  "jump-8",
  "jump-9",
] as const;

/** Settings at `settings`, a category of the page, as `openSettings` takes it. */
export interface SettingsCommand {
  settings: string;
  projectId?: string;
  entryId?: string;
}

export type MainWindowCommand =
  | (typeof mainWindowCommands)[number]
  | SettingsCommand;

type JumpCommand = Extract<MainWindowCommand, `jump-${string}`>;

/** The command opening Activity's `digit`th (1–9) thread in the main window. */
export const jumpCommand = (digit: number) => `jump-${digit}` as JumpCommand;

/** The 1–9 a "jump-N" command carries. */
export const jumpDigitOf = (command: JumpCommand) => Number(command.slice(5));

/** Which threads have their own window, and which of those is in front. */
export interface ThreadWindowsState {
  open: ThreadWindow[];
  /** The thread whose window has focus; null while none of them does. */
  focused: string | null;
}

/** The calls and events behind threads in windows of their own, and the main window they go back to. */
export interface ThreadWindowsApi {
  /** Which threads have windows of their own. */
  threadWindows(): Promise<ThreadWindowsState>;
  onThreadWindows(callback: (state: ThreadWindowsState) => void): () => void;
  /** Pops a thread out into its own window, or brings its window up. */
  openThreadWindow(projectId: string, chatId: string): Promise<void>;
  /** Closes a thread's window and shows the thread in the main window. */
  returnThreadWindow(chatId: string): Promise<void>;
  /** Shows the main window, on this thread unless it has a window of its own. */
  openInMainWindow(projectId: string, chatId?: string): Promise<void>;
  /** The thread the main window was opened to show, once. */
  takeOpenThread(): Promise<ThreadWindow | null>;
  /** Shows the main window and runs `command` there, as typed in it. */
  runInMainWindow(command: MainWindowCommand): Promise<void>;
  /** The command the main window was opened to run, once. */
  takeMainWindowCommand(): Promise<MainWindowCommand | null>;
  /** A command a thread's window asks the main window to run. */
  onMainWindowCommand(
    callback: (command: MainWindowCommand) => void,
  ): () => void;
  /** This thread's own window was brought up from elsewhere. */
  onFlashWindow(callback: () => void): () => void;
  /** A thread to show in the main window, sent as its own window closes. */
  onOpenThread(callback: (thread: ThreadWindow) => void): () => void;
  /** A thread that moved to another project, for a window showing it to follow. */
  onThreadMoved(callback: (thread: ThreadWindow) => void): () => void;
}

/** Where a popped thread's window was, so a restart opens it there again. */
export interface SavedThreadWindow extends ThreadWindow {
  bounds: { x: number; y: number; width: number; height: number };
}

export const boundsSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(100).max(20_000),
  height: z.number().int().min(100).max(20_000),
});

const savedSchema = z.object({
  projectId: z.string().min(1),
  chatId: z.string().min(1),
  bounds: boundsSchema,
});

/** Where the main window was and how, so the next launch opens it the same. */
export interface SavedMainWindow {
  /** Its unmaximized, windowed size, which un-maximizing goes back to. */
  bounds: SavedThreadWindow["bounds"];
  maximized: boolean;
  fullScreen: boolean;
}

const savedMainSchema = z.object({
  bounds: boundsSchema,
  maximized: z.boolean(),
  fullScreen: z.boolean(),
});

/** The saved main window if it still reads right, else null. */
export const savedMainWindow = (saved: unknown): SavedMainWindow | null => {
  const parsed = savedMainSchema.safeParse(saved);
  return parsed.success ? parsed.data : null;
};

/** The saved windows that still read right; hand edits or old shapes drop out. */
export const savedThreadWindows = (saved: unknown): SavedThreadWindow[] =>
  Array.isArray(saved)
    ? saved.flatMap((w) => {
        const parsed = savedSchema.safeParse(w);
        return parsed.success ? [parsed.data] : [];
      })
    : [];

/** The query string a thread's window loads Relay's page with. */
export const threadWindowSearch = (w: ThreadWindow) =>
  new URLSearchParams({ thread: w.chatId, project: w.projectId }).toString();

/** The thread a page was loaded for, or null in the main window. */
export function threadWindowOf(search: string): ThreadWindow | null {
  const params = new URLSearchParams(search);
  const chatId = params.get("thread"),
    projectId = params.get("project");
  return chatId && projectId ? { projectId, chatId } : null;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a saved window opens: where it was if enough of it lands on a
 * display that's still there, else the size it had centred on `fallback`.
 */
export function placeOnScreen(saved: Rect, displays: Rect[], fallback: Rect) {
  const visible = (d: Rect) =>
    Math.max(
      0,
      Math.min(saved.x + saved.width, d.x + d.width) - Math.max(saved.x, d.x),
    ) *
    Math.max(
      0,
      Math.min(saved.y + saved.height, d.y + d.height) - Math.max(saved.y, d.y),
    );
  // Its title bar has to be reachable, so a sliver at an edge doesn't count.
  const enough = Math.min((saved.width * saved.height) / 4, 200 * 100);
  if (displays.some((d) => visible(d) >= enough)) return saved;
  const width = Math.min(saved.width, fallback.width),
    height = Math.min(saved.height, fallback.height);
  return {
    x: Math.round(fallback.x + (fallback.width - width) / 2),
    y: Math.round(fallback.y + (fallback.height - height) / 2),
    width,
    height,
  };
}
