// What Relay's preview tools do for an agent: open its thread's preview,
// picture it, and read what its page logged. The tools are listed with the
// others in electron/relay-mcp.
import type { ConsoleEntry, DevServerState, PreviewState } from "../../shared/preview";
import { toolText, type ToolResult } from "../relay-mcp/tools";
import type { ThreadPreviews } from "./thread-previews";

/** How long open_preview waits for the dev server and the page. */
const OPEN_WAIT_MS = 3 * 60_000;
const SHOT_WAIT_MS = 15_000;
/** Screenshots wider than this are scaled down; text stays legible. */
const SHOT_WIDTH = 1600;
const LISTED_ENTRIES = 50;
const ENTRY_CHARS = 2000;

export type PreviewToolName = "open_preview" | "screenshot" | "console_errors";
export const previewToolNames = new Set<string>([
  "open_preview",
  "screenshot",
  "console_errors",
] satisfies PreviewToolName[]);

/** The thread calling, as the previews key it. */
interface Caller {
  projectId: string;
  chatId: string;
}

const NO_PAGE =
  "This thread's preview shows no page yet. Call open_preview first.";

export function serverLine(server: DevServerState): string {
  switch (server.state) {
    case "none":
      return "no dev command set";
    case "running":
      return `running on port ${server.port}${server.ours ? ", started by Relay" : ""}`;
    case "starting":
      return `still starting on port ${server.port}`;
    case "failed":
      return `failed on port ${server.port}`;
    case "asleep":
      return `asleep on port ${server.port}`;
  }
}

/** `typed` as an address to load: a full http(s) URL, or a path on the page's (or dev server's) origin. */
export function previewTarget(typed: string, base: string | undefined) {
  const url = URL.parse(typed) ?? (base ? URL.parse(typed, base) : null);
  if (!url)
    throw new Error(
      `"${typed}" is no address. Give a full http(s) URL, or a path once the preview shows a page.`,
    );
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("The preview only loads http and https addresses.");
  return url.href;
}

export function ago(at: number, now: number) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  return `${Math.round(s / 3600)} h ago`;
}

export function consoleText(entries: ConsoleEntry[], now: number) {
  const shown = entries.slice(-LISTED_ENTRIES);
  const lines = shown.map((e) => {
    const message =
      e.message.length > ENTRY_CHARS
        ? `${e.message.slice(0, ENTRY_CHARS)}…`
        : e.message;
    return `[${e.level}] ${ago(e.at, now)}${e.source ? ` at ${e.source}` : ""}\n${message}`;
  });
  const skipped = entries.length - shown.length;
  return (skipped ? [`(${skipped} older left out)`, ...lines] : lines).join("\n\n");
}

const describeState = (state: PreviewState, errors: number) =>
  JSON.stringify(
    {
      url: state.url,
      title: state.title,
      server: serverLine(state.server),
      ...(state.error ? { loadError: state.error } : {}),
      consoleErrorsWhileLoading: errors,
    },
    null,
    2,
  );

export async function answerPreviewTool(
  previews: ThreadPreviews,
  caller: Caller,
  name: PreviewToolName,
  input: { url?: string; reload?: boolean; clear?: boolean },
  signal: AbortSignal,
): Promise<ToolResult> {
  const key = caller.chatId;
  switch (name) {
    case "open_preview": {
      const started = Date.now();
      let state = await previews.open(caller.projectId, caller.chatId);
      previews.reveal(caller.projectId, caller.chatId);
      const home = previews.home(key);
      if (input.url)
        previews.navigate(key, previewTarget(input.url, state.url || home));
      else if (input.reload) previews.act(key, "reload");
      else if (!state.url && !home)
        return toolText(
          "The project has no dev port in Settings → Projects → Preview, so there's nothing to open by default. Pass a url, or ask the user to set the dev command and port.",
          true,
        );
      await previews.settled(key, OPEN_WAIT_MS, signal);
      state = previews.current(key) ?? state;
      if (state.server.state === "failed")
        return toolText(
          `The dev server failed on port ${state.server.port}. The end of what it printed:\n\n${state.server.output.slice(-3000)}`,
          true,
        );
      if (state.server.state === "starting")
        return toolText(
          `The dev server is still starting on port ${state.server.port}; call open_preview again in a while.`,
          true,
        );
      const errors = (previews.consoleErrors(key) ?? []).filter(
        (e) => e.level === "error" && e.at >= started,
      ).length;
      return toolText(describeState(state, errors), !!state.error);
    }
    case "screenshot": {
      if (!previews.current(key)?.url) return toolText(NO_PAGE, true);
      await previews.settled(key, SHOT_WAIT_MS, signal);
      const image = await previews.capture(key);
      if (!image) return toolText(NO_PAGE, true);
      const { width } = image.getSize();
      const scaled = width > SHOT_WIDTH ? image.resize({ width: SHOT_WIDTH }) : image;
      const state = previews.current(key);
      return {
        content: [
          {
            type: "image",
            data: scaled.toPNG().toString("base64"),
            mimeType: "image/png",
          },
          { type: "text", text: `${state?.url ?? ""}${state?.title ? ` (${state.title})` : ""}` },
        ],
      };
    }
    case "console_errors": {
      const entries = previews.consoleErrors(key, input.clear);
      if (!entries) return toolText(NO_PAGE, true);
      if (!entries.length)
        return toolText("Nothing logged: no errors or warnings.");
      return toolText(consoleText(entries, Date.now()));
    }
  }
}
