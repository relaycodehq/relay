import { describe, expect, it, vi } from "vitest";
import { answerRenderTool, type RenderTools } from "./agent-tools";
import type { PageLook } from "./look";

const look = (logs: PageLook["logs"]): PageLook => ({
  heights: [100, 100],
  logs,
  scheme: "dark",
});
const broken = look([
  {
    level: "error",
    message: 'Error: <circle> attribute r: Expected length, "3/".',
    source: "relay-render://draft/abc#theme=%7B%22scheme%22%7D:66",
  },
]);

function tools(result: PageLook) {
  const show = vi.fn(async () => {});
  const t: RenderTools = { look: vi.fn(async () => result), show };
  return { t, show };
}
const signal = new AbortController().signal;
const text = (r: Awaited<ReturnType<typeof answerRenderTool>>) =>
  r.content.map((c) => ("text" in c ? c.text : "")).join("");

describe("show_html", () => {
  it("turns back a page that logs errors, and shows it when sent again", async () => {
    const { t, show } = tools(broken);
    const input = { title: "Icons", html: "<svg><circle r=3/></svg>" };
    const first = await answerRenderTool(
      t,
      "chat-1",
      "show_html",
      input,
      signal,
    );
    expect(first.isError).toBe(true);
    expect(show).not.toHaveBeenCalled();
    expect(text(first)).toContain("at relay-render://draft/abc:66 Error");

    const again = await answerRenderTool(
      t,
      "chat-1",
      "show_html",
      input,
      signal,
    );
    expect(again.isError).toBeFalsy();
    expect(show).toHaveBeenCalledOnce();
  });

  it("turns back a changed page that still logs errors", async () => {
    const { t, show } = tools(broken);
    await answerRenderTool(
      t,
      "chat-2",
      "show_html",
      { title: "A", html: "<p>1" },
      signal,
    );
    const changed = await answerRenderTool(
      t,
      "chat-2",
      "show_html",
      { title: "A", html: "<p>2" },
      signal,
    );
    expect(changed.isError).toBe(true);
    expect(show).not.toHaveBeenCalled();
  });

  it("shows a page that only warns", async () => {
    const { t, show } = tools(
      look([{ level: "warning", message: "deprecated" }]),
    );
    const r = await answerRenderTool(
      t,
      "chat-3",
      "show_html",
      { title: "W", html: "<p>" },
      signal,
    );
    expect(r.isError).toBeFalsy();
    expect(show).toHaveBeenCalledOnce();
  });
});
