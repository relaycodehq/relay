import { expect, it, vi } from "vitest";
vi.mock("../../lib/api", () => ({ api: {} }));
import { renderToStaticMarkup } from "react-dom/server";
import { RichText } from "../../ui/RichText";
import { AgentTurn } from "./AgentTurn";
import type { ChatMessage } from "../../../shared/projects";

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

it("shows only inline code through inlineCode, like a finding's F1", () => {
  const html = renderToStaticMarkup(
    <RichText
      text={"Fix `F1` first, in `src/util.ts:3`.\n\n```\nF1\n```"}
      projectRoot="/Users/test/workspace"
      onOpenFile={() => {}}
      inlineCode={(value) => (value === "F1" ? <b>P1</b> : undefined)}
    />,
  );
  expect(html.match(/<b>P1<\/b>/g)).toHaveLength(1);
  expect(html).toContain('title="src/util.ts:3"');
});

it("labels file chips with a type icon, file name, line, and parents only on a clash", () => {
  const html = renderToStaticMarkup(
    <RichText
      text={
        "[Source](src/main.ts#L9) `src/components/AgentTurn.tsx` `electron/rooms/index.ts` `src/lib/index.ts:4`"
      }
      projectRoot="/Users/test/workspace"
      onOpenFile={() => {}}
    />,
  );
  expect(html).toContain(">main.ts · L9</span>");
  expect(html).not.toContain(">Source<");
  expect(html).toContain('href="#file-tree-builtin-react"');
  expect(html).toContain(">AgentTurn.tsx</span>");
  expect(html).toContain(">index.ts · electron/rooms</span>");
  expect(html).toContain(">index.ts · src/lib · L4</span>");
});

it("renders an active turn, then folds its trace after completion", () => {
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
  // Between calls the open batch names its last one, and a thinking line runs.
  expect(live).toContain("agent-thinking");
  expect(live).toContain("Ran git");
  expect(live).not.toContain("Ran 1 command");
  expect(live).toContain("Working for");
  expect(live).toContain("I will inspect the repository.");
  const running = renderToStaticMarkup(
    <AgentTurn
      message={{
        ...message,
        trace: [
          ...message.trace!,
          {
            kind: "activity",
            id: "read",
            activity: {
              id: "read",
              kind: "read",
              label: "/Users/test/workspace/src/cache.ts",
              status: "running",
            },
          },
        ],
      }}
      {...props}
    />,
  );
  expect(running).toContain("Reading cache.ts");
  const command = (id: string) => ({
    kind: "activity" as const,
    id,
    activity: {
      id,
      kind: "command" as const,
      label: `echo ${id}`,
      status: "complete" as const,
    },
  });
  const grouped = renderToStaticMarkup(
    <AgentTurn
      message={{
        ...message,
        trace: [
          ...message.trace!,
          command("two"),
          { kind: "commentary", id: "next", text: "Now the tests." },
          command("three"),
        ],
      }}
      {...props}
    />,
  );
  expect(grouped).toContain("Ran 2 commands");
  expect(grouped.indexOf("Ran 2 commands")).toBeLessThan(
    grouped.indexOf("Now the tests."),
  );
  // The batch still open gets no count until commentary or the end closes it.
  expect(grouped).toContain("Ran echo");
  expect(grouped).not.toContain("Ran 1 command");
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
  expect(done).toContain("Ran 1 command");
  expect(done).toContain("5s");
  expect(done).not.toContain('<details class="agent-activity" open=""');
});

it("renders GFM tables, task lists and strikethrough, including a table still streaming", () => {
  const html = renderToStaticMarkup(
    <RichText
      text={[
        "| Requirement | WIP status | Gap |",
        "|---|---|---|",
        "| Sites: search by `licenseID` | ✅ UI done | Backend change needed. |",
        "",
        "- [x] done",
        "- [ ] ~~dropped~~",
      ].join("\n")}
    />,
  );
  expect(html).toContain('<div class="markdown-table"><table>');
  expect(html).toContain('<th>Requirement<span class="markdown-table-resizer"');
  expect(html).toContain("<code>licenseID</code>");
  expect(html).not.toContain("|---|");
  expect(html).toContain('type="checkbox"');
  expect(html).toContain("<del>dropped</del>");
  const partial = renderToStaticMarkup(
    <RichText text={"| A | B |\n|---|---|\n| 1 | 2"} />,
  );
  expect(partial).toContain("<td>2</td>");
});

it("marks a finished turn that only thought out loud with the brain", () => {
  const html = renderToStaticMarkup(
    <AgentTurn
      message={{
        id: "answer",
        role: "assistant",
        provider: "codex",
        status: "complete",
        body: "Done.",
        created: 0,
        ended: 3000,
        version: 1,
        trace: [{ kind: "commentary", id: "note", text: "Checking first." }],
      }}
      projectRoot="/Users/test/workspace"
      onOpenFile={() => {}}
      onChanges={() => {}}
    />,
  );
  expect(html).toContain("Thought");
  expect(html).toContain("lucide-brain");
  expect(html).not.toContain("lucide-wrench");
});
