// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emptyProgress, type Account, type Issue } from "../../../shared/types";
import { api } from "../../lib/api";
import { useReviewProgress } from "../review/useReviewProgress";
import { usePullBoard } from "./usePullBoard";

vi.mock("../../lib/api", () => ({
  api: {
    search: vi.fn(),
    reviews: vi.fn(),
    progress: vi.fn(),
    saveProgress: vi.fn(),
  },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.clearAllMocks());

const account: Account = {
  id: "gitea-account",
  server: "https://gitea.example.invalid",
  user: { id: 1, login: "me" },
  persistent: true,
};
const issue = (author: string): Issue => ({
  id: 7,
  number: 7,
  title: "Fix",
  state: "open",
  user: { id: 2, login: author },
  repository: { owner: "team", name: "repo", full_name: "team/repo" },
  comments: 0,
  body: "",
  html_url: "",
  updated_at: "2026-10-13T10:00:00Z",
  labels: [],
  pull_request: { merged: false },
});
const tick = async () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

it("shares canonical progress with the review when Gitea search omits the server", async () => {
  vi.mocked(api.search).mockImplementation(async (filter) => ({
    items: filter === "review_requested" ? [issue("someone")] : [],
    nextPage: null,
  }));
  vi.mocked(api.progress).mockResolvedValue(emptyProgress());
  vi.mocked(api.saveProgress).mockResolvedValue(undefined);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(document.createElement("div"));
  let board!: ReturnType<typeof usePullBoard>;
  let review!: ReturnType<typeof useReviewProgress>;
  function Probe() {
    board = usePullBoard(account, [], "open");
    review = useReviewProgress(board.board.pulls[0]?.ref ?? null, () => {});
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
      expect(review.initial.isSuccess).toBe(true);
    });
    await act(async () => {
      review.update((progress) => ({
        ...progress,
        read: { "a.ts": "base:head" },
      }));
    });
    await vi.waitFor(async () => {
      await tick();
      expect(board.started.has("team/repo#7")).toBe(true);
    });
    expect(api.progress).toHaveBeenCalledTimes(1);
    expect(api.progress).toHaveBeenCalledWith({
      server: account.server,
      owner: "team",
      name: "repo",
      number: 7,
    });
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
