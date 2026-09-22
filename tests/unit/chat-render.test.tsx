import { expect, it, vi } from "vitest";
vi.mock("../../src/lib/api", () => ({ api: {} }));
import { renderToStaticMarkup } from "react-dom/server";
import { RichText } from "../../src/components/ui";
import { AgentTurn } from "../../src/components/AgentTurn";
import type { ChatMessage } from "../../shared/projects";

it("renders source links as local code chips and refuses out-of-project file links", () => {
  const html = renderToStaticMarkup(
    <RichText
      text={
        "[Source](src/main.ts#L9) `src/util.ts:3` [Outside](file:///etc/passwd)"
      }
      projectRoot="/Users/test/workspace"
      onOpenFile={() => {}}
    />,
  );
  expect(html).toContain('title="src/main.ts:9"');
  expect(html).toContain('title="src/util.ts:3"');
  expect(html).not.toContain('href="file:');
  const fenced = renderToStaticMarkup(
    <RichText
      text={"```\nsrc/main.ts:9\n```"}
      projectRoot="/Users/test/workspace"
      onOpenFile={() => {}}
    />,
  );
  expect(fenced).not.toContain("chat-file-link");
});

it("renders an active T3-style turn, then folds its trace after completion", () => {
  const message: ChatMessage = {
    id: "answer",
    role: "assistant",
    provider: "codex",
    status: "streaming",
    body: "",
    created: Date.now() - 2000,
    version: 1,
    trace: [
      {
        kind: "commentary",
        id: "intro",
        text: "I will inspect the repository.",
      },
      {
        kind: "activity",
        id: "cmd",
        activity: {
          id: "cmd",
          kind: "command",
          label: "git status --short",
          status: "complete",
        },
      },
    ],
  };
  const props = {
    projectRoot: "/Users/test/workspace",
    onOpenFile: () => {},
    onChanges: () => {},
  };
  const live = renderToStaticMarkup(<AgentTurn message={message} {...props} />);
  expect(live).toContain("Working for");
  expect(live).toContain("I will inspect the repository.");
  expect(live).toContain("Ran 1 command");
  expect(live).toContain("Thinking");
  const done = renderToStaticMarkup(
    <AgentTurn
      message={{
        ...message,
        status: "complete",
        body: "Done.",
        ended: message.created + 5000,
      }}
      {...props}
    />,
  );
  expect(done).toContain("Worked for 5.0s");
  expect(done).not.toContain('<details class="agent-activity" open=""');
});
