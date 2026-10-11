// What show_html and preview_html do for an agent. The tools are listed with
// the others in electron/relay-mcp.
import { createHash, randomUUID } from "node:crypto";
import {
  clampRenderHeight,
  type HtmlRender,
} from "../../shared/html-render";
import { toolText, type RelayToolArgs, type ToolResult } from "../relay-mcp/tools";
import type { lookAtPage, PageLook } from "./look";

export type RenderToolName = "show_html" | "preview_html";
export const renderToolNames = new Set<string>([
  "show_html",
  "preview_html",
] satisfies RenderToolName[]);

export interface RenderTools {
  /** Absent where Relay runs without windows, like the headless one. */
  look?: typeof lookAtPage;
  show: (chatId: string, render: HtmlRender, pages: string[]) => Promise<void>;
}

const PREVIEW_WIDTH = 800;

/** A look whose page kept its renderer busy past the deadline; see look.ts. */
export class PageHung extends Error {}

/** Why a page that hung wasn't shown, for the agent to fix it. */
export const hungPage = (error: PageHung, label?: string) =>
  toolText(
    `Not shown. ${label ? `${label}: ` : ""}${error.message} Fix it, check it with preview_html, then show it again.`,
    true,
  );

// A source is the page's URL, whose #theme= fragment is a screenful of JSON.
const logText = (look: PageLook) =>
  [
    ...(look.loadError ? [`[error] ${look.loadError}`] : []),
    ...look.logs.map(
      (l) =>
        `[${l.level}]${l.source ? ` at ${l.source.replace(/#[^:]*/, "")}` : ""} ${l.message.slice(0, 1000)}`,
    ),
  ].join("\n");

const hasErrors = (look: PageLook) =>
  !!look.loadError || look.logs.some((l) => l.level === "error");

/**
 * Pages turned back for their errors, by thread. The same pages sent again
 * show: the agent had its chance, and some errors aren't its to fix, like a
 * CDN that's down.
 */
const bounced = new Map<string, string>();
const pagesKey = (pages: { html: string; label?: string }[]) =>
  createHash("sha256").update(JSON.stringify(pages)).digest("hex");

export async function answerRenderTool(
  tools: RenderTools,
  chatId: string,
  name: RenderToolName,
  input: RelayToolArgs<"show_html"> | RelayToolArgs<"preview_html">,
  signal: AbortSignal,
): Promise<ToolResult> {
  if (name === "preview_html") {
    const { html, width = PREVIEW_WIDTH } = input as RelayToolArgs<"preview_html">;
    if (!tools.look)
      return toolText("This Relay runs without windows, so it can't load pages.", true);
    const look = await tools
      .look(html, { shotWidth: width }, signal)
      .catch((error) => {
        if (error instanceof PageHung) return error;
        throw error;
      });
    if (look instanceof PageHung)
      return toolText(`${look.message} Fix it and preview it again.`, true);
    const logs = logText(look);
    const height = look.shotHeight ?? 0;
    return {
      content: [
        ...(look.image && !look.image.isEmpty()
          ? [
              {
                type: "image" as const,
                data: look.image.toPNG().toString("base64"),
                mimeType: "image/png",
              },
            ]
          : []),
        {
          type: "text",
          text: [
            `In the app's ${look.scheme} theme, at ${width} px wide the page is ${height} px tall; the frame in the thread would be ${clampRenderHeight(height)} px.`,
            logs ? `It logged:\n${logs}` : "It logged no errors or warnings.",
            "The user hasn't seen it; call show_html to show it.",
          ].join("\n"),
        },
      ],
    };
  }
  const { title, html, variants } = input as RelayToolArgs<"show_html">;
  if (!html === !variants)
    return toolText("Give either html, for one page, or variants.", true);
  const pages = variants ?? [{ html: html!, label: undefined }];
  let hung: { error: PageHung; label?: string } | undefined;
  const looks = tools.look
    ? await Promise.all(
        pages.map((p) =>
          tools.look!(p.html, {}, signal).catch((error) => {
            if (error instanceof PageHung)
              hung ??= { error, label: variants && (p.label ?? "A variant") };
            return undefined;
          }),
        ),
      )
    : [];
  // Shown, it would keep spinning in the user's thread.
  if (hung) return hungPage(hung.error, hung.label);
  const key = pagesKey(pages);
  const failing = looks.flatMap((look, i) =>
    look && hasErrors(look)
      ? [`${variants ? (pages[i].label ?? "A variant") : "The page"} logged:\n${logText(look)}`]
      : [],
  );
  if (failing.length && bounced.get(chatId) !== key) {
    bounced.set(chatId, key);
    return toolText(
      [
        "Not shown: it logged errors, so the user would likely see it broken. Fix them, check it with preview_html, then show it again. If the errors aren't yours to fix, send the same page again and it shows as is.",
        ...failing,
      ].join("\n\n"),
      true,
    );
  }
  bounced.delete(chatId);
  const render: HtmlRender = {
    id: randomUUID(),
    title,
    created: Date.now(),
    pages: pages.map((p, i) => ({
      ...(p.label ? { label: p.label } : {}),
      ...(looks[i] ? { heights: looks[i].heights } : {}),
    })),
  };
  await tools.show(
    chatId,
    render,
    pages.map((p) => p.html),
  );
  const logs = looks
    .map((look, i) => {
      const text = look && logText(look);
      return text ? `${pages[i].label ?? "The page"} logged:\n${text}` : "";
    })
    .filter(Boolean);
  return toolText(
    [
      variants
        ? `Shown in your answer as "${title}", with ${variants.length} variants as tabs the user switches between. They tell you which they prefer in their reply.`
        : `Shown in your answer as "${title}".`,
      "The user sees it above your reply, so don't repeat what it shows; point at what matters or ask what you need to know.",
      ...logs,
    ].join("\n\n"),
  );
}
