import { z } from "zod";

/** A thread popped out of the main window into one of its own. */
export interface ThreadWindow {
  projectId: string;
  chatId: string;
}

/** Which threads have their own window, and which of those is in front. */
export interface ThreadWindowsState {
  open: ThreadWindow[];
  /** The thread whose window has focus; null while none of them does. */
  focused: string | null;
}

/** Where a popped thread's window was, so a restart opens it there again. */
export interface SavedThreadWindow extends ThreadWindow {
  bounds: { x: number; y: number; width: number; height: number };
}

const savedSchema = z.object({
  projectId: z.string().min(1),
  chatId: z.string().min(1),
  bounds: z.object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().min(100).max(20_000),
    height: z.number().int().min(100).max(20_000),
  }),
});

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
