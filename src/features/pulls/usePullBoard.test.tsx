// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  emptyProgress,
  type Account,
  type Issue,
  type Review,
} from "../../../shared/types";
import { api } from "../../lib/api";
import { useReviewProgress } from "../review/useReviewProgress";
import { PULL_BOARD, usePullBoard } from "./usePullBoard";
import type { Project } from "../../../shared/projects";

vi.mock("../../lib/api", () => ({
  api: {
    search: vi.fn(),
    reviews: vi.fn(),
    progress: vi.fn(),
    saveProgress: vi.fn(),
    projectPulls: vi.fn(),
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

const accounts = [account];

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

async function observe(hosts: Account[], projects: Project[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(document.createElement("div"));
  let current!: ReturnType<typeof usePullBoard>;
  function Probe() {
    current = usePullBoard(hosts, projects, "open");
    return null;
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  return {
    client,
    get current() {
      return current;
    },
    async close() {
      await act(async () => root.unmount());
      client.clear();
    },
  };
}

it("shows a healthy host while another is pending, then retries only the failed host", async () => {
  const github: Account = {
    ...account,
    id: "github",
    server: "https://github.com",
  };
  let refuse!: (error: Error) => void;
  const held = new Promise<never>((_, reject) => {
    refuse = reject;
  });
  let recovered = false;
  vi.mocked(api.search).mockImplementation(
    async (filter, _q, _state, _page, server) => {
      if (server === account.server && !recovered) return held;
      return {
        items:
          filter === "assigned"
            ? [
                {
                  ...issue("someone"),
                  number: server === github.server ? 7 : 8,
                },
              ]
            : [],
        nextPage: null,
      };
    },
  );
  const view = await observe([account, github]);
  try {
    await vi.waitFor(async () => {
      await tick();
      expect(view.current.board.pulls).toHaveLength(1);
    });
    expect(view.current.loading).toBe(false);
    expect(view.current.pending).toEqual([account.server]);
    await act(async () => refuse(new Error("Network unavailable")));
    await vi.waitFor(async () => {
      await tick();
      expect(view.current.failures).toEqual([
        { server: account.server, error: expect.any(Error) },
      ]);
    });
    expect(view.current.board.pulls).toHaveLength(1);
    recovered = true;
    await act(async () => view.current.retry(account.server));
    await vi.waitFor(async () => {
      await tick();
      expect(view.current.board.pulls).toHaveLength(2);
      expect(view.current.pending).toEqual([]);
      expect(view.current.failures).toEqual([]);
    });
    expect(
      vi
        .mocked(api.search)
        .mock.calls.filter((call) => call[4] === github.server),
    ).toHaveLength(3);
  } finally {
    await view.close();
  }
});

it("doesn't treat an empty healthy host as an empty board while another is pending", async () => {
  const github: Account = {
    ...account,
    id: "github",
    server: "https://github.com",
  };
  vi.mocked(api.search).mockImplementation(
    async (_filter, _q, _state, _page, server) =>
      server === github.server
        ? { items: [], nextPage: null }
        : new Promise(() => {}),
  );
  const view = await observe([account, github]);
  try {
    await tick();
    expect(view.current.pending).toEqual([account.server]);
    expect(view.current.loading).toBe(true);
  } finally {
    await view.close();
  }
});

it("keeps a project's listing visible while searches or a failed refresh leave it incomplete", async () => {
  vi.mocked(api.search).mockImplementation(() => new Promise(() => {}));
  const branch = { ref: "main", sha: "a".repeat(40), repo: null };
  vi.mocked(api.projectPulls).mockResolvedValue({
    items: [
      {
        ...issue("someone"),
        owner: "team",
        name: "repo",
        server: account.server,
        draft: false,
        merged: false,
        pull_request: { merged: false },
        head: branch,
        base: branch,
        merge_base: branch.sha,
      },
    ],
    nextPage: null,
  });
  const project: Project = {
    id: "project",
    name: "Project",
    path: "/sample",
    added: 0,
    repository: { server: account.server, owner: "team", name: "repo" },
  };
  const view = await observe(accounts, [project]);
  try {
    await vi.waitFor(async () => {
      await tick();
      expect(view.current.board.pulls).toHaveLength(1);
    });
    expect(view.current.loading).toBe(false);
    expect(view.current.pending).toEqual([account.server]);
    vi.mocked(api.projectPulls).mockRejectedValue(new Error("Offline"));
    await act(async () => {
      await view.client.invalidateQueries({
        queryKey: [PULL_BOARD, "project", project.id],
      });
    });
    await vi.waitFor(async () => {
      await tick();
      expect(view.current.failures).toHaveLength(1);
    });
    expect(view.current.board.pulls).toHaveLength(1);
    expect(view.current.loading).toBe(false);
  } finally {
    await view.close();
  }
});

const tick = async () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

it("uses the latest reviewer verdict even when it occurs on a later page", async () => {
  vi.mocked(api.search).mockImplementation(async (filter) => ({
    items: filter === "created" ? [issue("me")] : [],
    nextPage: null,
  }));
  const approval = {
    id: 1,
    user: { id: 2, login: "reviewer" },
    state: "APPROVED",
    submitted_at: "2026-10-01T00:00:00Z",
  } as Review;
  const changes = {
    ...approval,
    id: 51,
    state: "REQUEST_CHANGES",
    submitted_at: "2026-10-02T00:00:00Z",
  } as Review;
  vi.mocked(api.reviews).mockImplementation(async (_ref, page) => ({
    items: page === 1 ? [approval] : [changes],
    nextPage: page === 1 ? 2 : null,
  }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(document.createElement("div"));
  let current!: ReturnType<typeof usePullBoard>;
  function Probe() {
    current = usePullBoard(accounts, [], "open");
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
      expect(current.verdicts.get(`${account.server}|team/repo#7`)).toBe(
        "changes",
      );
    });
    expect(vi.mocked(api.reviews).mock.calls.map(([, page]) => page)).toEqual([
      1, 2,
    ]);
    expect(current.board.pulls[0].ref.server).toBe(account.server);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
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
    board = usePullBoard(accounts, [], "open");
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
      expect(board.started.has(`${account.server}|team/repo#7`)).toBe(true);
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
