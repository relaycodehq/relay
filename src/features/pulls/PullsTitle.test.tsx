// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { PullsTitle } from "./PullsTitle";
import type { PullsLocation } from "./pull-board";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const portal = { key: "https://git.example|web/portal", label: "Portal" };

async function show(where: PullsLocation) {
  const onNav = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(<PullsTitle where={where} onNav={onNav} onLeave={vi.fn()} />),
  );
  const button = (label: string) =>
    [...container.querySelectorAll("button")].find(
      (b) => b.textContent === label || b.getAttribute("aria-label") === label,
    )!;
  return {
    container,
    onNav,
    button,
    close: () => act(async () => root.unmount()),
  };
}

it("reads Pull requests / Search while a search covers a project's page", async () => {
  const title = await show({ repo: portal, pull: null, search: true });
  expect(title.container.textContent).toBe("Pull requests/Search");
  await title.close();
});

it("goes back from a search to the project's page, or the board without one", async () => {
  const onProject = await show({ repo: portal, pull: null, search: true });
  await act(async () => onProject.button("Back").click());
  expect(onProject.onNav).toHaveBeenCalledWith({
    to: "repo",
    repo: portal.key,
  });
  await onProject.close();

  const onBoard = await show({ repo: null, pull: null, search: true });
  await act(async () => onBoard.button("Back").click());
  expect(onBoard.onNav).toHaveBeenCalledWith({ to: "board" });
  await onBoard.close();
});

it("sends the Pull requests crumb of a search to the board", async () => {
  const title = await show({ repo: portal, pull: null, search: true });
  await act(async () => title.button("Pull requests").click());
  expect(title.onNav).toHaveBeenCalledWith({ to: "board" });
  await title.close();
});
