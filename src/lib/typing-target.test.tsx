// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  vi.resetModules();
  Object.defineProperty(navigator, "platform", {
    value: "Win32",
    configurable: true,
  });
});

const mounted: Root[] = [];

afterEach(() => {
  act(() => mounted.splice(0).forEach((root) => root.unmount()));
  document.body.innerHTML = "";
});

/** Windows reports AltGr as Ctrl+Alt, with the character it types as the key. */
function altGr(code: string, key: string) {
  const event = new KeyboardEvent("keydown", {
    code,
    key,
    ctrlKey: true,
    altKey: true,
    bubbles: true,
    cancelable: true,
  });
  event.getModifierState = (name: string) => name === "AltGraph";
  return event;
}

async function listenFor(id: "editor-window") {
  const { useShortcut } = await import("./shortcuts");
  const fired = vi.fn();
  function Listener() {
    useShortcut(id, true, fired);
    return null;
  }
  const root = createRoot(document.createElement("div"));
  mounted.push(root);
  await act(async () => root.render(<Listener />));
  return fired;
}

it("types € with AltGr+E in a field instead of opening the editor window", async () => {
  const fired = await listenFor("editor-window");
  const field = document.body.appendChild(document.createElement("textarea"));
  const press = altGr("KeyE", "€");
  field.dispatchEvent(press);
  expect(fired).not.toHaveBeenCalled();
  expect(press.defaultPrevented).toBe(false);
});

it("keeps Ctrl+Alt+E a shortcut in a field when AltGr types nothing on E", async () => {
  const fired = await listenFor("editor-window");
  const field = document.body.appendChild(document.createElement("textarea"));
  field.dispatchEvent(altGr("KeyE", "e"));
  expect(fired).toHaveBeenCalledOnce();
});

it("keeps ⌥⌘E a shortcut in a field on macOS, where Option is a modifier", async () => {
  Object.defineProperty(navigator, "platform", { value: "MacIntel" });
  const fired = await listenFor("editor-window");
  const field = document.body.appendChild(document.createElement("textarea"));
  const press = new KeyboardEvent("keydown", {
    code: "KeyE",
    key: "´",
    altKey: true,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  press.getModifierState = (name: string) => name === "AltGraph";
  field.dispatchEvent(press);
  expect(fired).toHaveBeenCalledOnce();
});

it("still opens the editor window on Ctrl+Alt+E outside a field", async () => {
  const fired = await listenFor("editor-window");
  const outside = document.body.appendChild(document.createElement("div"));
  outside.dispatchEvent(
    new KeyboardEvent("keydown", {
      code: "KeyE",
      key: "e",
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  expect(fired).toHaveBeenCalledOnce();
});

it("leaves an AltGr character to a rich text field", async () => {
  const { handOver } = await import("./shortcuts");
  const field = document.body.appendChild(document.createElement("div"));
  field.contentEditable = "true";
  const press = altGr("KeyK", "&");
  field.addEventListener("keydown", (e) => expect(handOver(e)).toBe(false));
  field.dispatchEvent(press);
  expect(press.defaultPrevented).toBe(false);
});
