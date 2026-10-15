// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { passageIn, quotedPassage } from "./quote-passage";

const thread = (html: string) => {
  const view = document.createElement("div");
  view.innerHTML = html;
  return view;
};

it("finds a quote however its spaces, breaks and list markers came out", () => {
  const view = thread(`
    <article data-message-id="a"><div class="markdown">
      <p>Ideas, cheapest wins first:</p>
      <ol><li>Open threads <em>from</em> the cache</li><li>Skip the re-render</li><li>Outbox</li></ol>
    </div></article>`);
  const passage = passageIn(
    view.firstElementChild!,
    "1. Open threads from  the cache\n\n2. Skip the re-render",
  );
  expect(passage?.toString()).toBe(
    "Open threads from the cacheSkip the re-render",
  );
});

it("takes the nearest message above the quote, and not the quote's own pill", () => {
  const view = thread(`
    <article data-message-id="old"><div class="markdown"><p>Use the theme variable.</p></div></article>
    <article data-message-id="new"><div class="markdown"><p>Again: use the theme variable.</p></div></article>
    <article data-message-id="quoting"><div class="markdown">
      <span class="prompt-pill quote">Use the theme variable.</span>
    </div></article>
    <article data-message-id="later"><div class="markdown"><p>Use the theme variable.</p></div></article>`);
  const quoting = view.querySelector('[data-message-id="quoting"]')!;
  expect(quotedPassage(view, quoting, "use the theme variable")?.id).toBe(
    "new",
  );
  expect(quotedPassage(view, quoting, "something nobody said")).toBeUndefined();
});
