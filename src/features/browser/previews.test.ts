// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import type { PreviewState } from "../../../shared/preview";
import { api } from "../../lib/api";
import {
  forgetThreadPreviews,
  openPreview,
  usePreviewStates,
} from "./previews";

vi.mock("react", () => ({
  useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
}));

vi.mock("../../lib/api", () => ({
  api: {
    onPreview: vi.fn(() => () => {}),
    openPreview: vi.fn(),
    closePreview: vi.fn(),
  },
}));

const opened = (key: string) =>
  ({
    key,
    snapshot: `data:image/jpeg;base64,${"x".repeat(100_000)}`,
  }) as PreviewState;

it("lets go of a deleted thread's pages, each delete leaving none behind", async () => {
  vi.mocked(api.openPreview).mockImplementation(
    async (_project, chatId, page) =>
      opened(page ? `${chatId}~${page}` : chatId!),
  );
  await openPreview("project", "kept");
  for (let round = 0; round < 5; round++) {
    const chatId = `deleted-${round}`;
    await openPreview("project", chatId);
    await openPreview("project", chatId, "docs");

    forgetThreadPreviews(chatId);

    const stateOf = usePreviewStates();
    expect(stateOf(chatId)).toBeUndefined();
    expect(stateOf(`${chatId}~docs`)).toBeUndefined();
    expect(stateOf("kept")).toBeDefined();
  }
});
