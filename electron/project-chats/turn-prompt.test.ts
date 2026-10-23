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
it("numbers browser comments after the screenshots of missed messages, which go out first", () => {
  const shot = (id: string) => ({
    id,
    name: `${id}.png`,
    mimeType: "image/png" as const,
    sizeBytes: 1,
  });
  const missed = {
    ...message("missed", "@codex Look at these"),
    steered: true,
    missed: true,
    images: [shot("a"), shot("b")],
  };
  const input = setup([missed]);
  delete input.chat.fromTerminal;
  const browser = {
    id: "b74407b4-0d67-434d-9da6-7fa8f71f88be",
    url: "http://localhost:3000/",
    selector: "#card",
    tag: "<button>",
    text: "Card",
    comment: "Increase the contrast",
    rect: { x: 1, y: 1, width: 10, height: 10 },
    viewport: { width: 800, height: 600 },
  };
  input.input.images = [
    {
      name: "card.png",
      mimeType: "image/png",
      dataUrl: "data:image/png;base64,AA==",
      browser,
    },
  ];
  const { prompt, carried } = turnPrompt(input);
  expect(carried).toHaveLength(2);
  expect(prompt).toContain("Comment 1 (Image #3): Increase the contrast");
  // A command goes out alone, without the feedback as its arguments.
  expect(
    turnPrompt({ ...input, question: "/review", command: true }).prompt,
  ).toBe("/review");
});
