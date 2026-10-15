import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  flush,
  harnessReact,
  mount,
  rerender,
} from "../../../tests/unit/hook-harness";
import { numberImages } from "../../../shared/image-refs";
import type { DraftImage } from "../images/draft-images";
import type { DraftEditor } from "./useComposerDraft";

vi.mock("react", () => harnessReact);
vi.mock("../../lib/api", () => ({ api: {} }));
vi.mock("../images/image-pills", () => ({ useImagePills: () => true }));
const saved = new Map<string, DraftImage[]>();
const savedListeners = new Set<(key: string, images: DraftImage[]) => void>();
// How long a screenshot takes to shrink; a big one re-encodes on a canvas.
let preparing = 0;
let finishScreenshot: (() => void) | undefined;
vi.mock("../images/draft-images", () => ({
  isScreenshot: () => true,
  loadDraftImages: async (key: string) => saved.get(key) ?? [],
  saveDraftImages: async (key: string, images: DraftImage[]) => {
    if (images.length) saved.set(key, images);
    else saved.delete(key);
    savedListeners.forEach((notify) => notify(key, images));
  },
  onDraftImagesChanged: () => () => {},
  onDraftImagesSaved: (notify: (key: string, images: DraftImage[]) => void) => {
    savedListeners.add(notify);
    return () => savedListeners.delete(notify);
  },
  onDraftImageCount: () => () => {},
  draftImageCount: () => 0,
  draftsWithImages: () => [],
  readDraftImageCounts: async () => {},
  prepareScreenshot: (file: File) =>
    new Promise((resolve) => {
      const finish = () =>
        resolve({
          id: file.name,
          name: file.name,
          mimeType: "image/png",
          dataUrl: "data:image/png;base64,AAAA",
        });
      if (preparing < 0) finishScreenshot = finish;
      else setTimeout(finish, preparing);
    }),
}));

// Stands in for the HTML a copied message carries; image-clipboard reads the real thing.
vi.mock("../images/image-clipboard", () => ({
  copiedImages: (html: string) =>
    html
      ? (JSON.parse(html) as { n?: number; name: string }[]).map(
          ({ n, name }) => ({ n, file: { name } as File }),
        )
      : [],
}));

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  saved.clear();
  savedListeners.clear();
  preparing = 0;
  finishScreenshot = undefined;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

const KEY = "chat-draft:t1";
const screenshot = (name: string) => ({ name }) as File;

async function composer() {
  const { useComposerDraft } = await import("./useComposerDraft");
  const draft = mount(() =>
    useComposerDraft(KEY, { current: { insertImages() {} } as never }),
  );
  await flush();
  rerender();
  return draft;
}
async function settle() {
  await flush();
  rerender();
}
const state = (draft: Awaited<ReturnType<typeof composer>>) => ({
  shown: draft().images.map((image) => image.id),
  stored: (saved.get(KEY) ?? []).map((image) => image.id),
});

it("keeps a screenshot pasted while the last one goes out, and only that one", async () => {
  const draft = await composer();
  draft().addFiles([screenshot("first.png")]);
  await settle();
  const outgoing = draft().take(true);
  outgoing.dispatch();
  rerender();
  draft().addFiles([screenshot("second.png")]);
  await settle();
  expect(state(draft).shown).toEqual(["second.png"]);
  // The send is accepted.
  await outgoing.forget();
  await settle();
  expect(state(draft)).toEqual({
    shown: ["second.png"],
    stored: ["second.png"],
  });
});

it("puts a refused message's screenshot back once, ahead of one pasted meanwhile", async () => {
  const draft = await composer();
  draft().addFiles([screenshot("first.png")]);
  await settle();
  const outgoing = draft().take(true);
  outgoing.dispatch();
  rerender();
  draft().addFiles([screenshot("second.png")]);
  await settle();
  outgoing.restore();
  await settle();
  expect(state(draft)).toEqual({
    shown: ["first.png", "second.png"],
    stored: ["first.png", "second.png"],
  });
});

