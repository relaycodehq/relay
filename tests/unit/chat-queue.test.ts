import { describe, expect, it } from "vitest";
import { moveQueued, returnedDraft } from "../../src/lib/chat-queue";
import { codeReferenceMessage } from "../../shared/code-references";
import type { ProjectChatSend } from "../../shared/projects";

const queued = (...ids: string[]) => ids.map((id) => ({ input: { id } }));
const order = (moved: ReturnType<typeof moveQueued>) =>
  moved?.queue.map((q) => q.input.id);

describe("moving a queued message", () => {
  const queue = queued("a", "b", "c");
  it("lands before or after the message it's dropped on", () => {
    const after = moveQueued(queue, "a", { id: "c", where: "after" });
    expect(order(after)).toEqual(["b", "c", "a"]);
    expect(after?.index).toBe(2);
    const before = moveQueued(queue, "c", { id: "a", where: "before" });
    expect(order(before)).toEqual(["c", "a", "b"]);
    expect(before?.index).toBe(0);
  });
  it("does nothing when the drop leaves it where it was", () => {
    expect(moveQueued(queue, "b", { id: "b", where: "after" })).toBeUndefined();
    expect(
      moveQueued(queue, "a", { id: "b", where: "before" }),
    ).toBeUndefined();
    expect(moveQueued(queue, "b", { id: "a", where: "after" })).toBeUndefined();
  });
});

const shot = { name: "s.png", mimeType: "image/png" as const, dataUrl: "d" };
const message = (body: string, images = 0) =>
  ({
    id: "q",
    body,
    images: Array.from({ length: images }, () => shot),
  }) as ProjectChatSend;

describe("a queued message back in the composer", () => {
  it("follows the draft, its screenshots numbered after the draft's", () => {
    const back = returnedDraft(
      "Look at [Image #1]",
      [{ ...shot, id: "mine", n: 1 }],
      message("and [Image #1]", 1),
      false,
    );
    expect(back.body).toBe("Look at [Image #1]\n\nand [Image #2]");
    expect(back.images.map((i) => i.n)).toEqual([1, 2]);
    expect(back.images[0]!.id).toBe("mine");
  });
  it("takes code references out of the text, but leaves a reply's in it", () => {
    const ref = {
      path: "a.ts",
      start: 1,
      end: 1,
      label: "HEAD",
      code: "x",
    };
    const body = codeReferenceMessage([ref], "Why?");
    const main = returnedDraft("", [], message(body), false);
    expect(main).toMatchObject({ body: "Why?", codeRefs: [ref] });
    const reply = returnedDraft("", [], message(body), true);
    expect(reply).toMatchObject({ body, codeRefs: [] });
  });
  it("refuses what one message can't hold", () => {
    expect(() =>
      returnedDraft("x".repeat(32000), [], message("more"), false),
    ).toThrow(/shorten the current draft/);
    const mine = [1, 2].map((n) => ({ ...shot, id: `${n}`, n }));
    expect(() =>
      returnedDraft(
        "[Image #1] [Image #2]",
        mine,
        message("[Image #1] [Image #2]", 2),
        false,
      ),
    ).toThrow(/a message can hold three/);
  });
});
