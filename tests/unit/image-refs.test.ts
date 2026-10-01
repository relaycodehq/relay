import { expect, it } from "vitest";
import { getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  ImageTag,
  promptContent,
  promptText,
} from "../../src/components/ComposerPromptInput";
import {
  attachedImages,
  imagesAfter,
  nextImageNumber,
  numberImages,
  shortImageName,
} from "../../src/lib/image-refs";
import { pasteMarkdown } from "../../shared/pasted-texts";

const shot = (id: string, n?: number) => ({ id, n });

it("sends only screenshots whose pills are in the draft, in pill order", () => {
  const images = [shot("a", 1), shot("b", 2), shot("c", 3)];
  expect(
    attachedImages("compare [Image #3] with [Image #1]", images).map(
      (i) => i.id,
    ),
  ).toEqual(["c", "a"]);
});

it("keeps screenshots from before pills attached", () => {
  expect(attachedImages("hi", [shot("old")]).map((i) => i.id)).toEqual(["old"]);
});

it("renumbers pills to match the order the agent gets the images", () => {
  const images = [shot("a", 1), shot("b", 2), shot("c", 3)];
  const out = numberImages(
    "[Image #3] looks off, unlike [Image #2]; again [Image #3]",
    images,
  );
  expect(out.text).toBe(
    "[Image #1] looks off, unlike [Image #2]; again [Image #1]",
  );
  expect(out.images.map((i) => i.id)).toEqual(["c", "b"]);
});

it("leaves tokens inside a pasted log alone", () => {
  const log = pasteMarkdown({ n: 1, text: "user said [Image #2]" });
  const out = numberImages(`see [Image #2]${log}`, [shot("b", 2)]);
  expect(out.text).toBe(`see [Image #1]${log}`);
});

it("numbers new screenshots past deleted ones, so undo finds the right one", () => {
  expect(nextImageNumber("[Image #1]", [shot("a", 1), shot("b", 4)])).toBe(5);
});

it("restores a sent message's images after the draft's own", () => {
  const back = imagesAfter(
    "[Image #2] then [Image #1]",
    [shot("x"), shot("y")],
    3,
  );
  expect(back.text).toBe("[Image #5] then [Image #4]");
  expect(back.images.map((i) => i.n)).toEqual([4, 5]);
  // A message from before pills keeps its images unnumbered, so still attached.
  expect(imagesAfter("plain", [shot("z")], 3).images[0].n).toBeUndefined();
});

it("shortens long names in the middle, keeping the extension", () => {
  expect(shortImageName("image.png")).toBe("image.png");
  expect(shortImageName("Screenshot 2026-10-01 at 13.42.10.png")).toBe(
    "Screenshot 2026…2.10.png",
  );
});

it("turns image tokens into pills and back", () => {
  const schema = getSchema([StarterKit, ImageTag]);
  const draft = "hello [Image #1] and [Image #2]\nbye";
  const doc = schema.nodeFromJSON(promptContent(draft, {}));
  const pills: number[] = [];
  doc.descendants((node) => {
    if (node.type.name === "relayImage") pills.push(node.attrs.n);
  });
  expect(pills).toEqual([1, 2]);
  expect(promptText(doc)).toBe(draft);
});
