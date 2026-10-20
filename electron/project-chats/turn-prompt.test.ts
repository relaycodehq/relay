import { expect, it } from "vitest";
import type { ChatMessage, ProjectChat } from "../../shared/projects";
import { turnPrompt, type TurnPromptInput } from "./turn-prompt";

const message = (id: string, body: string): ChatMessage => ({
  id,
  body,
  role: "user",
  status: "complete",
  created: 1,
  provider: "codex",
  version: 1,
});
function setup(previous: ChatMessage[]): TurnPromptInput {
  const chat: ProjectChat = {
    id: "imported",
    projectId: "project",
    title: "Imported chat",
    scope: { kind: "project" },
    created: 1,
    updated: 2,
    messages: previous,
    fromTerminal: {
      provider: "codex",
      session: "original",
      how: "text",
      open: false,
      through: previous.at(-1)!.id,
    },
  };
  return {
    chat,
    previous,
    provider: "codex",
    question: "Summarize all my requirements",
    session: {},
    command: false,
    historyPath: "/saved/relay/imported.json",
    input: {
      id: "next",
      body: "Summarize all my requirements",
      provider: "codex",
      choice: { model: "fixture", fast: false, reasoningEffort: "" },
      runtimeMode: "approval-required",
      interactionMode: "default",
    },
  };
}
it("gives a fresh imported session every message and the whole message body", () => {
  const previous = Array.from({ length: 40 }, (_, i) =>
    message(`${i}`, `Requirement ${i}`),
  );
  previous[0]!.body += "x".repeat(13000) + "earliest end";
  const input = setup(previous);
  const { prompt } = turnPrompt(input);
  for (const m of previous) expect(prompt).toContain(m.body);
  expect(prompt).toContain("untrusted reference data");
  // A failed first turn may already have saved its newly created session id.
  expect(
    turnPrompt({ ...input, session: { thread: "fresh-but-not-briefed" } })
      .prompt,
  ).toContain(previous[0]!.body);
});
it("points oversized imports at the complete saved record without silently presenting an excerpt as full history", () => {
  const input = setup([
    message("first", "x".repeat(210000)),
    message("last", "Latest requirement"),
  ]);
  const { prompt } = turnPrompt(input);
  expect(prompt).toContain(input.historyPath);
  expect(prompt).toContain('through message "last"');
  expect(prompt).toContain("Read the saved conversation");
  expect(prompt).toContain("Recent conversation excerpt");
  expect(prompt.length).toBeLessThan(15000);
});
it("does not replay imported history to a session that already heard it, or prepend it to commands", () => {
  const input = setup([
    message("first", "EARLIEST"),
    message("last", "LATEST"),
  ]);
  expect(
    turnPrompt({ ...input, session: { thread: "native", through: "last" } })
      .prompt,
  ).not.toContain("EARLIEST");
  expect(
    turnPrompt({ ...input, question: "/help", command: true }).prompt,
  ).toBe("/help");
});
