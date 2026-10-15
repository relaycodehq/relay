import { describe, expect, it } from "vitest";
import { buildSend } from "./compose-send";
import { memeToken } from "./memes";
import { promptTitle } from "./prompt-title";

const dewIt = memeToken({ id: "dew-it", meaning: "Yes, go ahead and do it." });

/** The body a composer sends `text` to `to` with. */
const sent = (to: Parameters<typeof buildSend>[0]["to"], text: string) =>
  buildSend(
    {
      to,
      choice: { model: "", reasoningEffort: "", fast: false },
      runtimeMode: "full-access",
      interactionMode: "default",
    },
    text,
  ).body;

describe("promptTitle", () => {
  it("names a thread that starts with a meme after what it means, mention or not", () => {
    expect(promptTitle(dewIt)).toBe("Yes, go ahead and do it.");
    expect(promptTitle(sent("claude", dewIt))).toBe("Yes, go ahead and do it.");
    expect(promptTitle(sent("codex", dewIt))).toBe("Yes, go ahead and do it.");
    expect(promptTitle(`@Claude\n${dewIt}`)).toBe("Yes, go ahead and do it.");
    expect(promptTitle(sent("acp:goose", dewIt))).toBe(
      "Yes, go ahead and do it.",
    );
  });

  it("drops the mention a composer adds from any other title", () => {
    expect(sent("claude", "Fix it")).toBe("@claude Fix it");
    expect(promptTitle(sent("claude", "Fix it"))).toBe("Fix it");
    expect(promptTitle("@OpenCode Write notes.md")).toBe("Write notes.md");
    expect(promptTitle(sent("acp:goose", "Fix it"))).toBe("Fix it");
    // A note to people has no mention, and a mention mid-text stays.
    expect(promptTitle(sent("message", "Ask @claude later"))).toBe(
      "Ask @claude later",
    );
    expect(promptTitle("@claudette hi")).toBe("@claudette hi");
    expect(promptTitle("@claude")).toBe("Screenshot");
  });
});
