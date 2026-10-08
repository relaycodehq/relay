import { describe, expect, it } from "vitest";
import { answerPreviewTool, consoleText, previewTarget } from "./agent-tools";
import type { ThreadPreviews } from "./thread-previews";
import { clipRect } from "./element-pick";

describe("previewTarget", () => {
  it("takes a full address as it is", () => {
    expect(previewTarget("http://localhost:5173/a?b=1", undefined)).toBe(
      "http://localhost:5173/a?b=1",
    );
  });
  it("puts a path on the page's origin", () => {
    expect(previewTarget("/settings", "http://localhost:3000/home")).toBe(
      "http://localhost:3000/settings",
    );
  });
  it("needs a page or dev server before a path means anything", () => {
    expect(() => previewTarget("/settings", undefined)).toThrow(/no address/);
  });
  it("loads only http and https", () => {
    expect(() => previewTarget("file:///etc/passwd", undefined)).toThrow(
      /only loads http/,
    );
    expect(() =>
      previewTarget("javascript:alert(1)", "http://localhost:3000/"),
    ).toThrow(/only loads http/);
  });
});

describe("consoleText", () => {
  const now = 1_000_000;
  it("says when and where each entry came from", () => {
    expect(
      consoleText(
        [
          {
            level: "error",
            message: "boom",
            source: "app.js:3",
            at: now - 90_000,
          },
        ],
        now,
      ),
    ).toBe("[error] 2 min ago at app.js:3\nboom");
  });
  it("keeps the newest entries and cuts long ones", () => {
    const entries = Array.from({ length: 52 }, (_, i) => ({
      level: "warning" as const,
      message: i === 51 ? "x".repeat(2500) : `w${i}`,
      at: now,
    }));
    const text = consoleText(entries, now);
    expect(text.startsWith("(2 older left out)")).toBe(true);
    expect(text).not.toContain("\nw1\n");
    expect(text).toContain(`${"x".repeat(2000)}…`);
    expect(text).not.toContain("x".repeat(2001));
  });
});

describe("clipRect", () => {
  const viewport = { width: 800, height: 600 };
  it("frames the element with a margin, in whole pixels", () => {
    expect(
      clipRect({
        rect: { x: 100.4, y: 50.6, width: 20, height: 10 },
        viewport,
      }),
    ).toEqual({ x: 92, y: 42, width: 37, height: 27 });
  });
  it("keeps the frame inside the viewport", () => {
    expect(
      clipRect({ rect: { x: -40, y: 590, width: 100, height: 50 }, viewport }),
    ).toEqual({ x: 0, y: 582, width: 68, height: 18 });
  });
  it("gives the whole page when the element is out of sight", () => {
    expect(
      clipRect({ rect: { x: 0, y: 900, width: 100, height: 20 }, viewport }),
    ).toBeUndefined();
  });
});

it("keeps a working pane successful when the external URL proxy cannot start", async () => {
  const state = {
    key: "chat",
    url: "http://localhost:3000/",
    title: "Page",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    poppedOut: false,
    server: { state: "none" as const },
  };
  const previews = {
    open: async () => state,
    current: () => state,
    reveal: () => {},
    home: () => state.url,
    settled: async () => {},
    consoleErrors: () => [],
    browserUrl: async () => {
      throw new Error("Proxy port is busy");
    },
  } as unknown as ThreadPreviews;
  const answer = await answerPreviewTool(
    previews,
    { projectId: "project", chatId: "chat" },
    "open_preview",
    {},
    new AbortController().signal,
  );
  expect(answer.isError).toBeFalsy();
  expect(
    JSON.parse((answer.content[0] as { text: string }).text),
  ).toMatchObject({ url: state.url, browserUrlError: "Proxy port is busy" });
});
