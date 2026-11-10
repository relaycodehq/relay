// @vitest-environment happy-dom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { mac } from "../../lib/mod-key";
import { useEditorSearch } from "./useEditorSearch";

let root: Root | undefined;
let search: ReturnType<typeof useEditorSearch> | undefined;

function mount(active = true) {
  const host = document.createElement("div");
  const pane = createRef<HTMLDivElement>();
  host.innerHTML =
    '<div id="pane"><input id="inside" /></div><input id="outside" />';
  document.body.append(host);
  (pane as { current: HTMLElement }).current = host.querySelector("#pane")!;
  function Probe() {
    search = useEditorSearch({ active, pane });
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root!.render(<Probe />));
  return host;
}

const press = (target: HTMLElement, over: { prevented?: boolean } = {}) => {
  target.focus();
  const event = new KeyboardEvent("keydown", {
    code: "KeyF",
    key: "F",
    shiftKey: true,
    metaKey: mac,
    ctrlKey: !mac,
    bubbles: true,
    cancelable: true,
  });
  // An editor that handled the key has already prevented its default.
  if (over.prevented) event.preventDefault();
  act(() => void target.dispatchEvent(event));
};

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  search = undefined;
  document.body.innerHTML = "";
});

it("opens Find in Files from the pane when no editor has the key", () => {
  const host = mount();
  press(host.querySelector<HTMLElement>("#inside")!);
  expect(search?.finding).toMatchObject({ replace: false });
  expect(search?.finding?.query).toBeUndefined();
});

it("leaves a key an editor handled to the editor", () => {
  const host = mount();
  press(host.querySelector<HTMLElement>("#inside")!, { prevented: true });
  expect(search?.finding).toBeUndefined();
});

it("stays out of the chat beside the pane and of a hidden Files tab", () => {
  const host = mount();
  press(host.querySelector<HTMLElement>("#outside")!);
  expect(search?.finding).toBeUndefined();
  act(() => root?.unmount());
  const hidden = mount(false);
  press(hidden.querySelector<HTMLElement>("#inside")!);
  expect(search?.finding).toBeUndefined();
});
