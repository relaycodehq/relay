// @vitest-environment happy-dom
import { createElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { mount, flush } from "../../../tests/unit/hook-harness";
import { emptyProgress, type Pull } from "../../../shared/types";
import { api } from "../../lib/api";
import { useReviewProgress } from "./useReviewProgress";
import { useViewedCarryOver } from "./useViewedCarryOver";

vi.mock("../../lib/api", () => ({
  api: { progress: vi.fn(), saveProgress: vi.fn(), changedBetween: vi.fn() },
}));

afterEach(() => vi.clearAllMocks());
const base = "a".repeat(40),
  oldHead = "b".repeat(40),
  head = "c".repeat(40);
const pull = {
  server: "https://github.com",
  owner: "team",
  name: "repo",
  number: 1,
  merge_base: base,
  head: { sha: head },
} as Pull;

function review(read: Record<string, string>, selected = pull) {
  vi.mocked(api.progress).mockResolvedValue({ ...emptyProgress(), read });
  vi.mocked(api.saveProgress).mockResolvedValue(undefined);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = mount(
    () => {
      const progress = useReviewProgress(selected, (e) => {
        throw e;
      });
      const changed = useViewedCarryOver(selected, selected, progress);
      return { progress: progress.progress, changed };
    },
    (child) => createElement(QueryClientProvider, { client }, child),
  );
  return result;
}

it("carries only unchanged files between heads with the same merge base", async () => {
  vi.mocked(api.changedBetween).mockResolvedValue(["changed.ts"]);
  const old = `${base}:${oldHead}`;
  const current = `${base}:${head}`;
  const result = review({
    "same.ts": old,
    "changed.ts": old,
    "new.ts": current,
  });
  await flush();
  expect(api.changedBetween).toHaveBeenCalledExactlyOnceWith(
    pull,
    oldHead,
    head,
  );
  expect(result().progress.read).toEqual({
    "same.ts": current,
    "changed.ts": old,
    "new.ts": current,
  });
  expect(result().changed).toEqual(new Set(["changed.ts"]));
  expect(api.saveProgress).toHaveBeenCalledTimes(1);
});

it("keeps marks at their original revision when the merge base changes, even with an unchanged head", async () => {
  vi.mocked(api.changedBetween).mockResolvedValue([]);
  const read = {
    "old.ts": `${"d".repeat(40)}:${oldHead}`,
    "same-head.ts": `${"d".repeat(40)}:${head}`,
    "invalid.ts": `${base}:bad`,
  };
  const result = review(read);
  await flush();
  expect(result().progress.read).toEqual(read);
  expect(api.changedBetween).not.toHaveBeenCalled();
  expect(api.saveProgress).not.toHaveBeenCalled();
});

it("keeps marks unviewed when the comparison is unavailable", async () => {
  vi.mocked(api.changedBetween).mockRejectedValue(
    new Error("old commit unavailable"),
  );
  const read = { "same.ts": `${base}:${oldHead}` };
  const result = review(read);
  await flush();
  expect(api.changedBetween).toHaveBeenCalledTimes(1);
  expect(result().progress.read).toEqual(read);
  expect(api.saveProgress).not.toHaveBeenCalled();
  expect(result().changed.size).toBe(0);
});
