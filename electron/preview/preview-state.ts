import type { BrowserWindow, NavigationEntry, WebContentsView } from "electron";
import type {
  ConsoleEntry,
  DevServerState,
  PreviewState,
} from "../../shared/preview";
import { localPort } from "./local-urls";
import type { SavedPreview } from "./saved-previews";

/** Where a thread's preview runs and what it loads. */
export interface PreviewTarget {
  /** The page's own key; see `pageKey`. */
  key: string;
  projectId: string;
  chatId: string | null;
  /** The thread's folder: its worktree, or the project's checkout. */
  folder: string;
  project: string;
  branch?: string;
  /** Its worktree's name; unset in the checkout. */
  worktree?: string;
  /** The checkout's browser, used to seed a thread on its first open. */
  checkoutPartition: string;
  /** Every thread owns a partition, seeded from the checkout's. */
  partition: string;
  env: Record<string, string>;
  url?: string;
  settings?: SavedPreview["settings"];
  /** The project's dev command and port, the port already moved by the worktree's offset. */
  dev?: { command?: string; port: number };
}

export interface Preview {
  target: PreviewTarget;
  /** An explicit endpoint survives reopening the Browser tab. */
  selectedUrl?: string;
  /** A requested page waits for its server before it loads. */
  pendingUrl?: string;
  /** Unset while unloaded; `parked` holds where it was. */
  view?: WebContentsView;
  parked?: { entries: NavigationEntry[]; index: number };
  /** A parked history is loading back in; the dev server's home must not replace it. */
  restoring?: boolean;
  shown: boolean;
  /** Its view was in a window once, so it can be captured off screen. */
  drawn?: boolean;
  /** Ends an element pick under way. */
  stopPick?: () => void;
  /** When it last left the panel. */
  hiddenAt: number;
  /** Captures under way; the idle sweep mustn't close the page under them. */
  capturing: number;
  /** The Relay window it's laid over while shown: the main one, or its thread's own. */
  host?: BrowserWindow;
  popOut?: BrowserWindow;
  error?: string;
  server: DevServerState;
  console: ConsoleEntry[];
  snapshot?: string;
  favicon?: string;
  faviconRequest?: object;
  /** Counts place calls, so a hide still capturing knows it was overtaken. */
  placed: number;
}

/** Where the page is, live or parked. */
export function pageOf(preview: Preview) {
  const wc = preview.view?.webContents;
  if (wc && !wc.isDestroyed())
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    };
  const { entries = [], index = 0 } = preview.parked ?? {};
  return {
    url: entries[index]?.url ?? "",
    title: entries[index]?.title ?? "",
    loading: false,
    canGoBack: index > 0,
    canGoForward: index < entries.length - 1,
  };
}

/** What the panel shows of the preview. */
export function previewState(preview: Preview): PreviewState {
  const page = pageOf(preview);
  page.url = preview.pendingUrl || page.url || preview.selectedUrl || "";
  const server = preview.server;
  const dependsOnServer =
    !page.url || ("port" in server && localPort(page.url) === server.port);
  return {
    key: preview.target.key,
    ...page,
    ...(preview.favicon ? { favicon: preview.favicon } : {}),
    ...(preview.error ? { error: preview.error } : {}),
    ...(preview.snapshot ? { snapshot: preview.snapshot } : {}),
    poppedOut: !!preview.popOut,
    picking: !!preview.stopPick,
    server: dependsOnServer ? server : { state: "none" },
    ...(preview.target.worktree ? { worktree: preview.target.worktree } : {}),
  };
}
