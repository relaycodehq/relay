import { expect, it } from "vitest";
import type { ChatMessage } from "./projects";
import { applyMessagePatch, diffMessage } from "./remote-delta";

const message = (body: string): ChatMessage => ({
  id: "answer",
  role: "assistant",
  provider: "codex",
  body,
  status: "streaming",
  created: 1,
  version: 1,
});

it.each([
  ["😀", "😁", 0, "😁"],
  ["Answer 😀", "Answer 😁", 7, "😁"],
  ["😀 before", "😀 after", 3, "after"],
  ["😀", "😀 done", 2, " done"],
  ["😀 done", "😀", 2, ""],
])(
  "keeps Unicode pairs whole when replacing %s with %s",
  (before, after, from, text) => {
    const prev = message(before);
    const next = { ...message(after), version: 2 };
    const patch = diffMessage(prev, next);
    expect(patch.body).toEqual({ from, text });
    // A serialized suffix must be valid on clients whose strings require Unicode scalars.
    expect(
      new TextDecoder().decode(new TextEncoder().encode(patch.body!.text)),
    ).toBe(text);
    expect(applyMessagePatch(prev, JSON.parse(JSON.stringify(patch)))).toEqual(
      next,
    );
  },
);
