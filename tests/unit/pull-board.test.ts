import { expect, it } from "vitest";
import {
  buildBoard,
  needsYou,
  projectFor,
  pullsLocation,
  verdictOf,
  type BoardInput,
} from "../../src/lib/pull-board";
import type { Project } from "../../shared/projects";
import type { Issue, Review } from "../../shared/types";

const server = "https://git.example.dev";
const project = (id: string, owner: string, name: string, extra = {}) =>
  ({
    id,
    name: id,
    path: `/Users/me/${id}`,
    repository: { server, owner, name },
    added: 0,
    ...extra,
  }) as Project;
const issue = (
  repo: string,
  number: number,
  author = "anna",
  updated = "2026-09-30T10:00:00Z",
) => {
  const [owner, name] = repo.split("/");
  return {
    id: number,
    number,
    title: `PR ${number}`,
    state: "open",
    updated_at: updated,
    user: { id: 1, login: author },
    repository: { owner, name, full_name: repo },
    comments: 0,
    labels: [],
    pull_request: { merged: false },
  } as unknown as Issue;
};
const input = (over: Partial<BoardInput>): BoardInput => ({
  server,
  login: "Me",
  projects: [],
  review: [],
  assigned: [],
  created: [],
  lists: {},
  ...over,
});

it("files each PR once, yours before a review request before an assignment", () => {
  const board = buildBoard(
    input({
      review: [issue("web/portal", 1), issue("web/portal", 2, "me")],
      assigned: [issue("web/portal", 1), issue("web/portal", 3)],
      created: [issue("web/portal", 2, "me")],
    }),
  );
  expect(
    Object.fromEntries(board.pulls.map((p) => [p.ref.number, p.relation])),
  ).toEqual({ 1: "review", 2: "mine", 3: "assigned" });
});

it("matches a project to its repository on the same server, whatever the letter case", () => {
  const portal = project("portal", "Web", "Portal");
  const elsewhere = project("other", "web", "portal", {
    repository: { server: "https://other.dev", owner: "web", name: "portal" },
  });
  expect(
    projectFor([elsewhere, portal], server, { owner: "web", name: "portal" }),
  ).toBe(portal);
  expect(
    projectFor(
      [project("scratch", "web", "portal", { scratch: true })],
      server,
      {
        owner: "web",
        name: "portal",
      },
    ),
  ).toBeUndefined();
});

it("puts PRs from a project's list and the searches on one card per repository", () => {
  const board = buildBoard(
    input({
      projects: [
        project("portal", "web", "portal"),
        project("quiet", "web", "quiet"),
      ],
      review: [issue("web/portal", 9), issue("infra/deploy", 4)],
      lists: {
        portal: {
          items: [issue("web/portal", 7), issue("web/portal", 9)],
          total: 60,
        },
        quiet: { items: [], total: 0 },
      },
    }),
  );
  expect(board.groups.map((g) => [g.repo, g.project?.id, g.total])).toEqual([
    ["infra/deploy", undefined, 1],
    ["web/portal", "portal", 60],
  ]);
  expect(board.groups[1].pulls.map((p) => p.ref.number).sort()).toEqual([7, 9]);
  expect(board.quiet.map((p) => p.id)).toEqual(["quiet"]);
});

it("orders cards by PRs waiting on you, then your own, then the latest activity", () => {
  const board = buildBoard(
    input({
      review: [issue("a/waits", 1, "anna", "2026-09-01T00:00:00Z")],
      created: [
        issue("b/mine", 2, "me", "2026-09-02T00:00:00Z"),
        issue("c/recent", 3, "me", "2026-09-29T00:00:00Z"),
        issue("c/recent", 4, "me", "2026-09-29T00:00:00Z"),
      ],
      assigned: [issue("d/new", 5, "anna", "2026-09-30T00:00:00Z")],
    }),
  );
  // d/new has one assigned PR, like a/waits; it wins on recency.
  expect(board.groups.map((g) => g.repo)).toEqual([
    "d/new",
    "a/waits",
    "c/recent",
    "b/mine",
  ]);
});

