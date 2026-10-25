// Reaching the answer a thread's running turn is writing, for what its
// agent's tools add to it: pages, previews, questions.
import type { AgentRequest } from "../../shared/agent-modes";
import type { HtmlRender } from "../../shared/html-render";
import type { TurnPreview } from "../../shared/preview";
import { PAGE_QUESTION_ID } from "../../shared/projects";
import type { ChatCore } from "./core";

/** Asks the user in the thread's running turn, as its agent would; see electron/started-threads. */
export function askInTurn(
  core: ChatCore,
  id: string,
  request: Omit<AgentRequest, "id">,
  signal?: AbortSignal,
) {
  const active = core.active.get(id);
  if (!active)
    return Promise.reject(
      new Error("This thread has no running turn to ask in."),
    );
  return active.requests.ask(request, signal);
}

/** Adds a page the thread's agent showed to the answer it is writing; see electron/html-renders. */
export async function showRender(
  core: ChatCore,
  id: string,
  render: HtmlRender,
  pages: string[],
) {
  const active = core.active.get(id);
  if (!active?.render || core.active.windingDown(active))
    throw new Error("This thread has no running answer to show it in.");
  await core.storage.renders.save(id, render.id, pages);
  active.render(render);
}

/**
 * Leaves the thread's preview under the answer its agent is writing, with
 * the page's last frame when one could be drawn. A later open replaces it.
 */
export async function showPreview(
  core: ChatCore,
  id: string,
  preview: Omit<TurnPreview, "shot">,
  jpeg: Buffer | null,
) {
  const active = core.active.get(id);
  if (!active?.preview || !active.answerId || core.active.windingDown(active))
    return;
  const shot =
    !!jpeg &&
    (await core.storage.shown.keepPreviewShot(id, active.answerId(), jpeg).then(
      () => true,
      (e) => {
        console.warn("Could not keep the preview's frame:", e);
        return false;
      },
    ));
  active.preview({ ...preview, ...(shot ? { shot } : {}) });
}

/**
 * Leaves a page the thread's agent asks with (ask_html) in the answer it is
 * writing, as an open question: kept like a shown page, answered later
 * through answerQuestion. `ask` is the plain question for phones too old to
 * show the page.
 */
export async function askWithPage(
  core: ChatCore,
  id: string,
  page: HtmlRender,
  html: string,
  ask: string,
) {
  const active = core.active.get(id);
  if (!active?.askPage || core.active.windingDown(active))
    throw new Error("This thread has no running answer to ask in.");
  await core.storage.renders.save(id, page.id, [html]);
  active.askPage({
    id: page.id,
    page,
    questions: [{ id: PAGE_QUESTION_ID, header: "Page", question: ask }],
  });
}
