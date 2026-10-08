import { expect, it, vi } from "vitest";
vi.mock("../../lib/api", () => ({ api: {} }));
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
  const typed = render(message);
  expect(typed).toContain("project-message user");
  expect(typed).toContain("Continue from where");
});

it("shows a quiet awaiting status only for unread async-question answers", () => {
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

  const awaiting = render({ ...message, asyncQuestionAnswer: true });
  expect(awaiting).toContain("Sent · awaiting Codex");
  expect(awaiting).toContain('role="status"');
  expect(awaiting).not.toContain("spinner");

  const read = render({
    ...message,
    asyncQuestionAnswer: true,
    unread: false,
  });
  expect(read).not.toContain("Sent · awaiting");
  expect(read).not.toContain("spinner");
});
