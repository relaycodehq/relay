import { describe, expect, it } from "vitest";
import {
  asChangedFile,
  asPull,
  commentId,
  commentOf,
  discussionOf,
  lineCounts,
  reviewsOf,
  threadComments,
  userId,
  voteFor,
  waitsOn,
  type AzComment,
  type AzIdentity,
  type AzIteration,
  type AzPull,
  type AzReviewer,
  type AzThread,
} from "./shapes";

const server = "https://dev.azure.com/sample-org";

const ann: AzIdentity = {
  id: "aaaa-1111",
  displayName: "Ann Example",
  uniqueName: "ann@example.com",
};

const bob: AzIdentity = { id: "bbbb-2222", displayName: "Bob Sample" };
const carol: AzIdentity = { id: "cccc-3333", uniqueName: "carol@example.com" };
const pullPage =
  "https://dev.azure.com/sample-org/Sample%20Project/_git/Web%20Store/pullrequest/42";

const pr = (over: Partial<AzPull> = {}): AzPull => ({
  pullRequestId: 42,
  status: "active",
  title: "Add search",
  description: "Searches the catalogue",
  createdBy: ann,
  creationDate: "2026-10-01T09:00:00Z",
  sourceRefName: "refs/heads/feature/search",
  targetRefName: "refs/heads/main",
  lastMergeSourceCommit: { commitId: "LISTED-HEAD" },
  lastMergeTargetCommit: { commitId: "LISTED-BASE" },
  repository: {
    id: "repo-1",
    name: "Web Store",
    project: { id: "project-1", name: "Sample Project" },
    remoteUrl:
      "https://dev.azure.com/sample-org/Sample%20Project/_git/Web%20Store",
  },
  ...over,
});

const iteration = (id: number, at: string, commit: string): AzIteration => ({
  id,
  createdDate: at,
  sourceRefCommit: { commitId: commit },
  targetRefCommit: { commitId: `TARGET-${id}` },
  commonRefCommit: { commitId: `COMMON-${id}` },
});

const comment = (
  id: number,
  author: AzIdentity,
  content: string,
  over: Partial<AzComment> = {},
): AzComment => ({
  id,
  parentCommentId: 0,
  content,
  commentType: "text",
  author,
  publishedDate: `2026-10-01T10:0${id}:00Z`,
  ...over,
});

const thread = (id: number, over: Partial<AzThread> = {}): AzThread => ({
  id,
  status: "active",
  publishedDate: "2026-10-01T10:00:00Z",
  comments: [],
  ...over,
});

/** The system thread Azure logs when someone votes. */
const voteLogged = (id: number, who: AzIdentity, at: string) =>
  thread(id, {
    publishedDate: at,
    properties: { CodeReviewThreadType: { $value: "VoteUpdate" } },
    comments: [
      comment(1, who, `${who.displayName} voted`, { commentType: "system" }),
    ],
  });

describe("asPull", () => {
  it("takes the head, base and merge base from the latest push", () => {
    const p = asPull(
      server,
      pr(),
      iteration(3, "2026-10-02T12:00:00Z", "ABCDEF123"),
    );
    expect(p).toMatchObject({
      server,
      owner: "Sample Project",
      name: "Web Store",
      number: 42,
      state: "open",
      merged: false,
      html_url: pullPage,
      merge_base: "common-3",
      updated_at: "2026-10-02T12:00:00Z",
      user: {
        id: userId(ann.id),
        login: "ann@example.com",
        full_name: "Ann Example",
      },
    });
    expect(p.head).toMatchObject({
      ref: "feature/search",
      sha: "abcdef123",
      repo: { full_name: "Sample Project/Web Store" },
    });
    expect(p.base).toMatchObject({ ref: "main", sha: "target-3" });
  });

  it("falls back to the merge commits a listing carries, with no merge base", () => {
    const p = asPull(server, pr());
    expect(p.head.sha).toBe("listed-head");
    expect(p.base.sha).toBe("listed-base");
    expect(p.merge_base).toBe("");
    expect(p.updated_at).toBe("2026-10-01T09:00:00Z");
  });

  it("reads completed as merged and abandoned as closed", () => {
    const closedDate = "2026-10-03T08:00:00Z";
    expect(
      asPull(server, pr({ status: "completed", closedDate })),
    ).toMatchObject({ state: "closed", merged: true, updated_at: closedDate });
    expect(asPull(server, pr({ status: "abandoned" }))).toMatchObject({
      state: "closed",
      merged: false,
    });
  });

  it("names a fork's repository as the head's", () => {
    const fork = {
      id: "fork-1",
      name: "web-store-fork",
      project: { id: "project-2", name: "Forks" },
    };
    const p = asPull(server, pr({ forkSource: { repository: fork } }));
    expect(p.head.repo?.full_name).toBe("Forks/web-store-fork");
    expect(p.base.repo?.full_name).toBe("Sample Project/Web Store");
  });

  it("leaves out labels that were taken off", () => {
    const labels = [
      { id: "l1", name: "ui" },
      { id: "l2", name: "old", active: false },
    ];
    expect(asPull(server, pr({ labels })).labels.map((l) => l.name)).toEqual([
      "ui",
    ]);
  });
});

