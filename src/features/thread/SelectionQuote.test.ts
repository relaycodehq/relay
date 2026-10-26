// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { takesTextOnlyFrom } from "./SelectionQuote";

function thread() {
  document.body.innerHTML = `
    <article class="project-message" id="answer"><p id="last">Tests pass.</p><footer>133 tok/s</footer></article>
    <article class="project-message" id="next"><p id="reply">Thanks</p></article>`;
  const at = (id: string) => document.getElementById(id)!;
  return { answer: at("answer"), last: at("last"), reply: at("reply") };
}

describe("takesTextOnlyFrom", () => {
  it("keeps a triple-click that ends at the start of the next message", () => {
    const { answer, last, reply } = thread();
    const range = document.createRange();
    range.setStart(last.firstChild!, 0);
    range.setEnd(reply, 0);
    expect(takesTextOnlyFrom(answer, range)).toBe(true);
  });

  it("drops a selection that takes text from the next message", () => {
    const { answer, last, reply } = thread();
    const range = document.createRange();
    range.setStart(last.firstChild!, 0);
    range.setEnd(reply.firstChild!, 3);
    expect(takesTextOnlyFrom(answer, range)).toBe(false);
  });
});
