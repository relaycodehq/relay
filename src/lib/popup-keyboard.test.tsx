// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Popover } from "@base-ui/react/popover";
import { Toast } from "@base-ui/react/toast";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keyboardPopups } from "./popup-keyboard";
import { bindings, popupOpen, useShortcut } from "./shortcuts";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

function surface(html: string) {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

describe("keyboard ownership", () => {
  it.each([
    "dialog open",
    'div role="dialog"',
    'div role="alertdialog"',
    'div role="menu"',
  ])("protects an active %s", (tag) => {
    surface(`<${tag}></${tag.split(" ")[0]}>`);
    expect(popupOpen()).toBe(true);
  });

  it.each([
    "hidden",
    "inert",
    'aria-hidden="true"',
    "data-closed",
    'style="display:none"',
    'style="visibility:hidden"',
  ])("ignores inactive surfaces and ancestors: %s", (attribute) => {
    surface(`<div ${attribute}><div role="dialog"></div></div>`);
    expect(popupOpen()).toBe(false);
  });

  it("ignores closed native dialogs even with an explicit role", () => {
    surface('<dialog role="dialog"></dialog>');
    expect(popupOpen()).toBe(false);
  });

  it("keeps Settings protected but lets its own Escape handler exclude the page", () => {
    surface('<section class="settings-screen"></section>');
    expect(popupOpen()).toBe(true);
    expect(keyboardPopups(false)).toEqual([]);
  });

  it("lets passive cards coexist with shortcuts, protects focus and nested menus", () => {
    const host = surface(
      '<div role="dialog" data-shortcut-passive><button>Action</button></div>',
    );
    expect(popupOpen()).toBe(false);
    host.querySelector("button")!.focus();
    expect(popupOpen()).toBe(true);
    (document.activeElement as HTMLElement).blur();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    host.firstElementChild!.append(menu);
    expect(keyboardPopups()).toEqual([menu]);
  });
});

it("new-thread works with a real Base UI toast mounted", async () => {
  const fire = vi.fn();
  function Probe() {
    useShortcut("new-thread", true, fire);
    return (
      <Toast.Provider>
        <Toast.Viewport>
          <Toast.Root
            toast={{ id: "update", title: "OpenCode update" }}
            data-shortcut-passive
          >
            <Toast.Title>OpenCode update</Toast.Title>
            <button>Update</button>
          </Toast.Root>
        </Toast.Viewport>
      </Toast.Provider>
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Probe />));
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  const combo = bindings("new-thread")[0]!;
  const pressNew = () =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        code: combo.code,
        metaKey: combo.meta,
        ctrlKey: combo.ctrl,
        altKey: combo.alt,
        shiftKey: combo.shift,
        bubbles: true,
        cancelable: true,
      }),
    );
  pressNew();
  expect(fire).toHaveBeenCalledOnce();
  // Focusing an action deliberately gives the toast its keyboard.
  host.querySelector("button")!.focus();
  pressNew();
  expect(fire).toHaveBeenCalledOnce();
});

it("a real passive popover only blocks while focused; a nested dialog still blocks", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <Popover.Root defaultOpen>
        <Popover.Trigger openOnHover>Usage</Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner>
            <Popover.Popup data-shortcut-passive initialFocus={false}>
              <button>Refresh</button>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>,
    ),
  );
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(popupOpen()).toBe(false);
  document.querySelector<HTMLButtonElement>('[role="dialog"] button')!.focus();
  expect(popupOpen()).toBe(true);
  (document.activeElement as HTMLElement).blur();
  surface('<div role="alertdialog" aria-modal="true"></div>');
  expect(popupOpen()).toBe(true);
});
