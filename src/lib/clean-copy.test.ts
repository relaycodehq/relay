// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { cleanHtml } from "./clean-copy";

function selected(html: string) {
  document.body.innerHTML = `<div class="markdown" style="background:#111;color:#eee">${html}</div>`;
  const range = document.createRange();
  range.selectNodeContents(document.body.firstElementChild!);
  return cleanHtml(range);
}

it("keeps web links and drops the theme", () => {
  expect(
    selected(
      '<p style="color:#eee">See <a class="x" href="https://example.com">docs</a> or <a href="http://localhost:5173/">local</a></p>',
    ),
  ).toBe(
    '<p>See <a href="https://example.com">docs</a> or <a href="http://localhost:5173/">local</a></p>',
  );
});

it("flattens links to files on this computer into their text", () => {
  expect(
    selected(
      '<p><a href="file:///Users/me/a.ts">a.ts</a> and <button class="chat-file-link" title="/Users/me/b.ts"><svg></svg><span>b.ts · L4</span></button></p>',
    ),
  ).toBe("<p>a.ts and <span>b.ts · L4</span></p>");
});

it("leaves out text markers and controls so the target numbers its own list", () => {
  expect(
    selected(
      '<ol start="3"><li class="markdown-item"><span aria-hidden="true">3.&nbsp;</span>Third</li></ol><button title="Copy code"><svg></svg></button>',
    ),
  ).toBe('<ol start="3"><li>Third</li></ol>');
});
