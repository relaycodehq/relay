import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatSummary } from "../../../shared/projects";
import { ThreadRef } from "./ThreadRef";

const chat: ChatSummary = {
  id: "thread",
  projectId: "project",
  title: "Navigation audit",
  scope: { kind: "project" },
  created: 1,
  updated: 2,
  branch: "nav-a11y",
  worktree: { branch: "nav-a11y", landed: { at: 2, by: "pr" } },
};
const render = (value: ChatSummary) =>
  renderToStaticMarkup(<ThreadRef chat={value} />);

it("recognizes confirmed PR and Relay merges even after the worktree is removed", () => {
  for (const by of ["pr", "merge"]) {
    const markup = render({
      ...chat,
      worktree: { ...chat.worktree, landed: { at: 2, by }, removedAt: 3 },
    });
    expect(markup).toContain(">Merged</span>");
    expect(markup).toContain("nav-a11y");
    expect(markup).toContain(
      by === "pr" ? "Merged via pull request" : "Merged in Relay",
    );
  }
});

it("does not carry a previous branch's merge onto the current branch or a detached commit", () => {
  expect(render({ ...chat, branch: "follow-up" })).not.toContain(
    ">Merged</span>",
  );
  const detached = render({ ...chat, branch: undefined, commit: "abc1234" });
  expect(detached).toContain("Detached at abc1234");
  expect(detached).not.toContain(">Merged</span>");
});

it("ignores legacy landing records and branches without a confirmed merge", () => {
  for (const landed of [undefined, { at: 2, by: "caught-up" }]) {
    expect(
      render({ ...chat, worktree: { ...chat.worktree, landed } }),
    ).not.toContain(">Merged</span>");
  }
});
