import { relayEnv, test, expect, _electron as electron } from "../fixtures/electron";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { openInFileTree, openSurface } from "../fixtures/navigation";
import { screenshot } from "../fixtures/screenshot";

// Docs as long as a constructor's, so the card is tall and opens above the line.
const docs = [
  "```ts",
  "constructor(options: { name: string; retries?: number; timeout?: number }): Client",
  "```",
  "",
  "Makes a client that talks to the server.",
  "",
  ...Array.from({ length: 6 }, (_, i) => `- \`option${i}\`: what it changes, at some length.`),
].join("\n");

const padding = Array.from({ length: 30 }, (_, i) => `// line ${i + 1}`).join("\n");

test("a hover card opens clear of the word and stays while the pointer rests on it", async () => {
  test.setTimeout(120_000);
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-hover-"))),
    repo = join(root, "app"),
    bin = join(root, "bin");
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(bin);
  await writeFile(join(repo, "src/client.ts"), `${padding}\nconst client = new Client({ name: "relay" });\n`);
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.name", "Fixture Author");
  git("config", "user.email", "fixture@example.invalid");
  git("add", ".");
  git("commit", "-qm", "Base");
  await fakeCli(join(bin, "codex"), await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"));
  await fakeCli(
    join(bin, "vtsls"),
    `import(${JSON.stringify(resolve("tests/fixtures/fake-lsp-server.mjs"))});`,
  );
  const env = relayEnv();
  const app = await electron.launch({
    env: { ...env, ...pathWith(env, bin), RELAY_TEST_DATA: join(root, "data"),
      FAKE_LSP_HOVER: docs,
      FAKE_LSP_SLOW_DEFINITION: "1500",
    },
  });
  try {
    const page = await app.firstWindow();
    page.on("dialog", () => {});
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();
    await page.getByLabel("Message project").fill("hello");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await openSurface(page, "Files");
    await openInFileTree(page, "src/client.ts");
    const editor = page.locator(".project-inline-editor");
    const line = editor.locator(".cm-line", { hasText: "new Client" });
    await line.scrollIntoViewIfNeeded();
    const card = page.locator(".cm-tooltip:has(.hover-card)");
    // The pointer rests on the start of "client", inside the server's range.
    const at = async () => {
      const box = (await line.boundingBox())!;
      return { x: box.x + 8 * 8, y: box.y + box.height / 2, top: box.y, bottom: box.y + box.height };
    };
    // Every frame, whether a card lies under the pointer: one that does takes
    // the pointer off the editor, which then closes it.
    const watchCovering = (x: number, y: number) =>
      page.evaluate(
        ([x, y]) => {
          const seen: string[] = [];
          (window as unknown as { coveredAt: string[] }).coveredAt = seen;
          const tick = () => {
            for (const card of document.querySelectorAll(".cm-tooltip-hover")) {
              const r = card.getBoundingClientRect();
              if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
                seen.push(`${Math.round(r.top)}..${Math.round(r.bottom)}`);
            }
            requestAnimationFrame(tick);
          };
          tick();
        },
        [x, y],
      );
    await expect(async () => {
      await page.mouse.move(0, 0);
      const { x, y } = await at();
      await watchCovering(x, y);
      await page.mouse.move(x, y);
      await expect(card).toContainText("Makes a client", { timeout: 3000 });
    }).toPass({ timeout: 45_000 });

    // The card doesn't wait for where the symbol is declared, and keeps its
    // size and place when that fills in.
    const declaration = card.locator(".hover-card-place");
    await expect(declaration).toHaveCount(0);
    const before = await card.boundingBox();
    await expect(declaration).toContainText("src/other.txt");
    expect(await card.boundingBox()).toEqual(before);

    // Still there once it has settled, and never under the pointer on the way.
    await page.waitForTimeout(600);
    await expect(card).toBeVisible();
    const covered = await page.evaluate(() => (window as unknown as { coveredAt: string[] }).coveredAt);
    expect(covered, "frames where the card lay under the pointer").toEqual([]);
    const word = await at();
    await screenshot(page, { path: "test-results/screenshots/editor-hover.png" });

    // Small moves within the word, as a resting hand makes, keep it open.
    for (const dx of [1, -1, 2, -2, 1]) {
      await page.mouse.move(word.x + dx, word.y);
      await page.waitForTimeout(150);
    }
    await expect(card).toBeVisible();

    // Into the card to read it, and back down onto the word: the same card stays,
    // rather than closing and a new one opening after the hover delay.
    await card.evaluate((node) => node.setAttribute("data-first", ""));
    const above = (await card.boundingBox())!;
    await page.mouse.move(word.x, above.y + above.height / 2, { steps: 8 });
    await page.mouse.move(word.x, word.y, { steps: 8 });
    await page.waitForTimeout(100);
    expect(await page.locator(".cm-tooltip[data-first]").count()).toBe(1);
  } finally {
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = () => 1;
      })
      .catch(() => {});
    await app.close().catch(() => {});
  }
});
