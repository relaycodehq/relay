import { expect, it, vi } from "vitest";
import {
  harnessReact,
  mount,
  rerender,
} from "../../../tests/unit/hook-harness";
import { usePullSelection } from "./usePullSelection";

vi.mock("react", () => harnessReact);

it("switches to the same repository and PR number on another host", () => {
  const first = {
    server: "https://gitea.example.invalid",
    owner: "team",
    name: "repo",
    number: 7,
  };
  const second = { ...first, server: "https://github.com" };
  const selection = mount(() => usePullSelection(first, "a.ts", false));
  selection().select(second);
  rerender();
  expect(selection().selected).toEqual(second);
  expect(selection().file).toBeNull();
  expect(selection().navigation.current).toBe(1);
});
