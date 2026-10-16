// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Account, Issue } from "../../../shared/types";
import { api } from "../../lib/api";
import { PullRequestsPage } from "./PullRequestsPage";

vi.mock("../../lib/api", () => ({ api: { search: vi.fn() } }));
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.clearAllMocks());

const account: Account = {
  id: "https://github.com",
  server: "https://github.com",
  user: { id: 1, login: "me" },
  persistent: true,
};
const issue = (number: number): Issue => ({
  id: number,
  number,
  title: `Pull ${number}`,
  state: "open",
  user: { id: 2, login: "other" },
  repository: {
    server: account.server,
    owner: "team",
    name: "repo",
    full_name: "team/repo",
  },
  comments: 0,
  body: "",
  html_url: "",
  updated_at: "2026-10-13T10:00:00Z",
  labels: [],
  pull_request: { merged: false },
});
const noop = () => {};
const tick = async () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

it("loads search results after the first fifty and keeps loaded rows when the next page fails", async () => {
  let available = false;
  vi.mocked(api.search).mockImplementation(
    async (filter, _query, _state, page) => {
      if (filter !== "all") return { items: [], nextPage: null };
      if (page === 2 && !available) throw new Error("Next page unavailable");
      return {
        items:
          page === 1
            ? Array.from({ length: 50 }, (_, index) => issue(index + 1))
            : [issue(51)],
        total: 51,
        nextPage: page === 1 ? 2 : null,
      };
    },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const container = document.createElement("div");
  const root = createRoot(container);
  const button = (text: string) =>
    [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes(text),
    );
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <PullRequestsPage
            accounts={[account]}
            onRecheckHosts={noop}
            projects={[]}
            repo={null}
            onRepo={noop}
            query="fixture"
            onQuery={noop}
            state="open"
            onState={noop}
            onOpen={noop}
            onOpenUrl={noop}
            onOpenProject={noop}
            onAddProject={noop}
          />
        </QueryClientProvider>,
      ),
    );
    await vi.waitFor(async () => {
      await tick();
      expect(container.querySelectorAll(".pulls-row")).toHaveLength(50);
    });
    expect(
      container.querySelector(".pulls-section h2 small")?.textContent,
    ).toBe("51+");
    expect(button("Load more pull requests")).toBeDefined();
    await act(async () => {
      button("Load more pull requests")!.click();
    });
    await vi.waitFor(async () => {
      await tick();
      expect(container.textContent).toContain("Next page unavailable");
    });
    expect(container.querySelectorAll(".pulls-row")).toHaveLength(50);
    available = true;
    await act(async () => {
      button("Try again")!.click();
    });
    await vi.waitFor(async () => {
      await tick();
      expect(container.querySelectorAll(".pulls-row")).toHaveLength(51);
    });
    expect(button("Load more pull requests")).toBeUndefined();
    expect(
      container.querySelector(".pulls-section h2 small")?.textContent,
    ).toBe("51");
    expect(
      vi
        .mocked(api.search)
        .mock.calls.filter(([filter]) => filter === "all")
        .map(([, , , page]) => page),
    ).toEqual([1, 2, 2]);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
