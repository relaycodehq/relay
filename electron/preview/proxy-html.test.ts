import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { TitlePrefix } from "./proxy-html";
async function tag(chunks: Buffer[]) {
  const result: Buffer[] = [];
  for await (const chunk of Readable.from(chunks).pipe(
    new TitlePrefix("fix-login"),
  ))
    result.push(chunk);
  return Buffer.concat(result).toString();
}
describe("TitlePrefix", () => {
  it("preserves Unicode split across chunks while tagging the actual title", async () => {
    const html = "<head><title>Žluťoučký</title></head><body>Žluťoučký</body>";
    expect(await tag([...Buffer.from(html)].map((b) => Buffer.from([b])))).toBe(
      html.replace("<title>", "<title>[fix-login] "),
    );
  });
  it("leaves a head without a title and titles beyond the bounded buffer intact", async () => {
    expect(await tag([Buffer.from("<h1>No title</h1>")])).toBe(
      "<h1>No title</h1>",
    );
    const html =
      "<html>" + "x".repeat(70 * 1024) + "<title>Late</title></html>";
    expect(
      await tag([
        Buffer.from(html.slice(0, 66 * 1024)),
        Buffer.from(html.slice(66 * 1024)),
      ]),
    ).toBe(html);
  });
  it("skips title-like text in comments, scripts and attributes even across chunks", async () => {
    const html = `<head><!-- <title>Comment</title> --><script>const example = "<title>Script</title>";</script><meta content="<title>Attribute</title>"><title data-example=">">Real</title></head>`;
    expect(await tag([...Buffer.from(html)].map((b) => Buffer.from([b])))).toBe(
      html.replace(">Real</title>", ">[fix-login] Real</title>"),
    );
  });
});
