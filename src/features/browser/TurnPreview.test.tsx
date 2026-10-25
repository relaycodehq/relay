// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import type { PreviewState } from "../../../shared/preview";
import { ThreadPreviewContext, TurnPreview } from "./TurnPreview";

const mock = vi.hoisted(() => ({
  current: undefined as PreviewState | undefined,
  navigate: vi.fn(async () => {}),
}));

vi.mock("../../lib/api", () => ({ api: { navigatePreview: mock.navigate } }));

vi.mock("./previews", () => ({
  previewKey: (_projectId: string, chatId: string) => chatId,
  usePreviewState: () => mock.current,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it("opens a saved card's URL when the Browser panel has no current page after a restart", () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient();
  const show = vi.fn();
  const url = "http://localhost:5173/previews/example/?view=two#details";
  try {
    act(() =>
      root.render(
        <QueryClientProvider client={client}>
          <ThreadPreviewContext
            value={{
              projectId: "project",
              showing: true,
              unseenSince: null,
              show,
            }}
          >
            <TurnPreview
              chatId="chat"
              messageId="message"
              preview={{ url, title: "Saved preview", at: 1 }}
            />
          </ThreadPreviewContext>
        </QueryClientProvider>,
      ),
    );
    const open = host.querySelector<HTMLButtonElement>(".turn-preview-url")!;
    expect(open.disabled).toBe(false);
    act(() => open.click());
    expect(mock.navigate).toHaveBeenCalledWith("project", "chat", url);
    expect(show).toHaveBeenCalledOnce();
  } finally {
    act(() => root.unmount());
    client.clear();
    host.remove();
  }
});
