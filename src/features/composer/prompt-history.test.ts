import { describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../shared/projects";
import { codeReferenceMessage } from "../../../shared/code-references";
import { pasteMarkdown } from "../../../shared/pasted-texts";
import {
  recallText,
  sentHistory,
  stepHistory,
  type HistoryNav,
  type HistoryStep,
} from "./prompt-history";

const message = (
  body: string,
  extra: Partial<ChatMessage> = {},
): ChatMessage => ({
  id: body,
  role: "user",
  body,
  status: "complete",
  created: 0,
  provider: "claude",
  version: 1,
  ...extra,
});

/** Applies a step the way the composer does: shows the text, caret at its end. */
function apply(step: HistoryStep): { nav: HistoryNav | null; text: string } {
  if (!step || step === "hold") throw new Error(`no step: ${step}`);
  return {
    nav: step.nav && {
      ...step.nav,
      text: step.text,
      caret: step.text.length,
    },
    text: step.text,
  };
}

const history = ["third", "second", "first"];
const entries = () => history;

describe("recallText", () => {
  it("drops the mention the send added and the code it carried", () => {
    const body = codeReferenceMessage(
      [{ path: "a.ts", start: 1, end: 2, label: "HEAD", code: "x" }],
      "@codex fix this",
    );
    expect(recallText(body)).toBe("fix this");
  });
  it("drops screenshot tokens, which don't come back, but not inside a paste", () => {
    const paste = pasteMarkdown({ n: 1, text: "log [Image #1] line" });
    expect(recallText(`@claude look [Image #1] here${paste}`)).toBe(
      `look here${paste}`.trim(),
    );
  });
});

describe("sentHistory", () => {
  it("lists the user's own messages newest first, without repeats in a row", () => {
    expect(
      sentHistory([
        message("@claude one"),
        message("answer", { role: "assistant" }),
        message("@claude two"),
        message("@claude two", { id: "again" }),
        message("@claude theirs", { author: "Ana" }),
        message("woke up", { unprompted: true }),
        message("@claude [Image #1]"),
      ]),
    ).toEqual(["two", "one"]);
  });
});

describe("stepHistory", () => {
  it("leaves the arrows alone with nothing sent, or in a draft with text", () => {
    expect(stepHistory(null, "", 0, "older", () => [])).toBeUndefined();
    expect(stepHistory(null, "typing", 6, "older", entries)).toBeUndefined();
    expect(stepHistory(null, "", 0, "newer", entries)).toBeUndefined();
  });

  it("walks back with ↑, forward with ↓, and past the newest gives the draft back", () => {
    let at = apply(stepHistory(null, "", 0, "older", entries));
    expect(at.text).toBe("third");
    at = apply(stepHistory(at.nav, at.text, at.text.length, "older", entries));
    expect(at.text).toBe("second");
    at = apply(stepHistory(at.nav, at.text, at.text.length, "older", entries));
    expect(at.text).toBe("first");
    expect(stepHistory(at.nav, at.text, at.text.length, "older", entries)).toBe(
      "hold",
    );
    at = apply(stepHistory(at.nav, at.text, at.text.length, "newer", entries));
    expect(at.text).toBe("second");
    at = apply(stepHistory(at.nav, at.text, at.text.length, "newer", entries));
    at = apply(stepHistory(at.nav, at.text, at.text.length, "newer", entries));
    expect(at).toEqual({ nav: null, text: "" });
  });

  it("gives back the blank draft it started from", () => {
    const at = apply(stepHistory(null, "\n", 1, "older", entries));
    expect(
      apply(stepHistory(at.nav, at.text, at.text.length, "newer", entries)),
    ).toEqual({ nav: null, text: "\n" });
  });

  it("stops once the recalled text is edited or the caret moves", () => {
    const at = apply(stepHistory(null, "", 0, "older", entries));
    expect(stepHistory(at.nav, "third!", 6, "older", entries)).toBeUndefined();
    expect(stepHistory(at.nav, "third", 2, "older", entries)).toBeUndefined();
    expect(stepHistory(at.nav, "third", 2, "newer", entries)).toBeUndefined();
  });

  it("starts over from the newest once the composer is empty again", () => {
    let at = apply(stepHistory(null, "", 0, "older", entries));
    at = apply(stepHistory(at.nav, at.text, at.text.length, "older", entries));
    // Sent or cleared: the old place no longer matches what is shown.
    expect(apply(stepHistory(at.nav, "", 0, "older", entries)).text).toBe(
      "third",
    );
  });

  it("keeps the list it started with while new messages arrive", () => {
    let live = ["b", "a"];
    const at = apply(stepHistory(null, "", 0, "older", () => live));
    live = ["c", ...live];
    expect(
      apply(stepHistory(at.nav, at.text, at.text.length, "older", () => live))
        .text,
    ).toBe("a");
  });
});
