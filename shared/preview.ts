/**
 * A thread's preview: its own browser, keyed like its shell (the chat id, a
 * draft's `draft:<projectId>`), with cookies of its own.
 */

/** The project's dev server as the preview sees it. */
export type DevServerState =
  /** The project names no dev command. */
  | { state: "none" }
  /** Something already listens on the port; Relay didn't start it. */
  | { state: "running"; port: number; ours: false }
  | { state: "running"; port: number; ours: true }
  | { state: "starting"; port: number }
  /** It exited or never listened; `output` is the end of what it printed. */
  | { state: "failed"; port: number; output: string }
  /** Stopped after sitting unused; opening the preview wakes it. */
  | { state: "asleep"; port: number };

export interface PreviewState {
  key: string;
  url: string;
  title: string;
  /** The page icon as an image data URL, loaded in its browser session. */
  favicon?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Why the last load failed, until another one starts. */
  error?: string;
  /** Shown in a window of its own instead of the panel. */
  poppedOut: boolean;
  /** Waiting for the user to click an element on the page. */
  picking: boolean;
  server: DevServerState;
  /** The last frame before something covered it, as a JPEG data URL; the panel shows it meanwhile. */
  snapshot?: string;
  /** The worktree's name, when the thread has one. */
  worktree?: string;
}

export interface PreviewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type PreviewAction =
  | "back"
  | "forward"
  | "reload"
  | "stop"
  | "devtools"
  | "popOut"
  | "bringBack"
  | "openExternal"
  | "previewIndex"
  | "stopPicking";

/** An element the user picked on the page, to ask the agent about. */
export interface PickedElement {
  url: string;
  /** A CSS selector that matches only it, when one was found. */
  selector: string;
  /** Its opening tag, cut short. */
  tag: string;
  /** The start of its text. */
  text: string;
  /** It and a little around it, as a PNG data URL. */
  image: string;
}

/** Tells the window an agent opened a thread's preview. */
export interface PreviewReveal {
  projectId: string;
  chatId: string;
}

export interface ConsoleEntry {
  level: "error" | "warning";
  message: string;
  source?: string;
  at: number;
}

export interface PreviewApi {
  /**
   * The thread's preview, made on first open: it starts the project's dev
   * server in the thread's folder when nothing listens on its port yet.
   */
  openPreview(projectId: string, chatId: string | null): Promise<PreviewState>;
  /** Where the panel shows it, in the page's CSS pixels; null hides it. */
  placePreview(key: string, bounds: PreviewBounds | null): Promise<void>;
  navigatePreview(
    projectId: string,
    chatId: string | null,
    url: string,
  ): Promise<void>;
  previewAction(key: string, action: PreviewAction): Promise<void>;
  /** Waits for the user to click an element on the page; null when they don't. */
  pickPreviewElement(key: string): Promise<PickedElement | null>;
  /** Ends the preview: its tab was closed. Its cookies stay. */
  closePreview(key: string): Promise<void>;
  onPreview(callback: (state: PreviewState) => void): () => void;
  onPreviewReveal(callback: (reveal: PreviewReveal) => void): () => void;
}

/** What someone typed in the address bar, as a URL the preview may load; null when it can't. */
export function previewUrl(typed: string): string | null {
  const text = typed.trim();
  if (!text) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text)
    ? text
    : // Local names, IP addresses and bare hosts with a port mean a dev server.
      /^((localhost|([\w-]+\.)+localhost|\d{1,3}(\.\d{1,3}){3}|\[[\da-f:]+\])(:\d+)?|[\w.-]+:\d+)(\/|$)|^:\d/i.test(
          text,
        )
      ? `http://${text.replace(/^:/, "localhost:")}`
      : `https://${text}`;
  const url = URL.parse(withScheme);
  return url && (url.protocol === "http:" || url.protocol === "https:")
    ? url.href
    : null;
}
