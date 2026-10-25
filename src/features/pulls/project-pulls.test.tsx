// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import type { Project } from "../../../shared/projects";
import type { Account, Issue, ProjectPull } from "../../../shared/types";
import { api } from "../../lib/api";
import {
  PULL_BOARD,
  projectPullPage,
  useProjectPullAccount,
  useProjectPulls,
} from "./project-pulls";
import { usePullBoard } from "./usePullBoard";

vi.mock("../../lib/api", () => ({
  api: {
    projectPulls: vi.fn(),
    bootstrap: vi.fn(),
    hostAccount: vi.fn(),
    search: vi.fn(async () => ({ items: [], nextPage: null })),
    reviews: vi.fn(),
    progress: vi.fn(),
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.clearAllMocks());

const account: Account = {
  id: "gitea",
  server: "https://git.example",
  user: { id: 1, login: "me" },
  persistent: true,
};

const project: Project = {
  id: "project",
  path: "/project",
  name: "Project",
  added: 0,
  repository: { server: account.server, owner: "team", name: "repo" },
};

const pull = (
  number: number,
  title: string,
): ProjectPull & Pick<Issue, "repository"> => ({
  id: number,
  repository: {
    owner: "team",
    name: "repo",
    full_name: "team/repo",
    server: account.server,
  },
  number,
  title,
  owner: "team",
  name: "repo",
  server: account.server,
  user: { id: 2, login: "someone" },
  state: "open",
  draft: false,
  merged: false,
  pull_request: { merged: false },
  comments: 0,
  body: "",
  html_url: "",
  updated_at: "2026-10-21T00:00:00Z",
  labels: [],
  head: { ref: "feature", sha: "a".repeat(40), repo: null },
  base: { ref: "main", sha: "b".repeat(40), repo: null },
  merge_base: "b".repeat(40),
});

const tick = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

it("shares requests, pagination and refresh between the board, repository and picker", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const root = createRoot(document.createElement("div"));
  vi.mocked(api.bootstrap).mockResolvedValue({ account } as Awaited<
    ReturnType<typeof api.bootstrap>
  >);
  let revision = "initial";
  vi.mocked(api.projectPulls).mockImplementation(async (_id, _state, page) => ({
    items: [pull(page ?? 1, `${revision}-${page}`)],
    nextPage: page === 1 ? 2 : null,
  }));
  let board!: ReturnType<typeof usePullBoard>;
  let repo!: ReturnType<typeof useProjectPulls>;
  let picker!: ReturnType<typeof useProjectPulls>;
  function Probe() {
    board = usePullBoard([account], [project], "open");
    repo = useProjectPulls(project, account, "open");
    const resolved = useProjectPullAccount(project);
    picker = useProjectPulls(
      project,
      resolved.account,
      "open",
      !resolved.pending,
    );
    return null;
  }
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    ),
  );
  try {
    await tick();
    await vi.waitFor(async () => {
      await tick();
      expect(picker.data?.pages).toHaveLength(1);
    });
    expect(api.projectPulls).toHaveBeenCalledTimes(1);
    expect(board.board.pulls[0].title).toBe("initial-1");
    await act(async () => picker.fetchNextPage());
    await tick();
    expect(repo.data?.pages).toHaveLength(2);
    expect(api.projectPulls).toHaveBeenCalledTimes(2);

    revision = "picker-refresh";
    await act(async () => picker.refetch());
    await tick();
    expect(board.board.pulls[0].title).toBe("picker-refresh-1");
    expect(repo.data?.pages.map((page) => page.items[0].title)).toEqual([
      "picker-refresh-1",
      "picker-refresh-2",
    ]);
    expect(api.projectPulls).toHaveBeenCalledTimes(4);

    revision = "board-refresh";
    await act(async () => client.invalidateQueries({ queryKey: [PULL_BOARD] }));
    await tick();
    expect(board.board.pulls[0].title).toBe("board-refresh-1");
    expect(picker.data?.pages.map((page) => page.items[0].title)).toEqual([
      "board-refresh-1",
      "board-refresh-2",
    ]);
    expect(api.projectPulls).toHaveBeenCalledTimes(6);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});

it("isolates accounts, hosts, repository changes and states even when the project id is reused", async () => {
  const client = new QueryClient();
  vi.mocked(api.projectPulls).mockResolvedValue({ items: [], nextPage: null });
  const changedAccount = { ...account, user: { id: 9, login: "other" } };
  const changedHost = {
    ...project,
    repository: { ...project.repository!, server: "https://other.example" },
  };
  const changedRepo = {
    ...project,
    repository: { ...project.repository!, name: "other" },
  };
  try {
    await client.query(projectPullPage(project, account, "open"));
    await client.query(projectPullPage(project, account, "open"));
    expect(api.projectPulls).toHaveBeenCalledTimes(1);
    await client.query(projectPullPage(project, changedAccount, "open"));
    await client.query(projectPullPage(changedHost, account, "open"));
    await client.query(projectPullPage(changedRepo, account, "open"));
    await client.query(projectPullPage(project, account, "closed"));
    expect(api.projectPulls).toHaveBeenCalledTimes(5);
  } finally {
    client.clear();
  }
});