describe("reviewsOf", () => {
  const iterations = [
    iteration(1, "2026-10-01T10:00:00Z", "COMMIT-1"),
    iteration(2, "2026-10-01T12:00:00Z", "COMMIT-2"),
  ];
  const head = "commit-2";
  const reviewer = (
    who: AzIdentity,
    vote: number,
    over: Partial<AzReviewer> = {},
  ) => ({ ...who, vote, ...over }) as AzReviewer;

  it("reads each vote as a verdict on the commit the branch was at when it was cast", () => {
    const reviews = reviewsOf(
      pr({ reviewers: [reviewer(ann, 10), reviewer(bob, -5)] }),
      [
        voteLogged(1, ann, "2026-10-01T11:00:00Z"),
        voteLogged(2, bob, "2026-10-01T12:30:00Z"),
      ],
      iterations,
      head,
    );
    expect(reviews).toEqual([
      expect.objectContaining({
        body: "",
        state: "APPROVED",
        user: expect.objectContaining({ id: userId(ann.id) }),
        submitted_at: "2026-10-01T11:00:00Z",
        commit_id: "commit-1",
      }),
      expect.objectContaining({
        state: "REQUEST_CHANGES",
        user: expect.objectContaining({ id: userId(bob.id) }),
        submitted_at: "2026-10-01T12:30:00Z",
        commit_id: "commit-2",
      }),
    ]);
  });

  it("dates a vote by the reviewer's own latest logged vote", () => {
    const [review] = reviewsOf(
      pr({ reviewers: [reviewer(ann, -10)] }),
      [
        voteLogged(1, ann, "2026-10-01T10:30:00Z"),
        voteLogged(2, bob, "2026-10-01T13:00:00Z"),
        voteLogged(3, ann, "2026-10-01T12:10:00Z"),
      ],
      iterations,
      head,
    );
    expect(review).toMatchObject({
      state: "REQUEST_CHANGES",
      submitted_at: "2026-10-01T12:10:00Z",
      commit_id: "commit-2",
    });
  });

  it("reads approved with suggestions as approved, and dates an unlogged vote from the PR's opening", () => {
    const [review] = reviewsOf(
      pr({ reviewers: [reviewer(carol, 5)] }),
      [],
      iterations,
      head,
    );
    expect(review).toMatchObject({
      state: "APPROVED",
      submitted_at: "2026-10-01T09:00:00Z",
      commit_id: "commit-1",
    });
  });

  it("skips reviewers who haven't voted and team reviewers", () => {
    const team = { id: "team-1", displayName: "Web Team", isContainer: true };
    expect(
      reviewsOf(
        pr({ reviewers: [reviewer(bob, 0), reviewer(team, 10)] }),
        [],
        iterations,
        head,
      ),
    ).toEqual([]);
  });

  it("gives each voter an id of their own that no thread's id can reach", () => {
    const reviews = reviewsOf(
      pr({ reviewers: [reviewer(ann, 10), reviewer(bob, 10)] }),
      [],
      iterations,
      head,
    );
    const again = reviewsOf(
      pr({ reviewers: [reviewer(bob, -5)] }),
      [],
      iterations,
      head,
    );
    expect(reviews[0].id).not.toBe(reviews[1].id);
    expect(again[0].id).toBe(reviews[1].id);
    expect(reviews[0].id).toBeGreaterThan(2 ** 40);
  });

  it("reads a file thread with something said as a body-less comment review on the head", () => {
    const reviews = reviewsOf(
      pr(),
      [
        thread(7, {
          publishedDate: "2026-10-01T10:05:00Z",
          threadContext: { filePath: "/src/app.ts" },
          comments: [
            comment(1, bob, "Why this?"),
            comment(2, ann, "Because", { isDeleted: true }),
            comment(3, ann, "Because, really"),
            comment(4, ann, "Resolved", { commentType: "system" }),
          ],
        }),
        // Nothing said: only Azure's own note.
        thread(8, {
          threadContext: { filePath: "/src/app.ts" },
          comments: [comment(1, ann, "moved", { commentType: "system" })],
        }),
        thread(9, {
          isDeleted: true,
          threadContext: { filePath: "/src/app.ts" },
          comments: [comment(1, ann, "gone")],
        }),
        // The conversation, not a file.
        thread(10, { comments: [comment(1, ann, "Looks good overall")] }),
      ],
      iterations,
      head,
    );
    expect(reviews).toEqual([
      {
        id: 7,
        body: "",
        state: "COMMENT",
        user: expect.objectContaining({ id: userId(bob.id) }),
        submitted_at: "2026-10-01T10:05:00Z",
        commit_id: head,
        comments_count: 2,
      },
    ]);
  });
});

