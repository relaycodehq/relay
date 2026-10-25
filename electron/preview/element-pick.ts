import { randomUUID } from "node:crypto";
import type { WebContents } from "electron";
import { z } from "zod";
import {
  browserAnnotationSchema,
  type BrowserAnnotation,
} from "../../shared/browser-annotations";
import type { PreviewAnnotationChange } from "../../shared/preview";
import { annotationRuntime } from "./annotation-runtime";
import { annotationStyle } from "./annotation-style";

const WORLD = 1007;

const changeSchema = z.discriminatedUnion("action", [
  z
    .object({ action: z.literal("save"), annotation: browserAnnotationSchema })
    .strict(),
  z.object({ action: z.literal("remove"), id: z.uuid() }).strict(),
]);

/** A visible element's crop, with a little surrounding context. */
export function clipRect({
  rect,
  viewport,
}: Pick<BrowserAnnotation, "rect" | "viewport">) {
  const x = Math.max(0, Math.floor(rect.x - 8));
  const y = Math.max(0, Math.floor(rect.y - 8));
  const right = Math.min(viewport.width, Math.ceil(rect.x + rect.width + 8));
  const bottom = Math.min(viewport.height, Math.ceil(rect.y + rect.height + 8));
  return right > x && bottom > y
    ? { x, y, width: right - x, height: bottom - y }
    : undefined;
}

/** Runs the inspector with no Node API or bridge exposed to the webpage. */
export function pickElement(wc: WebContents, annotations: BrowserAnnotation[]) {
  let settle: (change: PreviewAnnotationChange | null) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  const result = new Promise<PreviewAnnotationChange | null>((yes, no) => {
    settle = yes;
    fail = no;
  });
  const newId = randomUUID();
  let done = false;
  const execute = (code: string) =>
    wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code }]);
  const stopInPage = () => {
    if (!wc.isDestroyed())
      void execute(
        `if (globalThis.__relayElementPicker?.id === ${JSON.stringify(newId)}) globalThis.__relayElementPicker.cancel()`,
      ).catch(() => {});
  };
  const clean = () => {
    wc.off("did-start-navigation", navigated);
    wc.off("destroyed", cancel);
    wc.off("render-process-gone", cancel);
  };
  const cancel = () => {
    if (done) return;
    done = true;
    clean();
    stopInPage();
    settle(null);
  };
  const navigated = (
    details: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
  ) => {
    // A route change in a single-page app keeps the page, and the comment being typed.
    if (details.isMainFrame && !details.isSameDocument) cancel();
  };
  wc.on("did-start-navigation", navigated);
  wc.on("destroyed", cancel);
  wc.on("render-process-gone", cancel);
  void (async () => {
    try {
      const raw: unknown = await execute(
        `(${annotationRuntime})(${JSON.stringify(annotations)}, ${JSON.stringify(newId)}, ${JSON.stringify(annotationStyle)})`,
      );
      if (done) return;
      if (raw === null) {
        cancel();
        return;
      }
      const change = changeSchema.parse(raw);
      const id = change.action === "save" ? change.annotation.id : change.id;
      if (id !== newId && !annotations.some((a) => a.id === id))
        throw new Error("That browser comment is no longer available.");
      if (change.action === "remove") {
        done = true;
        clean();
        settle(change);
        return;
      }
      const moved = () => wc.getURL() !== change.annotation.url;
      if (moved())
        throw new Error("The page changed while saving. Comment again.");
      const clip = clipRect(change.annotation);
      if (!clip)
        throw new Error("That element is no longer visible. Select it again.");
      // A frame without the inspector in it.
      await new Promise((resolve) => setTimeout(resolve, 50));
      if (done) return;
      if (wc.isDestroyed() || moved())
        throw new Error("The page changed while saving. Comment again.");
      const image = await wc.capturePage(clip);
      if (done) return;
      if (image.isEmpty())
        throw new Error("Could not capture the selected element.");
      done = true;
      clean();
      settle({ ...change, image: image.toDataURL() });
    } catch (error) {
      if (done) return;
      done = true;
      clean();
      stopInPage();
      fail(error);
    }
  })();
  wc.focus();
  return { result, cancel };
}
