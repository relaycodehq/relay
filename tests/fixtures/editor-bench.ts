// What the editor benchmark opens and does: generated source files, and how
// it finds, opens, scrolls and hovers the editor whichever one shows a file.
import { expect, type CDPSession, type Page } from "@playwright/test";
import { join } from "node:path";
import { openInFileTree } from "./navigation";

/** A TypeScript file of about `lines` lines, varied enough to highlight like real code. */
export function typescript(lines: number) {
  const out: string[] = [`import { readFile } from "node:fs/promises";`, ""];
  for (let i = 0; out.length < lines; i++)
    out.push(
      `/** Item ${i}: what it costs and when it was bought. */`,
      `export interface Item${i} { id: number; price: number; bought: Date; tags: string[] }`,
      `export function total${i}(items: Item${i}[], discount = 0.1): number {`,
      `  const sum = items.reduce((acc, item) => acc + item.price * (1 - discount), 0);`,
      `  if (sum > ${i * 10}) console.log(\`big order #${i}: \${sum.toFixed(2)}\`);`,
      `  return Math.round(sum * 100) / 100;`,
      `}`,
      "",
    );
  return out.slice(0, lines).join("\n") + "\n";
}

export function cpp(lines: number) {
  const out = ["#include <string>", "#include <vector>", ""];
  for (let i = 0; out.length < lines; i++)
    out.push(
      `int total${i}(const std::vector<int>& items) {`,
      `  int sum = 0;`,
      `  for (int item : items) sum += item * ${i};`,
      `  return sum;`,
      `}`,
      "",
    );
  return out.slice(0, lines).join("\n") + "\n";
}

/** The editable surface of whichever editor shows the file. */
export const editable = (page: Page) =>
  page
    .locator('.files-main [contenteditable="true"], .files-main textarea')
    .first();

/** Marks the element that scrolls the open file, wherever the editor keeps it. */
export async function markScroller(page: Page) {
  await editable(page).evaluate((el) => {
    const scrolls = (e: Element) =>
      e.scrollHeight > e.clientHeight + 50 &&
      /auto|scroll/.test(getComputedStyle(e).overflowY);
    // Up through shadow roots too: an editor may draw inside one.
    const up = (e: Element) =>
      e.parentElement ?? (e.getRootNode() as ShadowRoot).host ?? null;
    let found: Element | null = el;
    while (found && !scrolls(found)) found = up(found);
    found?.setAttribute("data-perf-scroll", "");
  });
}

/** Opens `path` from the tree and returns how long until its text shows. */
export async function openTimed(page: Page, path: string, firstLine: string) {
  const started = Date.now();
  await openInFileTree(page, path);
  await expect(
    page.locator(".files-main").getByText(firstLine).first(),
  ).toBeVisible({ timeout: 60_000 });
  return Date.now() - started;
}

export async function scrollThrough(page: Page) {
  const box = (await page.locator("[data-perf-scroll]").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (const direction of [1, -1])
    for (let i = 0; i < 120; i++) {
      await page.mouse.wheel(0, direction * 400);
      await page.waitForTimeout(16);
    }
}

/** A hover the way vtsls answers one for a documented function. */
export const HOVER = [
  "```typescript",
  'function total2(items: Item2[], discount?: number, rounding?: "up" | "down"): number',
  "```",
  "",
  "Adds up what the items cost after `discount`, rounded to cents.",
  "",
  "*@param* `items` — what was bought",
  "",
  "*@param* `discount` — taken off every price",
  "",
  "*@returns* the total, in the items' currency",
].join("\n");

/** Middles of the words a pointer can rest on in the editor's visible lines. */
export async function hoverTargets(page: Page) {
  return page
    .locator(".files-main .cm-content")
    .first()
    .evaluate((content) => {
      const scroller = content.closest(".cm-scroller")!.getBoundingClientRect();
      const out: { x: number; y: number }[] = [];
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      for (
        let node = walker.nextNode();
        node && out.length < 40;
        node = walker.nextNode()
      )
        for (const word of node.textContent!.matchAll(/[A-Za-z_]\w{3,}/g)) {
          const range = document.createRange();
          range.setStart(node, word.index!);
          range.setEnd(node, word.index! + word[0].length);
          const r = range.getBoundingClientRect();
          if (
            r.width &&
            // Inside the editor: long lines run past its right edge, clipped.
            r.right < scroller.right - 20 &&
            r.top > scroller.top + 40 &&
            r.bottom < scroller.bottom - 200
          )
            out.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
        }
      return out;
    });
}

/**
 * Rests the pointer on `count` words in turn, each until its card shows with
 * its declaration: how long that took, the editor's hover delay included.
 */
export async function hoverAround(page: Page, count: number, out: string) {
  const targets = await hoverTargets(page);
  expect(targets.length).toBeGreaterThan(5);
  const waits: number[] = [];
  for (let i = 0; i < count; i++) {
    const target = targets[i % targets.length];
    // Off the editor first: straight from word to word, the pointer would
    // land on the last card, which rightly stays open under it.
    await page.mouse.move(5, 5);
    await expect(page.locator(".cm-tooltip:has(.hover-card)")).toHaveCount(0);
    const started = Date.now();
    await page.mouse.move(target.x, target.y, { steps: 3 });
    await page
      .locator(".cm-tooltip .hover-card-place")
      .waitFor({ timeout: 10_000 })
      .catch(async (error) => {
        await page.screenshot({ path: join(out, `hover-miss-${i}.png`) });
        throw new Error(`No card for hover ${i} at ${target.x},${target.y}`, {
          cause: error,
        });
      });
    waits.push(Date.now() - started);
  }
  await page.mouse.move(5, 5);
  await page.waitForTimeout(500);
  waits.sort((a, b) => a - b);
  return {
    hovers: count,
    hoverShowMean: Math.round(waits.reduce((s, v) => s + v, 0) / waits.length),
    hoverShowP95: waits[Math.floor(waits.length * 0.95)],
  };
}

/** The renderer's JS heap after a full collection. */
export async function heapAfterGc(cdp: CDPSession) {
  await cdp.send("HeapProfiler.collectGarbage");
  return ((await cdp.send("Runtime.getHeapUsage")) as { usedSize: number })
    .usedSize;
}

/** Lines changed, removed and added all through the file, so inline changes have plenty to show. */
export function changedEverywhere(text: string) {
  const out: string[] = [];
  text.split("\n").forEach((line, i) => {
    if (i % 60 === 30) return;
    out.push(i % 25 === 10 ? `${line} // changed` : line);
    if (i % 90 === 45) out.push("// added here", "// and here");
  });
  return out.join("\n");
}
