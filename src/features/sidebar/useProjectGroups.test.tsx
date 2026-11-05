// @vitest-environment happy-dom
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { flush, mount } from "../../../tests/unit/hook-harness";
import { api } from "../../lib/api";
import { useProjectGroups } from "./useProjectGroups";

vi.mock("../../lib/api", () => ({
  api: {
    projectGroups: vi.fn(async () => ["a", "a/b"]),
    renameProjectGroup: vi.fn(),
    removeProjectGroup: vi.fn(),
  },
}));

afterEach(() => vi.clearAllMocks());

function setup() {
  const folds = { setOpen: vi.fn(), regroup: vi.fn() };
  const setError = vi.fn();
  const client = new QueryClient();
  const groups = mount(
    () => useProjectGroups([], folds, setError),
    (child) => createElement(QueryClientProvider, { client }, child),
  );
  return { groups, folds, setError };
}

it("keeps what's open inside a group the desktop wouldn't rename or take apart", async () => {
  vi.mocked(api.renameProjectGroup).mockRejectedValue(new Error("Taken"));
  vi.mocked(api.removeProjectGroup).mockRejectedValue(new Error("Busy"));
  const { groups, folds, setError } = setup();

  groups().renameGroup("a", "c", true);
  groups().removeGroup("a");
  await flush();

  expect(setError).toHaveBeenLastCalledWith("Busy");
  expect(folds.regroup).not.toHaveBeenCalled();
  expect(folds.setOpen).not.toHaveBeenCalled();
});

it("moves what's open inside a renamed group once the desktop has it", async () => {
  vi.mocked(api.renameProjectGroup).mockResolvedValue(undefined);
  const { groups, folds } = setup();

  groups().renameGroup("a", "c", true);
  await flush();

  expect(folds.setOpen).toHaveBeenCalledWith("folder:c", true);
  expect(folds.regroup).toHaveBeenCalledWith("a", "c");
});
