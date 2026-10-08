import { it, expect, vi } from "vitest";
import type { PullHost } from "./host";
import { mergedPulls } from "./merged";

const repo = { owner: "acme", name: "app" };

function host(pages: { number: number; merged: boolean }[][]) {
  const page = vi.fn(async (_repo: unknown, _state: string, n: number) => ({
    items: pages[n - 1] ?? [],
    nextPage: n < pages.length ? n + 1 : null,
  }));
  return { client: { pulls: page } as unknown as PullHost, page };
}

it("finds the wanted merged PRs among the recently closed ones and ignores closed-unmerged", async () => {
  const { client, page } = host([
    [
      { number: 7, merged: true },
      { number: 8, merged: false },
      { number: 9, merged: true },
    ],
  ]);
  const signal = new AbortController().signal;
  expect(await mergedPulls(client, repo, [7, 8], signal)).toEqual([7]);
  expect(page).toHaveBeenCalledTimes(1);
  expect(page.mock.calls[0]![1]).toBe("closed");
});

it("stops paging once every wanted PR was seen, and after a few pages otherwise", async () => {
  const full = host([
    [{ number: 1, merged: true }],
    [{ number: 2, merged: true }],
  ]);
  await mergedPulls(full.client, repo, [1], new AbortController().signal);
  expect(full.page).toHaveBeenCalledTimes(1);

  const deep = host(Array.from({ length: 10 }, () => []));
  await mergedPulls(deep.client, repo, [99], new AbortController().signal);
  expect(deep.page.mock.calls.length).toBeLessThan(5);
});
