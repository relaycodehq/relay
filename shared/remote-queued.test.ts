import { describe, expect, it } from "vitest";
import type { ProjectChatSend } from "./projects";
import { queuedForPhone, takenBack } from "./remote-queued";

const shot = { name: "s.png", mimeType: "image/png" as const, dataUrl: "d" };
const input = (over: Partial<ProjectChatSend> = {}): ProjectChatSend => ({
  id: "q1",
  body: "@codex look at [Image #1]",
  to: "codex",
  provider: "codex",
  choice: { model: "gpt-5.5", fast: true, reasoningEffort: "high" },
  runtimeMode: "approval-required",
  interactionMode: "plan",
  images: [shot],
  ...over,
});

describe("a queued message as the phone hears of it", () => {
  it("says who it goes to, with what, and how many screenshots, but not the screenshots", () => {
    const sent = queuedForPhone({ input: input() });
    expect(sent).toEqual({
      id: "q1",
      body: "@codex look at [Image #1]",
      images: 1,
      to: "codex",
      settings: {
        provider: "codex",
        choice: { model: "gpt-5.5", fast: true, reasoningEffort: "high" },
        runtimeMode: "approval-required",
        interactionMode: "plan",
      },
    });
  });
  it("names the side conversation, and the error that holds it", () => {
    const sent = queuedForPhone({
      input: input({
        parentId: "root",
        images: undefined,
        contextWindow: "200k",
      }),
      error: "refused",
    });
    expect(sent).toMatchObject({
      parentId: "root",
      error: "refused",
      settings: { contextWindow: "200k" },
    });
    expect(sent).not.toHaveProperty("images");
  });
  it("tells a note from the agent whose settings it carries", () => {
    const note = queuedForPhone({
      input: input({ body: "remember this", to: "message", provider: "codex" }),
    });
    expect(note.to).toBe("message");
  });
  it("works out the recipient from the mention in a message saved without one", () => {
    const { to: _, ...older } = input({
      body: "@claude hi",
      provider: "claude",
    });
    expect(queuedForPhone({ input: older }).to).toBe("claude");
  });
});

describe("a queued message taken back on the phone", () => {
  it("goes back on its agent and settings, without the mention the agent button replaces", () => {
    const item = queuedForPhone({ input: input({ parentId: "root" }) });
    expect(takenBack(item, [shot])).toEqual({
      body: "look at [Image #1]",
      images: [shot],
      parentId: "root",
      settings: item.settings,
    });
  });
  it("leaves the composer's own agent alone for a note, which no agent answers", () => {
    const note = queuedForPhone({
      input: input({ body: "remember this", to: "message" }),
    });
    expect(takenBack(note).settings).toBeUndefined();
    expect(takenBack(note).body).toBe("remember this");
  });
  it("takes an older desktop's item as the body alone, as before", () => {
    expect(takenBack({ id: "q", body: "@claude hi", images: 2 })).toEqual({
      body: "hi",
      images: [],
    });
  });
  it("puts the settings on the agent that answers when the text names another", () => {
    const item = queuedForPhone({ input: input() });
    const moved = { ...item, to: "claude" as const };
    expect(takenBack(moved).settings?.provider).toBe("claude");
  });
});
