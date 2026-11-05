// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { PreviewState } from "../../../shared/preview";
import type { PanelTabs } from "../panel/panel-tabs";
import { PanelBrowsers } from "./PanelBrowsers";

const mock = vi.hoisted(() => ({
  opens: new Map<
    string,
    { resolve: (state: PreviewState) => void; reject: (error: Error) => void }
  >(),
}));

vi.mock("../../lib/api", () => ({
  api: {
    onPreview: () => () => {},
    placePreview: async () => {},
    previewAction: async () => {},
    openPreview: (_projectId: string, chatId: string) =>
      new Promise<PreviewState>((resolve, reject) =>
        mock.opens.set(chatId, { resolve, reject }),
      ),
  },
}));

vi.mock("../../lib/shortcuts", () => ({ useShortcut: () => {} }));

vi.mock("./useBrowserAnnotations", () => ({
  useBrowserAnnotations: () => async () => {},
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const tab = { key: "browser", surface: "browser" } as const;
const panel = { tabs: [tab], front: tab } as unknown as PanelTabs;

const state = (key: string, url: string): PreviewState => ({
  key,
  url,
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
  poppedOut: false,
  picking: false,
  server: { state: "none" },
});

it("shows the next thread's own browser, not what the last one left behind", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (chatId: string) =>
    act(() =>
      root.render(
        <PanelBrowsers
          panel={panel}
          projectId="project"
          chatId={chatId}
          draftKey={`draft-${chatId}`}
        />,
      ),
    );
  try {
    render("a");
    const address = () =>
      host.querySelector<HTMLInputElement>("input[aria-label=Address]")!;
    act(() => {
      const input = address();
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      setValue.call(input, "localhost:4000/half-typed");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(address().value).toBe("localhost:4000/half-typed");

    render("b");
    await act(async () =>
      mock.opens.get("b")!.resolve(state("b", "http://localhost:3000/")),
    );
    await act(async () =>
      mock.opens.get("a")!.reject(new Error("Thread a's preview failed")),
    );

    expect(address().value).toBe("http://localhost:3000/");
    expect(host.textContent).not.toContain("Thread a's preview failed");
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
