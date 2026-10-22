import { randomUUID } from "node:crypto";
import type { HtmlRender } from "../../shared/html-render";
import type { ProjectChat } from "../../shared/projects";
import type { ProjectChats } from "../project-chats";
import {
  answerPreviewTool,
  type PreviewToolName,
  type ThreadPreviews,
} from "../preview";
import {
  answerRenderTool,
  hungPage,
  PageHung,
  type RenderToolName,
  type RenderTools,
} from "../html-renders";
import { toolText, type RelayToolArgs } from "../relay-mcp";

/** The preview's frame under an answer: sharp at the card's 720 px on a 2x screen. */
const PREVIEW_SHOT_WIDTH = 1440;

/** Pages an agent shows in its answer, including previews captured off screen. */
export class ThreadPages {
  constructor(
    private chats: Pick<
      ProjectChats,
      "showRender" | "showPreview" | "askWithPage"
    >,
    private options: { previews?: ThreadPreviews; look?: RenderTools["look"] },
  ) {}

  async preview(
    caller: Pick<ProjectChat, "id" | "projectId">,
    name: PreviewToolName,
    input: Parameters<typeof answerPreviewTool>[3],
    signal: AbortSignal,
  ) {
    if (!this.options.previews)
      return toolText("Previews aren't available in this Relay.", true);
    const result = await answerPreviewTool(
      this.options.previews,
      { projectId: caller.projectId, chatId: caller.id },
      name,
      input,
      signal,
    );
    if (name !== "console_errors" && !result.isError)
      await this.keepPreview(caller.id);
    return result;
  }

  render(
    chatId: string,
    name: RenderToolName,
    input: RelayToolArgs<"show_html"> | RelayToolArgs<"preview_html">,
    signal: AbortSignal,
  ) {
    return answerRenderTool(
      {
        look: this.options.look,
        show: (id, render, pages) => this.chats.showRender(id, render, pages),
      },
      chatId,
      name,
      input,
      signal,
    );
  }

  /**
   * Leaves the thread's preview under the answer, with the page as it looks
   * now: drawn off screen when the panel is closed, which is when the user
   * most needs to see it's there.
   */
  private async keepPreview(chatId: string) {
    const previews = this.options.previews!;
    const state = previews.current(chatId);
    if (!state?.url || state.error) return;
    const frame = await previews.capture(chatId).catch((e) => {
      console.warn("Could not draw the preview for its answer:", e);
      return null;
    });
    const scaled =
      frame && frame.getSize().width > PREVIEW_SHOT_WIDTH
        ? frame.resize({ width: PREVIEW_SHOT_WIDTH })
        : frame;
    await this.chats
      .showPreview(
        chatId,
        { url: state.url, title: state.title, at: Date.now() },
        scaled && !scaled.isEmpty() ? scaled.toJPEG(80) : null,
      )
      .catch((e) =>
        console.warn("Could not leave the preview in the answer:", e),
      );
  }

  /**
   * Leaves the agent's page in its answer for the user to answer whenever
   * they like; the answer comes as their next message, so nothing waits on a
   * tool call that a client would time out.
   */
  async ask(
    chatId: string,
    { title, html, detail }: RelayToolArgs<"ask_html">,
    signal: AbortSignal,
  ) {
    const look =
      this.options.look &&
      (await this.options
        .look(html, {}, signal)
        .catch((error) => (error instanceof PageHung ? error : undefined)));
    if (look instanceof PageHung) return hungPage(look);
    const page: HtmlRender = {
      id: randomUUID(),
      title,
      created: Date.now(),
      pages: [look ? { heights: look.heights } : {}],
    };
    await this.chats.askWithPage(chatId, page, html, detail ?? title);
    return toolText(
      `Shown to the user as "${title}". Their answer comes as their next message, as the JSON the page handed back, or word that they skipped it. If you can't go on without it, end your turn now and wait.`,
    );
  }
}
