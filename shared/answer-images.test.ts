import { expect, it } from "vitest";
import { answerImagePaths, localImagePath } from "./answer-images";

const root = "/work/relay";

it("resolves the forms an agent writes an image in", () => {
  expect(localImagePath("/tmp/after.png", root)).toBe("/tmp/after.png");
  expect(localImagePath("docs/shot.png", root)).toBe(
    "/work/relay/docs/shot.png",
  );
  expect(localImagePath("./a/../b.jpg", root)).toBe("/work/relay/b.jpg");
  expect(localImagePath("file:///tmp/my%20shot.png", root)).toBe(
    "/tmp/my shot.png",
  );
  expect(localImagePath("shots/my%20shot.webp", root)).toBe(
    "/work/relay/shots/my shot.webp",
  );
});

it("leaves out what isn't a local image file", () => {
  expect(localImagePath("https://example.com/a.png", root)).toBeNull();
  expect(localImagePath("data:image/png;base64,AAAA", root)).toBeNull();
  expect(localImagePath("/etc/passwd", root)).toBeNull();
  expect(localImagePath("notes.svg", root)).toBeNull();
  expect(localImagePath("%E0%A4%A.png", root)).toBeNull();
});

it("lists only images, not links or code that mention a path", () => {
  const body = [
    'Before: ![](/tmp/before.png) and after: ![after](<shots/after.png> "title")',
    "A [link](/tmp/link.png), `/tmp/code.png`, and ![](https://x.dev/r.png).",
    "Again ![](/tmp/before.png)",
  ].join("\n");
  expect(answerImagePaths(body, root)).toEqual([
    "/tmp/before.png",
    "/work/relay/shots/after.png",
  ]);
});
