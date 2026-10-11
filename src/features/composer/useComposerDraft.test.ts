import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  flush,
  harnessReact,
  mount,
  rerender,
} from "../../../tests/unit/hook-harness";

vi.mock("react", () => harnessReact);
vi.mock("../../lib/api", () => ({ api: {} }));
vi.mock("../images/image-pills", () => ({ useImagePills: () => true }));
const saved = new Map<string, { id: string }[]>();
// How long a screenshot takes to shrink; a big one re-encodes on a canvas.
let preparing = 0;
vi.mock("../images/draft-images", () => ({
  isScreenshot: () => true,
  loadDraftImages: async (key: string) => saved.get(key) ?? [],
  saveDraftImages: async (key: string, images: { id: string }[]) => {
    if (images.length) saved.set(key, images);
    else saved.delete(key);
  },
  onDraftImagesChanged: () => () => {},
  onDraftImageCount: () => () => {},
  draftImageCount: () => 0,
  draftsWithImages: () => [],
  readDraftImageCounts: async () => {},
  prepareScreenshot: (file: File) =>
    new Promise((resolve) =>
      setTimeout(
        () =>
          resolve({
            id: file.name,
            name: file.name,
            mimeType: "image/png",
            dataUrl: "data:image/png;base64,AAAA",
          }),
        preparing,
      ),
    ),
}));

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  saved.clear();
  preparing = 0;
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