it("carries a thread and its comment in one number and back", () => {
  for (const [t, c] of [
    [1, 1],
    [7, 3],
    [123456, 999],
  ])
    expect(commentOf(commentId(t, c))).toEqual({ thread: t, comment: c });
  expect(commentId(7, 3)).not.toBe(commentId(3, 7));
});

describe("threadComments", () => {
  const onLines = (over: Partial<AzThread> = {}) =>
    thread(7, {
      threadContext: {
        filePath: "/src/app.ts",
        rightFileStart: { line: 10, offset: 1 },
        rightFileEnd: { line: 12, offset: 4 },
      },
      comments: [
        comment(1, bob, "Why this?"),
        comment(2, ann, "", { parentCommentId: 1 }),
        comment(3, ann, "Because", { parentCommentId: 1 }),
      ],
      ...over,
    });

  it("places what was said on the new side's last line, at the head", () => {
    expect(threadComments(server, pr(), onLines(), "commit-2")).toEqual([
      {
        id: commentId(7, 1),
        body: "Why this?",
        path: "src/app.ts",
        position: 12,
        original_position: 0,
        commit_id: "commit-2",
        user: expect.objectContaining({ id: userId(bob.id) }),
        created_at: "2026-10-01T10:01:00Z",
        html_url: `${pullPage}?discussionId=7`,
        pull_request_review_id: 7,
        resolver: null,
      },
      expect.objectContaining({ id: commentId(7, 3), body: "Because" }),
    ]);
  });

  it("places a comment on removed lines on the old side", () => {
    const [c] = threadComments(
      server,
      pr(),
      onLines({
        threadContext: {
          filePath: "/src/app.ts",
          leftFileStart: { line: 4, offset: 1 },
        },
      }),
      "commit-2",
    );
    expect(c).toMatchObject({ position: 0, original_position: 4 });
  });

  it("reads a fixed, closed or won't-fix thread as resolved and a pending one as open", () => {
    const resolver = (status: string) =>
      threadComments(server, pr(), onLines({ status }), "commit-2")[0].resolver;
    for (const status of ["fixed", "closed", "wontFix", "byDesign"])
      expect(resolver(status)).not.toBeNull();
    for (const status of ["active", "pending"])
      expect(resolver(status)).toBeNull();
  });
});