it("keeps both of two screenshots pasted while the first is still being prepared", async () => {
  preparing = 30;
  const draft = await composer();
  draft().addFiles([screenshot("one.png")]);
  rerender();
  draft().addFiles([screenshot("two.png")]);
  await new Promise((r) => setTimeout(r, 120));
  await settle();
  expect({ ...state(draft), error: draft().error }).toEqual({
    shown: ["one.png", "two.png"],
    stored: ["one.png", "two.png"],
    error: undefined,
  });
  expect(draft().preparing).toBe(false);
});

it("persists a screenshot's token when its editor disappears during preparation", async () => {
  preparing = -1;
  const { useComposerDraft } = await import("./useComposerDraft");
  const { readDraft, writeDraft } = await import("./drafts");
  writeDraft(KEY, "Look at this screenshot");
  const editor: { current: DraftEditor | null } = {
    current: { insertImages: vi.fn() } as unknown as DraftEditor,
  };
  const draft = mount(() => useComposerDraft(KEY, editor));
  await settle();
  draft().addFiles([screenshot("pasted.png")]);
  await flush();
  expect(finishScreenshot).toBeTypeOf("function");
  editor.current = null;
  finishScreenshot!();
  await settle();
  expect(readDraft(KEY)).toBe("Look at this screenshot [Image #1]");
  expect(draft().attached).toHaveLength(1);
  expect(numberImages(readDraft(KEY), draft().images).images).toHaveLength(1);
});

it("keeps a pending screenshot in its original draft when another conversation shows", async () => {
  preparing = -1;
  const { useComposerDraft } = await import("./useComposerDraft");
  const { readDraft, writeDraft } = await import("./drafts");
  const other = "chat-draft:other";
  writeDraft(KEY, "Look at this screenshot");
  writeDraft(other, "Other conversation");
  let key = KEY;
  const insertImages = vi.fn();
  const editor = { current: { insertImages } as unknown as DraftEditor };
  const draft = mount(() => useComposerDraft(key, editor));
  await settle();
  draft().addFiles([screenshot("pasted.png")]);
  // Switching before the queued work even starts must still load the original draft.
  key = other;
  rerender();
  await flush();
  finishScreenshot!();
  await settle();
  expect(readDraft(KEY)).toBe("Look at this screenshot [Image #1]");
  expect(readDraft(other)).toBe("Other conversation");
  expect(insertImages).not.toHaveBeenCalled();
  key = KEY;
  rerender();
  await settle();
  expect(draft().attached).toHaveLength(1);
});

it("hears a screenshot completed by a composer that was closed and reopened", async () => {
  const draft = await composer();
  const { writeDraft } = await import("./drafts");
  const { saveDraftImages } = await import("../images/draft-images");
  await saveDraftImages(KEY, [
    {
      id: "late.png",
      n: 1,
      name: "late.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,AAAA",
    },
  ]);
  writeDraft(KEY, "Look at this screenshot [Image #1]");
  await settle();
  expect(draft().attached.map((image) => image.id)).toEqual(["late.png"]);
});

it("pastes a copied message's screenshots as pills numbered after the draft's own", async () => {
  const { useComposerDraft } = await import("./useComposerDraft");
  const { writeDraft } = await import("./drafts");
  const { saveDraftImages } = await import("../images/draft-images");
  await saveDraftImages(KEY, [
    {
      id: "mine.png",
      n: 1,
      name: "mine.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,AAAA",
    },
  ]);
  writeDraft(KEY, "Mine: [Image #1]");
  const pasteText = vi.fn();
  const editor = { current: { pasteText } as unknown as DraftEditor };
  const draft = mount(() => useComposerDraft(KEY, editor));
  await settle();
  const event = {
    clipboardData: {
      getData: (type: string) =>
        type === "text/html"
          ? JSON.stringify([
              { n: 1, name: "theirs.png" },
              { name: "strip.png" },
            ])
          : "Theirs: [Image #1]\r\n",
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
  draft().paste(event as never);
  expect(event.preventDefault).toHaveBeenCalled();
  await settle();
  expect(pasteText).toHaveBeenCalledWith("Theirs: [Image #2]");
  expect(saved.get(KEY)?.map(({ id, n }) => ({ id, n }))).toEqual([
    { id: "mine.png", n: 1 },
    { id: "theirs.png", n: 2 },
    { id: "strip.png", n: undefined },
  ]);
});
