// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { mount, update } from "../../../tests/unit/hook-harness";
import { usePullSelection } from "./usePullSelection";

it("switches to the same repository and PR number on another host", () => {
  const first = {
    server: "https://gitea.example.invalid",
    owner: "team",
    name: "repo",
    number: 7,
  };
  const second = { ...first, server: "https://github.com" };
  const selection = mount(() => usePullSelection(first, "a.ts", false));
  update(() => selection().select(second));
  expect(selection().selected).toEqual(second);
  expect(selection().file).toBeNull();
  expect(selection().navigation.current).toBe(1);
});

it("invalidates a pending navigation when unmounted and starts a fresh selection on reopen", () => {
  const pull = {
    server: "https://github.com",
    owner: "team",
    name: "repo",
    number: 7,
  };
  const selection = mount(() => usePullSelection(pull, "first.ts", false));
  const pendingNavigation = selection().navigation;
  const request = pendingNavigation.current;
  selection.unmount();
  // The real review's pending async page/group requests use this identity guard.
  expect(pendingNavigation.current).not.toBe(request);
  const reopened = mount(() => usePullSelection(pull, "saved.ts", true));
  expect(reopened().navigation).not.toBe(pendingNavigation);
  expect(reopened().navigation.current).toBe(0);
  expect(reopened().restoring).toBe(true);
  update(() => reopened().restored(true));
  expect(reopened().restoring).toBe(false);
  expect(reopened().file).toBe("saved.ts");
});
