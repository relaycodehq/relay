// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Pull } from "../../../shared/types";
import { api } from "../../lib/api";
import { useReviewComments } from "./useReviewComments";

vi.mock("../../lib/api", () => ({
  api: { reviews: vi.fn(), reviewComments: vi.fn() },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.clearAllMocks());

const pull = {
  server: "https://gitea.example.invalid",
  owner: "team",
  name: "repo",
  number: 7,
  head: { sha: "a".repeat(40) },
} as Pull;

const onPaths = () => {};
const tick = async () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

it("stops after a next review page fails and allows an explicit retry", async () => {
  let available = false;
  vi.mocked(api.reviews).mockImplementation(async (_ref, page) => {
    if (page === 2 && !available) throw new Error("Page unavailable");
    return { items: [], nextPage: page === 1 ? 2 : null };
  });
  vi.mocked(api.reviewComments).mockResolvedValue([]);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(document.createElement("div"));
  let current!: ReturnType<typeof useReviewComments>;
  function Probe() {
    current = useReviewComments(pull, onPaths);
    return null;
  }
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(async () => {
      await tick();
      expect(current.reviews.isFetchNextPageError).toBe(true);
    });
    for (let count = 0; count < 5; count++) await tick();
    expect(vi.mocked(api.reviews).mock.calls.map(([, page]) => page)).toEqual([
      1, 2,
    ]);
    expect(current.reviews.data?.pages).toHaveLength(1);
    expect(current.comments.isPending).toBe(true);
    available = true;
    await act(async () => {
      await current.reviews.fetchNextPage();
    });
    await vi.waitFor(async () => {
      await tick();
      expect(current.comments.isSuccess).toBe(true);
    });
    expect(vi.mocked(api.reviews).mock.calls.map(([, page]) => page)).toEqual([
      1, 2, 2,
    ]);
    expect(current.reviews.hasNextPage).toBe(false);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});

it("does not reuse reviews or line comments from another host", async () => {
  const review = { id: 1, comments_count: 1 };
  vi.mocked(api.reviews).mockResolvedValue({
    items: [review],
    nextPage: null,
  } as never);
  vi.mocked(api.reviewComments).mockImplementation(
    async (ref) =>
      [
        { id: 2, path: ref.server === pull.server ? "gitea.ts" : "github.ts" },
      ] as never,
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const root = createRoot(document.createElement("div"));
  let current!: ReturnType<typeof useReviewComments>;
  function Probe({ ref }: { ref: Pull }) {
    current = useReviewComments(ref, onPaths);
    return null;
  }
  const show = async (ref: Pull) => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe ref={ref} />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(async () => {
      await tick();
      expect(current.comments.isSuccess).toBe(true);
    });
  };
  try {
    await show(pull);
    expect(current.comments.data?.[0].path).toBe("gitea.ts");
    await show({ ...pull, server: "https://github.com" });
    expect(current.comments.data?.[0].path).toBe("github.ts");
    expect(
      vi.mocked(api.reviews).mock.calls.map(([ref]) => ref.server),
    ).toEqual([pull.server, "https://github.com"]);
    expect(api.reviewComments).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
