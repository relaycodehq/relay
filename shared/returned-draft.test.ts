import { describe, expect, it } from "vitest";
import { codeReferenceMessage } from "./code-references";
import type { ProjectChatSend } from "./projects";
import { returnedDraft as returned } from "./returned-draft";

let counter = 0;
const returnedDraft = (
  draft: string,
  images: Parameters<typeof returned>[1],
  input: ProjectChatSend,
  reply: boolean,
) => returned(draft, images, input, reply, () => `new-${++counter}`);

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
    expect(back.images[1]!.id).toMatch(/^new-/);
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
