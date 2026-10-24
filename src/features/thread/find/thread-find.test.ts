// @vitest-environment happy-dom
import { expect, it } from "vitest";
import type { ChatMessage } from "../../../../shared/projects";
import { findInThread, offsetsOf, oldestWith } from "./thread-find";

function column(html: string) {
  const element = document.createElement("div");
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

it("finds a phrase across inline formatting and maps it back to the text", () => {
  const view = column(`
    <article data-message-id="a"><p>Run <code>npm run</code> dev now</p></article>
    <article data-message-id="b"><p>npm Run, then NPM run again</p>
      <div data-message-id="nested"><p>npm run inside</p></div>
    </article>
    <article data-message-id="c"><p aria-hidden="true">npm run hidden</p></article>
  `);
  const found = findInThread(view, "run npm run");
  expect(found).toHaveLength(1);
  expect(found[0].range.toString()).toBe("Run npm run");

  const all = findInThread(view, "npm run");
  expect(all.map((m) => [m.id, m.nth, m.range.toString()])).toEqual([
    ["a", 0, "npm run"],
    ["b", 0, "npm Run"],
    ["b", 1, "NPM run"],
    ["b", 2, "npm run"],
  ]);
  view.remove();
});

it("keeps case when lowercasing would move the offsets", () => {
  expect(offsetsOf("İstanbul istanbul", "istanbul")).toEqual([9]);
  expect(offsetsOf("aaaa", "aa")).toEqual([0, 2]);
});

it("finds the oldest message to mount back to through markdown marks", () => {
  const shown = ["plain", "the **Zeph**yr build", "zephyr build"].map(
    (body, i) => ({ id: `m-${i}`, body }) as ChatMessage,
  );
  expect(oldestWith(shown, "zephyr build")?.id).toBe("m-1");
  expect(oldestWith(shown, "snake_case")).toBeUndefined();
});
