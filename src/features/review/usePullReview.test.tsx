// @vitest-environment happy-dom
import { expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emptyProgress, type Account } from "../../../shared/types";
import { api } from "../../lib/api";
import { usePullSelection } from "./usePullSelection";
import { usePullReview } from "./usePullReview";

vi.mock("../../lib/api", () => ({
  api: {
    pull: vi.fn(),
    progress: vi.fn(),
    saveProgress: vi.fn(),
    files: vi.fn(),
    triageState: vi.fn(),
  },
}));

vi.mock("../checks/useProjectChecks", () => ({ useProjectChecks: () => ({}) }));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

it("resolves saved refs without a server to the account and shares their cache with explicit refs", async () => {
  const account: Account = {
    id: "gitea-account",
    server: "https://gitea.example.invalid",
    user: { id: 1, login: "me" },
    persistent: true,
  };
  const ref = { owner: "team", name: "repo", number: 7 };
  vi.mocked(api.pull).mockResolvedValue({
    ...ref,
    head: { sha: "head" },
    merge_base: "base",
    state: "open",
  } as never);
  vi.mocked(api.progress).mockResolvedValue(emptyProgress());
  vi.mocked(api.files).mockResolvedValue({ items: [], nextPage: null });
  vi.mocked(api.triageState).mockResolvedValue(null);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const root = createRoot(document.createElement("div"));
  let selection!: ReturnType<typeof usePullSelection>;
  let review!: ReturnType<typeof usePullReview>;
  function Probe() {
    selection = usePullSelection(ref, null, false);
    review = usePullReview(selection, account, () => {});
    return null;
  }
  const settled = async () =>
    vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(review.pull.isSuccess).toBe(true);
      expect(review.progress.initial.isSuccess).toBe(true);
    });
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe />
        </QueryClientProvider>,
      ),
    );
    await settled();
    expect(api.pull).toHaveBeenCalledWith({ ...ref, server: account.server });
    expect(review.pull.data?.server).toBe(account.server);
    await act(async () => {
      selection.select({ ...ref, server: account.server });
    });
    await settled();
    expect(api.progress).toHaveBeenCalledTimes(1);
    expect(
      client.getQueriesData({ queryKey: ["progress"] }).map(([key]) => key),
    ).toEqual([["progress", account.server, "team", "repo", 7]]);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
