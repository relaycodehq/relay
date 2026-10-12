import { describe, expect, it } from "vitest";
import { planSkillDispatch } from "./skill-dispatch";

const skills = new Set(["commit", "review", "anthropic-skills:pdf"]);

describe("planSkillDispatch", () => {
  it("leaves a prompt without a known skill alone", () => {
    expect(planSkillDispatch("costs $5, see $HOME", skills)).toBeUndefined();
    expect(planSkillDispatch("pay$commit", skills)).toBeUndefined();
  });

  it("runs a skill that opens the prompt with the rest as its arguments", () => {
    expect(planSkillDispatch("$commit split it up", skills)).toEqual({
      command: "/commit split it up",
    });
  });

  it("keeps the text on both sides of a mid-message skill in order", () => {
    expect(
      planSkillDispatch("tests pass now,\nso $commit everything", skills),
    ).toEqual({
      lead: "tests pass now,\nso",
      command: "/commit everything",
    });
  });

  it("expands the last skill and leaves earlier ones for the model", () => {
    expect(
      planSkillDispatch("$review the diff, then $commit it", skills),
    ).toEqual({ lead: "/review the diff, then", command: "/commit it" });
  });

  it("drops a sentence's punctuation from the name but keeps it as text", () => {
    expect(planSkillDispatch("do it with $commit...", skills)).toEqual({
      lead: "do it with",
      command: "/commit...",
    });
  });

  it("takes plugin skills by their qualified name", () => {
    expect(planSkillDispatch("read $anthropic-skills:pdf", skills)).toEqual({
      lead: "read",
      command: "/anthropic-skills:pdf",
    });
  });
});

describe("planSkillDispatch around Relay's own text", () => {
  const prompt =
    "My request: tests pass, so $commit it all\nThis is a general discussion of the linked project.\n\nConversation updates: []";

  it("keeps what Relay adds out of the skill's arguments", () => {
    expect(
      planSkillDispatch(prompt, skills, "tests pass, so $commit it all"),
    ).toEqual({
      lead: "My request: tests pass, so\nThis is a general discussion of the linked project.\n\nConversation updates: []",
      command: "/commit it all",
    });
  });

  it("ignores skills Relay's text mentions", () => {
    expect(
      planSkillDispatch("My request: hi\nnote: run $commit", skills, "hi"),
    ).toBeUndefined();
  });
});
