// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { emptyProgress, type Draft, type PullRef } from "../../../shared/types";
import { api } from "../../lib/api";
import { useReviewProgress } from "./useReviewProgress";

vi.mock("../../lib/api", () => ({
  api: { progress: vi.fn(), saveProgress: vi.fn() },
}));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.clearAllMocks());

it("loads and saves each host's drafts separately when the repository and PR number match", async () => {
  const first: PullRef = {
    server: "https://gitea.example.invalid",
    owner: "team",
    name: "repo",
    number: 7,
  };
  const second = { ...first, server: "https://github.com" };
  const draft = (id: string): Draft => ({
    id,
    path: "a.ts",
    line: 1,
    side: "additions",
    body: id,
    revision: "base:head",
    createdAt: "2026-10-13T10:00:00Z",
  });
  const stored = new Map([
    [
      first.server,
      { ...emptyProgress(), reviewBody: "Gitea", drafts: [draft("gitea")] },
    ],
    [
      second.server,
      { ...emptyProgress(), reviewBody: "GitHub", drafts: [draft("github")] },
    ],
  ]);
  vi.mocked(api.progress).mockImplementation(async (ref) =>
    structuredClone(stored.get(ref.server)!),
  );
  vi.mocked(api.saveProgress).mockResolvedValue(undefined);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(document.createElement("div"));
  let current!: ReturnType<typeof useReviewProgress>;
  function Probe({ pull }: { pull: PullRef }) {
    current = useReviewProgress(pull, (error) => {
      throw error;
    });
    return null;
  }
  const show = async (pull: PullRef) => {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <Probe pull={pull} />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(current.initial.isSuccess).toBe(true);
    });
  };
  try {
    await show(first);
    expect(current.progress.reviewBody).toBe("Gitea");
    await show(second);
    expect(current.progress.reviewBody).toBe("GitHub");
    await act(async () => {
      current.update((progress) => ({
        ...progress,
        reviewBody: "Edited GitHub",
      }));
    });
    expect(
      vi.mocked(api.progress).mock.calls.map(([ref]) => ref.server),
    ).toEqual([first.server, second.server]);
    expect(api.saveProgress).toHaveBeenCalledWith(
      second,
      expect.objectContaining({
        reviewBody: "Edited GitHub",
        drafts: [draft("github")],
      }),
    );
    await show(first);
    expect(current.progress.reviewBody).toBe("Gitea");
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
