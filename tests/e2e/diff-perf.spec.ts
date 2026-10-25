import {
  relayEnv,
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "../fixtures/electron";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { currentFilePicker } from "../fixtures/current-file";
import { fixtureServer } from "../fixtures/gitea";
import { openInbox, openPull, openSignIn } from "../fixtures/navigation";
import { frames } from "../fixtures/renderer-measure";

// A benchmark, not a check: how long a pull request's big diff takes to show
// and to colour, what the renderer holds afterwards, and how scrolling it
// runs. Opt in with RELAY_PERF=1; RELAY_PERF_OUT picks the folder for the JSON.
test.skip(process.env.RELAY_PERF !== "1", "benchmark; set RELAY_PERF=1");
test.setTimeout(300_000);

const out = process.env.RELAY_PERF_OUT ?? join(tmpdir(), "relay-diff-perf");

/** A TypeScript file of about `lines` lines, varied enough to highlight like real code. */
function typescript(lines: number, edited: boolean) {
  const out: string[] = [`import { readFile } from "node:fs/promises";`, ""];
  for (let i = 0; out.length < lines; i++) {
    const changed = edited && i % 3 === 1;
    out.push(
      `/** Item ${i}: what it costs and when it was bought. */`,
      `export interface Item${i} { id: number; price: number; bought: Date; tags: string[] }`,
      `export function total${i}(items: Item${i}[], discount = ${changed ? "0.2" : "0.1"}): number {`,
      `  const sum = items.reduce((acc, item) => acc + item.price * (1 - discount), 0);`,
      `  if (sum > ${i * 10}) console.log(\`big order #${i}: \${sum.toFixed(2)}\`);`,
      `  return Math.round(sum * 100) / 100;`,
      `}`,
      "",
    );
  }
  return out.slice(0, lines).join("\n") + "\n";
}

/** The renderer process's memory, as the OS counts it (its workers included). */
async function rendererMemoryMb(app: ElectronApplication) {
  const renderers = await app.evaluate(({ BrowserWindow }) =>
    Promise.all(
      BrowserWindow.getAllWindows().map((w) => w.webContents.getOSProcessId()),
    ),
  );
  const metrics = await app.evaluate(({ app }) =>
    app
      .getAppMetrics()
      .map((m) => ({ pid: m.pid, kb: m.memory.workingSetSize })),
  );
  const kb = metrics
    .filter((m) => renderers.includes(m.pid))
    .reduce((sum, m) => sum + m.kb, 0);
  return Math.round(kb / 1024);
}

/** Whether the lines on screen have their syntax colours yet. */
const coloured = (page: Page) =>
  page.evaluate(() => {
    const host = document.querySelector("diffs-container");
    const root = host?.shadowRoot ?? host;
    const lines = [...(root?.querySelectorAll("[data-line]") ?? [])].slice(
      0,
      20,
    );
    return lines.some(
      (line) =>
        line.querySelectorAll('span[style*="--diffs-token"]').length >= 3,
    );
  });

/** Opens `path` from the review's file picker: ms until lines show, and until they're coloured. */
async function openTimed(page: Page, path: string, colour = true) {
  const started = Date.now();
  await currentFilePicker(page).selectOption(path);
  await expect
    .poll(() => page.locator("[data-line]").count(), {
      timeout: 60_000,
      intervals: [16],
    })
    .toBeGreaterThan(5);
  const shownMs = Date.now() - started;
  if (!colour) return { shownMs };
  await expect
    .poll(() => coloured(page), { timeout: 120_000, intervals: [16] })
    .toBe(true);
  return { shownMs, colouredMs: Date.now() - started };
}

async function scrollDiff(page: Page) {
  const box = (await page.locator(".diff-wrapper").boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (const direction of [1, -1])
    for (let i = 0; i < 100; i++) {
      await page.mouse.wheel(0, direction * 400);
      await page.waitForTimeout(16);
    }
}

test("a pull request's big diffs: open, colour, memory and scrolling", async () => {
  await mkdir(out, { recursive: true });
  const fixture = await fixtureServer({
    code: { before: typescript(4000, false), after: typescript(4000, true) },
  });
  const data = await mkdtemp(join(tmpdir(), "relay-diff-perf-"));
  const app = await electron.launch({
    env: { ...relayEnv(), RELAY_TEST_DATA: data },
  });
  const results: Record<string, unknown> = {};
  try {
    const page = await app.firstWindow();
    page.on("dialog", () => {});
    await openSignIn(page);
    await page
      .getByLabel("Gitea server", { exact: true })
      .fill(fixture.serverUrl);
    await page
      .getByLabel("Personal access token", { exact: true })
      .fill("test-token");
    await page.getByRole("button", { name: "Connect to Gitea" }).click();
    // Dark, whose syntax themes every highlighter ships, so they compare like for like.
    await page
      .getByRole("button", { name: "Open settings", exact: true })
      .first()
      .click();
    await page.getByRole("radio", { name: "Dark", exact: true }).click();
    await page
      .getByRole("button", { name: "Back to app", exact: true })
      .click();
    await openInbox(page);
    await openPull(page, /Make pull request reviews/);
    // Something small first, so the timings below are the big files', not the first-start costs.
    await openTimed(page, "src/styles/review.css", false);
    await page.waitForTimeout(2000);
    results.memoryBeforeMb = await rendererMemoryMb(app);
    if (process.env.RELAY_PERF_DUMP)
      console.log(
        await page
          .locator("[data-line]")
          .nth(3)
          .evaluate((el) => el.outerHTML.slice(0, 1500)),
      );

    results.medium = await openTimed(page, "src/hooks/useReview.ts");
    if (process.env.RELAY_PERF_SHOT)
      await page.locator(".diff-wrapper").screenshot({ path: process.env.RELAY_PERF_SHOT });
    await page.waitForTimeout(2000);
    results.mediumMemoryMb = await rendererMemoryMb(app);
    results.mediumScroll = await frames(page, () => scrollDiff(page));

    results.large = await openTimed(page, "src/large.ts", false);
    const enable = page.getByRole("button", {
      name: "Enable syntax highlighting",
    });
    if (await enable.isVisible()) {
      const started = Date.now();
      await enable.click();
      await expect
        .poll(() => coloured(page), { timeout: 120_000, intervals: [16] })
        .toBe(true);
      results.largeColouredMs = Date.now() - started;
    }
    await page.waitForTimeout(2000);
    results.largeMemoryMb = await rendererMemoryMb(app);
    results.largeScroll = await frames(page, () => scrollDiff(page));
    console.log("DIFF_PERF", JSON.stringify(results));
  } finally {
    await writeFile(join(out, "diff.json"), JSON.stringify(results, null, 2));
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = () => 1;
      })
      .catch(() => {});
    await app.close().catch(() => {});
    await fixture.close();
  }
});
