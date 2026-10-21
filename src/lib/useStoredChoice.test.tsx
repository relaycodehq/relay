// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useStoredChoice } from "./persisted-store";
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let choice: ReturnType<typeof useStoredChoice<"mb" | "cpu">>;
function Probe() {
  choice = useStoredChoice("order", ["mb", "cpu"] as const, "mb");
  return null;
}
const mount = async () => {
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(<Probe />));
};
beforeEach(() => localStorage.clear());
afterEach(async () => act(async () => root.unmount()));

it("starts from the saved choice and saves a new one as plain text", async () => {
  localStorage.setItem("order", "cpu");
  await mount();
  expect(choice[0]).toBe("cpu");
  await act(async () => choice[1]("mb"));
  expect(choice[0]).toBe("mb");
  expect(localStorage.getItem("order")).toBe("mb");
});

it("falls back when what was saved isn't one of the choices", async () => {
  localStorage.setItem("order", '"cpu"');
  await mount();
  expect(choice[0]).toBe("mb");
});
