import { expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatSummary } from "../../../shared/projects";
vi.mock("../../lib/api", () => ({ api: {} }));
import { CardState, StatusMark } from "./ThreadStatus";

const thread: ChatSummary = {
  id: "c",
  projectId: "p",
  title: "T",
  scope: { kind: "project" },
  created: 1,
  updated: 1,
  running: true,
  waiting: true,
  asking: true,
};
it("keeps the working spinner and the input notice together for async questions", () => {
  const mark = renderToStaticMarkup(
    <StatusMark chat={thread} unread={false} now={2} />,
  );
  const card = renderToStaticMarkup(
    <CardState chat={thread} unread={false} now={2} />,
  );
  expect(mark).toContain("sb-status running");
  expect(mark).toContain("needs your input");
  expect(card).toContain("spinner");
  expect(card).toContain("Working · needs input");
  for (const chat of [
    { ...thread, blocked: true as const },
    { ...thread, running: false },
  ]) {
    const card = renderToStaticMarkup(
      <CardState chat={chat} unread={false} now={2} />,
    );
    expect(card).toContain("Needs input");
    expect(card).not.toContain("spinner");
  }
});
