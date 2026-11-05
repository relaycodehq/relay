import { expect, it, vi } from "vitest";
import type { HtmlRender } from "../../shared/html-render";
import type { ChatCore } from "./core";
import { askWithPage, showRender } from "./running-answer";

const page: HtmlRender = { id: "r1", title: "Chart", created: 1, pages: [{}] };

/** A thread with an answer running, under the render mode the user picked. */
function runningThread(renderMode: "auto" | "off") {
  const active = { render: vi.fn(), askPage: vi.fn() };
  const save = vi.fn(async () => {});
  const core = {
    store: { get: () => ({ renderMode }) },
    active: { get: () => active, windingDown: () => false },
    storage: { renders: { save } },
  } as unknown as ChatCore;
  return { core, active, save };
}

// A session started before the user turned pages off still lists the tools.
it("shows no page once the user turned pages off", async () => {
  const { core, active, save } = runningThread("off");
  await expect(showRender(core, "chat-1", page, ["<p>hi</p>"])).rejects.toThrow(
    /pages off/,
  );
  await expect(
    askWithPage(core, "chat-1", page, "<p>hi</p>", "Pick one"),
  ).rejects.toThrow(/pages off/);
  expect(save).not.toHaveBeenCalled();
  expect(active.render).not.toHaveBeenCalled();
  expect(active.askPage).not.toHaveBeenCalled();
});

it("shows the page while pages are on", async () => {
  const { core, active } = runningThread("auto");
  await showRender(core, "chat-1", page, ["<p>hi</p>"]);
  expect(active.render).toHaveBeenCalledWith(page);
});