describe("discussionOf", () => {
  it("is what was said outside any file, oldest first across threads", () => {
    const said = discussionOf(server, pr(), [
      thread(3, {
        comments: [
          comment(1, ann, "Second", { publishedDate: "2026-10-01T11:00:00Z" }),
        ],
      }),
      thread(4, {
        threadContext: null,
        comments: [
          comment(1, bob, "First", { publishedDate: "2026-10-01T10:00:00Z" }),
          comment(2, ann, "Third", { publishedDate: "2026-10-01T12:00:00Z" }),
        ],
      }),
      thread(5, {
        threadContext: { filePath: "/src/app.ts" },
        comments: [comment(1, bob, "On a line")],
      }),
      thread(6, { isDeleted: true, comments: [comment(1, bob, "Gone")] }),
      voteLogged(8, ann, "2026-10-01T10:30:00Z"),
    ]);
    expect(said.map((d) => d.body)).toEqual(["First", "Second", "Third"]);
    expect(said[0]).toEqual({
      id: commentId(4, 1),
      body: "First",
      user: expect.objectContaining({ id: userId(bob.id) }),
      created_at: "2026-10-01T10:00:00Z",
      html_url: `${pullPage}?discussionId=4`,
    });
  });
});

describe("waitsOn", () => {
  it("waits on a reviewer only until they vote or decline", () => {
    const asked = (r: Partial<AzReviewer>) =>
      pr({ reviewers: [{ ...bob, vote: 0, ...r }] });
    expect(waitsOn(asked({}), bob.id)).toBe(true);
    expect(waitsOn(asked({ vote: 5 }), bob.id)).toBe(false);
    expect(waitsOn(asked({ vote: -5 }), bob.id)).toBe(false);
    expect(waitsOn(asked({ hasDeclined: true }), bob.id)).toBe(false);
    expect(waitsOn(asked({}), ann.id)).toBe(false);
    expect(waitsOn(pr(), bob.id)).toBe(false);
  });
});

it("votes for approvals and change requests, and leaves the vote alone for a comment", () => {
  expect(voteFor("APPROVED")).toBe(10);
  expect(voteFor("REQUEST_CHANGES")).toBe(-5);
  expect(voteFor("COMMENT")).toBeNull();
});

it("gives an identity the same number whatever the case of its GUID", () => {
  expect(userId("AAAA-1111")).toBe(userId("aaaa-1111"));
  expect(userId("aaaa-1111")).not.toBe(userId("bbbb-2222"));
  expect(userId("aaaa-1111")).toBeGreaterThan(0);
});

describe("changed files", () => {
  it("reads Azure's change types and skips folders", () => {
    expect(
      asChangedFile({ changeType: "edit", item: { path: "/src/a.ts" } }),
    ).toMatchObject({ filename: "src/a.ts", status: "modified" });
    expect(
      asChangedFile({ changeType: "add", item: { path: "/src/b.ts" } }),
    ).toMatchObject({ status: "added" });
    expect(
      asChangedFile({ changeType: "delete", item: { path: "/src/c.ts" } }),
    ).toMatchObject({ status: "deleted" });
    expect(
      asChangedFile({
        changeType: "edit, rename",
        originalPath: "/src/old.ts",
        item: { path: "/src/new.ts" },
      }),
    ).toMatchObject({
      filename: "src/new.ts",
      previous_filename: "src/old.ts",
      status: "renamed",
    });
    expect(
      asChangedFile({
        changeType: "add",
        item: { path: "/src", isFolder: true },
      }),
    ).toBeNull();
    expect(
      asChangedFile({
        changeType: "edit",
        item: { path: "/lib", gitObjectType: "tree" },
      }),
    ).toBeNull();
  });

  it("counts an edited block as both added and removed lines", () => {
    expect(
      lineCounts([
        { changeType: "Add", originalLinesCount: 0, modifiedLinesCount: 3 },
        { changeType: "Delete", originalLinesCount: 2, modifiedLinesCount: 0 },
        { changeType: "Edit", originalLinesCount: 1, modifiedLinesCount: 4 },
        { changeType: "None", originalLinesCount: 9, modifiedLinesCount: 9 },
      ]),
    ).toEqual({ additions: 7, deletions: 3, changes: 10 });
    expect(
      lineCounts([
        { changeType: 1, originalLinesCount: 0, modifiedLinesCount: 3 },
        { changeType: 3, originalLinesCount: 1, modifiedLinesCount: 4 },
      ]),
    ).toEqual({ additions: 7, deletions: 1, changes: 8 });
  });
});
