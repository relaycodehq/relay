import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  open: vi.fn<() => Promise<void>>(),
  collect: vi.fn(() => [{ path: "a.ts", text: "edited\n" }]),
  discard: vi.fn(),
}));
vi.mock("../../lib/api", () => ({
  api: { openEditorWindow: mocks.open },
}));
vi.mock("./unsaved-buffers", () => ({
  adoptBuffers: vi.fn(),
  collectUnsaved: mocks.collect,
  discardWorkspace: mocks.discard,
}));
import { isEditorElsewhere, popOutEditor } from "./editor-windows";

const where = "w";

beforeEach(() => vi.clearAllMocks());

it("hides the editor here while its edits go to the new window, so nothing typed meanwhile is dropped", async () => {
  let opened!: () => void;
  mocks.open.mockReturnValue(new Promise((resolve) => (opened = resolve)));
  const popping = popOutEditor("p", where);
  expect(isEditorElsewhere(where)).toBe(true);
  expect(mocks.collect).toHaveBeenCalledWith(where);
  opened();
  await popping;
  expect(mocks.discard).toHaveBeenCalledWith(where);
});

it("shows the editor again with its edits when the window can't open", async () => {
  mocks.open.mockRejectedValue(new Error("That project isn't here anymore."));
  await expect(popOutEditor("p", where)).rejects.toThrow();
  expect(isEditorElsewhere(where)).toBe(false);
  expect(mocks.discard).not.toHaveBeenCalled();
});
