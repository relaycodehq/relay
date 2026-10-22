import { expect, it, vi } from "vitest";
vi.mock("../../lib/api", () => ({ api: { onTerminal: () => () => {} } }));
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clock } from "../../../shared/waiting";
import type { ChatMessage } from "../../../shared/projects";
import { Message } from "./ProjectMessage";

const render = (m: ChatMessage) =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <Message
        message={m}
        chatId=""
        projectRoot="/sample/relay"
        onReply={() => {}}
        onChanges={() => {}}
        onTurnDiff={() => {}}
        onOpenFile={() => {}}
        onRewind={async () => ({ conflicts: [] })}
      />
    </QueryClientProvider>,
  );

it("shows a resume as a static divider while keeping an identical typed prompt visible", () => {
  const message: ChatMessage = {
    id: "resume",
    role: "user",
    provider: "codex",
    body: "@codex Continue from where the previous response was stopped. Check what has already been done before repeating any actions.",
    created: new Date(2026, 9, 8, 14, 42).getTime(),
    status: "complete",
    version: 1,
  };
  const resumed = render({ ...message, resumed: true });
  expect(resumed).toContain('role="separator"');
  expect(resumed).toContain('data-message-id="resume"');
  expect(resumed).toContain("Resumed · ");
  expect(resumed).toContain(clock(message.created));
  expect(resumed).not.toContain("Continue from where");
  expect(resumed).not.toContain("project-message user");
  expect(resumed).not.toContain("unread-divider");
  expect(
    render({ ...message, resumed: true, asyncQuestionAnswer: true }),
  ).toContain("Resumed · ");
  const typed = render(message);
  expect(typed).toContain("project-message user");
  expect(typed).toContain("Continue from where");
});

it("keeps ordinary steering messages visible and hides generated question and page replies", () => {
  const message: ChatMessage = {
    id: "reply",
    role: "user",
    provider: "codex",
    body: "Private",
    created: 1,
    status: "complete",
    version: 1,
    steered: true,
    unread: true,
  };
  const ordinary = render(message);
  expect(ordinary).toContain('aria-label="Not read yet"');
  expect(ordinary).toContain('class="spinner steady"');
  expect(ordinary).not.toContain("Sent · awaiting");

  for (const unread of [true, false]) {
    expect(render({ ...message, unread, asyncQuestionAnswer: true })).toBe("");
    expect(render({ ...message, unread, pageAnswer: { title: "Pick" } })).toBe(
      "",
    );
    expect(
      render({
        ...message,
        unread,
        pageAnswer: { title: "Pick", skipped: true },
      }),
    ).toBe("");
  }
  const body = "Answer to your questions:\nWhich?\nPrivate";
  expect(render({ ...message, body, unread: false })).toContain("Which?");
});
