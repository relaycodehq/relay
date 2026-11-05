// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { bindings } from "../../lib/shortcuts";
import { useActivityKeys } from "./useActivityKeys";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

async function renderActivity(open: () => void) {
  function Probe() {
    useActivityKeys({
      active: [],
      cards: [open],
      threads: [],
      loaded: true,
      chatId: undefined,
      jumping: true,
      actions: { settle: () => {} },
    });
    return null;
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Probe />));
}

function pressJumpToFirst() {
  const combo = bindings("jump-thread")[0]!;
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      code: "Digit1",
      key: "1",
      altKey: combo.alt,
      ctrlKey: combo.ctrl,
      metaKey: combo.meta,
      shiftKey: combo.shift,
      bubbles: true,
      cancelable: true,
    }),
  );
}

it("opens the first card from its digit", async () => {
  const open = vi.fn();
  await renderActivity(open);
  pressJumpToFirst();
  expect(open).toHaveBeenCalledTimes(1);
});

it("leaves the cards behind an open dialog alone", async () => {
  const open = vi.fn();
  await renderActivity(open);
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  document.body.append(dialog);
  pressJumpToFirst();
  expect(open).not.toHaveBeenCalled();
});

it("still jumps out of Settings", async () => {
  const open = vi.fn();
  await renderActivity(open);
  const settings = document.createElement("div");
  settings.className = "settings-screen";
  document.body.append(settings);
  pressJumpToFirst();
  expect(open).toHaveBeenCalledTimes(1);
});
