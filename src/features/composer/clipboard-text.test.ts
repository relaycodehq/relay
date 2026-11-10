import { describe, expect, it } from "vitest";
import { textIsTheContent, type ClipboardFile } from "./clipboard-text";

const picture: ClipboardFile = { image: true, onDisk: false };
const none = { plain: "", html: "", rtf: "" };

describe("textIsTheContent", () => {
  it("takes the text of cells copied in a spreadsheet, which come with a picture", () => {
    expect(
      textIsTheContent({
        plain: "Name\tQty\nBolts\t12",
        html: "<html><head><style>td { color: red }</style></head><body><!--StartFragment--><table><tr><td>Name</td><td>Qty</td></tr></table></body></html>",
        rtf: "",
        files: [picture],
      }),
    ).toBe(true);
  });

  it("takes the text when the rich form is RTF", () => {
    expect(
      textIsTheContent({
        plain: "a paragraph",
        html: "",
        rtf: "{\\rtf1 a paragraph}",
        files: [picture],
      }),
    ).toBe(true);
  });

  it("keeps a picture copied in a browser, with or without its address", () => {
    const html = `<meta charset="utf-8"><img src="https://example.com/cat.png">`;
    const files = [picture];
    expect(textIsTheContent({ plain: "", html, rtf: "", files })).toBe(false);
    expect(
      textIsTheContent({
        plain: "https://example.com/cat.png",
        html,
        rtf: "",
        files,
      }),
    ).toBe(false);
  });

  it("keeps a screenshot", () => {
    expect(textIsTheContent({ ...none, files: [picture] })).toBe(false);
  });

  it("keeps a file copied in the file manager, whose name comes as text", () => {
    expect(
      textIsTheContent({
        plain: "report.png",
        html: "",
        rtf: "",
        files: [{ image: true, onDisk: true }],
      }),
    ).toBe(false);
  });

  it("keeps a file that is not a picture", () => {
    expect(
      textIsTheContent({
        plain: "a b",
        html: "<p>a b</p>",
        rtf: "",
        files: [picture, { image: false, onDisk: false }],
      }),
    ).toBe(false);
  });
});