it("keeps a project whose list fails, with its error, instead of dropping it", () => {
  const board = buildBoard(
    input({
      projects: [project("portal", "web", "portal")],
      lists: { portal: { error: new Error("The clone no longer matches") } },
    }),
  );
  expect(board.groups).toHaveLength(1);
  expect(board.groups[0].error).toBeInstanceOf(Error);
  expect(board.quiet).toEqual([]);
});

const review = (
  id: number,
  user: number,
  state: string,
  at: string,
  extra: Partial<Review> = {},
) =>
  ({
    id,
    state,
    user: { id: user, login: `u${user}` },
    submitted_at: at,
    ...extra,
  }) as Review;

it("takes each reviewer's latest verdict", () => {
  expect(
    verdictOf([
      review(1, 7, "REQUEST_CHANGES", "2026-09-01T00:00:00Z"),
      review(2, 7, "COMMENT", "2026-09-03T00:00:00Z"),
      review(3, 7, "APPROVED", "2026-09-02T00:00:00Z"),
    ]),
  ).toBe("approved");
  expect(
    verdictOf([
      review(1, 7, "APPROVED", "2026-09-01T00:00:00Z"),
      review(2, 8, "REQUEST_CHANGES", "2026-09-02T00:00:00Z"),
    ]),
  ).toBe("changes");
});

it("ignores dismissed reviews and approvals of older commits, but not stale change requests", () => {
  expect(
    verdictOf([
      review(1, 7, "APPROVED", "2026-09-01T00:00:00Z", { stale: true }),
      review(2, 8, "REQUEST_CHANGES", "2026-09-02T00:00:00Z", {
        dismissed: true,
      }),
    ]),
  ).toBeNull();
  expect(
    verdictOf([
      review(1, 7, "REQUEST_CHANGES", "2026-09-01T00:00:00Z", { stale: true }),
    ]),
  ).toBe("changes");
});

it("asks for you on requests and assignments, and on your own PRs only once reviewed", () => {
  const [requested, mine, draft] = buildBoard(
    input({
      review: [issue("web/portal", 1)],
      created: [
        issue("web/portal", 2, "me"),
        { ...issue("web/portal", 3, "me"), title: "WIP: later" },
      ],
    }),
  ).pulls.sort((a, b) => a.ref.number - b.ref.number);
  expect(needsYou(requested)).toBe(true);
  expect(needsYou(mine, null)).toBe(false);
  expect(needsYou(mine, "changes")).toBe(true);
  expect(needsYou(draft, "approved")).toBe(false);
});

it("names the page's place after the project a repository is cloned to", () => {
  const projectOf = (r: { owner: string; name: string }) =>
    r.owner === "web" && r.name === "portal"
      ? project("Portal", "web", "portal")
      : undefined;
  const ref = { owner: "web", name: "portal", number: 7 };
  expect(pullsLocation(ref, "Fix it", "other/repo", projectOf)).toEqual({
    repo: { key: "web/portal", label: "Portal" },
    pull: { number: 7, title: "Fix it" },
  });
  expect(
    pullsLocation({ ...ref, owner: "Ops" }, undefined, null, projectOf),
  ).toEqual({
    repo: { key: "ops/portal", label: "Ops/portal" },
    pull: { number: 7, title: undefined },
  });
  expect(pullsLocation(null, undefined, "web/portal", projectOf).repo).toEqual({
    key: "web/portal",
    label: "Portal",
  });
  expect(pullsLocation(null, undefined, "ops/tools", projectOf)).toEqual({
    repo: { key: "ops/tools", label: "ops/tools" },
    pull: null,
  });
  expect(pullsLocation(null, undefined, null, projectOf)).toEqual({
    repo: null,
    pull: null,
  });
});
