// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { copiedImages, messageHtml } from "./image-clipboard";

const png = "data:image/png;base64,iVBORw0KGgo=";

it("carries a message's screenshots through its HTML, each with its token", async () => {
  const html = messageHtml("a <b> & [Image #2]\nthen [Image #9]", [
    { n: 2, name: 'say "cheese".png', src: png },
    { n: 3, name: "image.png", src: png },
  ]);
  // The text stays text; a token without a screenshot stays as written.
  expect(html).toContain("a &lt;b&gt; &amp; <img");
  expect(html).toContain("<br>then [Image #9]");
  const copied = copiedImages(html);
  expect(copied.map(({ n, file }) => [n, file.name, file.type])).toEqual([
    [2, 'say "cheese".png', "image/png"],
    [3, "image.png", "image/png"],
  ]);
  expect([...new Uint8Array(await copied[0].file.arrayBuffer())]).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
});

it("gives a screenshot whose token a message repeats as one file", () => {
  const copied = copiedImages(
    messageHtml("[Image #1] and again [Image #1]", [
      { n: 1, name: "a.png", src: png },
    ]),
  );
  expect(copied.map(({ n }) => n)).toEqual([1, 1]);
  expect(copied[0].file).toBe(copied[1].file);
});

it("finds nothing in HTML from elsewhere, or in a marked image that isn't data", () => {
  expect(
    copiedImages('<p>hi <img src="https://example.com/a.png"></p>'),
  ).toEqual([]);
  expect(
    copiedImages('<img data-relay-image="1" src="https://example.com/a.png">'),
  ).toEqual([]);
});

it("brings a browser comment back with its screenshot, and shows it as text elsewhere", () => {
  const browser = {
    id: "b74407b4-0d67-434d-9da6-7fa8f71f88be",
    url: "http://localhost:3000/",
    selector: "#card",
    tag: '<button id="card">',
    text: "Card",
    comment: 'Make it "bigger" & bolder',
    rect: { x: 1, y: 1, width: 10, height: 10 },
    viewport: { width: 800, height: 600 },
  };
  const html = messageHtml("Fix these", [
    { n: 1, name: "Browser comment.png", src: png, browser },
  ]);
  expect(
    new DOMParser().parseFromString(html, "text/html").body.textContent,
  ).toContain('Make it "bigger" & bolder');
  expect(copiedImages(html)[0].browser).toEqual(browser);
  // Something that isn't a valid comment pastes as a plain screenshot.
  expect(
    copiedImages(
      `<img data-relay-image="" data-name="a.png" data-browser="{}" src="${png}">`,
    )[0].browser,
  ).toBeUndefined();
});
