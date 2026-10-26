import {
  relayEnv,
  test,
  expect,
  _electron as electron,
  type Page,
  type CDPSession,
} from "../fixtures/electron";
import { execFile, execFileSync, spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fakeCli, pathWith } from "../fixtures/fake-cli";
import { openSurface } from "../fixtures/navigation";
import {
  HOVER,
  changedEverywhere,
  cpp,
  editable,
  heapAfterGc,
  hoverAround,
  markScroller,
  openTimed,
  scrollThrough,
  typescript,
} from "../fixtures/editor-bench";
import {
  frames,
  mainThread,
  profiled,
  typeAndMeasure,
} from "../fixtures/renderer-measure";

// A benchmark, not a check: what the Files editor costs while it opens,
// idles, types and scrolls, in the renderer, the GPU process and any
// language server. Opt in with RELAY_PERF=1; RELAY_PERF_OUT picks the folder
// for the JSON (phases with in-page numbers) and the OS samples (macOS only).
test.skip(process.env.RELAY_PERF !== "1", "benchmark; set RELAY_PERF=1");

test.setTimeout(600_000);

const out = process.env.RELAY_PERF_OUT ?? join(tmpdir(), "relay-editor-perf");
const PHASE_MS = 10_000;
const TYPED = "const total = items.reduce((sum, item) => sum + item.price, 0);";

const run = promisify(execFile);

/** The whole machine's GPU busy share, as macOS reports it; other apps count too. */
async function gpuPercent() {
  const { stdout } = await run("ioreg", [
    "-r",
    "-d",
    "1",
    "-w",
    "0",
    "-c",
    "IOAccelerator",
  ]);
  const found = /"Device Utilization %"=(\d+)/.exec(stdout);
  return found ? Number(found[1]) : NaN;
}

type Phase = { name: string; start: number; end: number; [k: string]: unknown };
const phases: Phase[] = [];

/** Runs `body` as a named phase, sampling the GPU while it goes. */
async function phase<T extends Record<string, unknown>>(
  name: string,
  body: () => Promise<T | void>,
) {
  const gpu: number[] = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      gpu.push(await gpuPercent());
      await new Promise((r) => setTimeout(r, 250));
    }
  })();
  const start = Date.now() / 1000;
  const result = (await body()) ?? {};
  const end = Date.now() / 1000;
  sampling = false;
  await sampler;
  const gpuMean = gpu.reduce((s, v) => s + v, 0) / Math.max(gpu.length, 1);
  phases.push({ name, start, end, gpuPercent: +gpuMean.toFixed(1), ...result });
}

/**
 * A 3k-line file with ~200 changes opened from the Changes list, so its
 * changes show inline: scrolling and typing with them, then with change bars
 * only. Then hovers, over and over.
 */
async function changesAndHovers(
  page: Page,
  cdp: CDPSession,
  hoverFile: string,
) {
  const sidebar = page.locator(".project-file-list");
  await sidebar.getByRole("tab", { name: /^Changes/ }).click();
  await sidebar
    .getByRole("button", { name: "Modified src/changed.ts" })
    .click();
  const files = page.locator(".files-main");
  await expect(files.locator(".cm-deletedChunk").first()).toBeVisible({
    timeout: 60_000,
  });
  await editable(page).click();
  await page.waitForTimeout(2000);
  await markScroller(page);
  const inline = (label: string) =>
    `${label}, 3k-line file with inline changes`;
  await phase(inline("scrolling"), () =>
    frames(page, () => scrollThrough(page)),
  );
  await phase(inline("scrolling") + " traced", () =>
    mainThread(cdp, () =>
      profiled(cdp, out, "scrolling-inline", () => scrollThrough(page)),
    ),
  );
  await page.keyboard.press("ControlOrMeta+Home");
  await files.getByText("export function total2(").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await phase(inline("typing"), () => typeAndMeasure(page, TYPED));
  await phase(inline("typing") + " traced", () =>
    mainThread(cdp, () =>
      profiled(cdp, out, "typing-inline", () =>
        page.keyboard.type(TYPED, { delay: 90 }),
      ),
    ),
  );

  await files.getByRole("button", { name: "Show changes since HEAD" }).click();
  await expect(files.locator(".cm-deletedChunk")).toHaveCount(0);
  // The toggle took the focus; the editor needs it back for the keys below.
  await editable(page).focus();
  const barsOnly = (label: string) => `${label}, same file, change bars only`;
  await phase(barsOnly("scrolling"), () =>
    frames(page, () => scrollThrough(page)),
  );
  await page.keyboard.press("ControlOrMeta+Home");
  await files.getByText("export function total3(").first().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await phase(barsOnly("typing"), () => typeAndMeasure(page, TYPED));

  await page.keyboard.press("ControlOrMeta+s");
  await page.keyboard.press("ControlOrMeta+Home");
  await writeFile(hoverFile, HOVER);
  await page.waitForTimeout(1000);
  await phase("hovering, 60 cards", async () => {
    const heapBefore = await heapAfterGc(cdp);
    let hovers = {};
    const frameStats = await frames(page, async () => {
      hovers = await hoverAround(page, 60, out);
    });
    return {
      ...hovers,
      ...frameStats,
      cardsLeft: await page.locator(".cm-tooltip").count(),
      heapGrowthKb: Math.round(((await heapAfterGc(cdp)) - heapBefore) / 1024),
    };
  });
  await phase("hovering, 30 cards traced", () =>
    mainThread(cdp, () =>
      profiled(
        cdp,
        out,
        "hovering",
        async () => void (await hoverAround(page, 30, out)),
      ),
    ),
  );
}

test("the Files editor's CPU, GPU and frame cost", async () => {
  await mkdir(out, { recursive: true });
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "relay-editor-perf-")),
  );
  const repo = join(root, "app"),
    bin = join(root, "bin");
  await mkdir(join(repo, "src"), { recursive: true });
  await mkdir(bin);
  await writeFile(join(repo, "src/medium.ts"), typescript(3_000));
  await writeFile(join(repo, "src/huge.ts"), typescript(35_000));
  await writeFile(join(repo, "src/main.cpp"), cpp(3_000));
  await writeFile(join(repo, "src/changed.ts"), typescript(3_000));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  git("init", "-q");
  git("config", "user.name", "Fixture Author");
  git("config", "user.email", "fixture@example.invalid");
  git("add", ".");
  git("commit", "-qm", "Base");
  // A few changed lines, so the change bars have something to show.
  const medium = (await readFile(join(repo, "src/medium.ts"), "utf8")).split(
    "\n",
  );
  for (const at of [100, 400, 1200, 2500]) medium[at] = "// changed here " + at;
  await writeFile(join(repo, "src/medium.ts"), medium.join("\n"));
  await writeFile(
    join(repo, "src/changed.ts"),
    changedEverywhere(typescript(3_000)),
  );
  await fakeCli(
    join(bin, "codex"),
    await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8"),
  );
  // TypeScript gets a quiet stand-in server, so its numbers are the editor's, not tsserver's.
  await fakeCli(
    join(bin, "vtsls"),
    `import(${JSON.stringify(resolve("tests/fixtures/fake-lsp-server.mjs"))});`,
  );

  const env = relayEnv();
  const app = await electron.launch({
    env: {
      ...env,
      ...pathWith(env, bin),
      RELAY_TEST_DATA: join(root, "data"),
      FAKE_LSP_HOVER_FILE: join(root, "hover.md"),
    },
  });
  const samples = join(out, "samples.jsonl");
  await writeFile(samples, "");
  const sampler = spawn("python3", [
    resolve(
      process.env.RELAY_PERF_SAMPLER ?? "/tmp/relay-perf-harness/sample_mac.py",
    ),
    String(app.process().pid),
    "0.5",
    "900",
    samples,
  ]);
  try {
    const page = await app.firstWindow();
    page.on("dialog", () => {});
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [folder],
      });
    }, repo);
    await page.evaluate(() => window.relay.addProject());
    await page.reload();
    await page.getByLabel("Message project").fill("hello");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await openSurface(page, "Files");
    const cdp = await page.context().newCDPSession(page);
    // The test window is never focused for real; a caret only blinks in a focused page.
    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.waitForTimeout(3000);

    await phase("idle, no file open", () => page.waitForTimeout(PHASE_MS));
    const openMedium = await openTimed(
      page,
      "src/medium.ts",
      "export interface Item0 ",
    );
    await editable(page).click();
    await page.keyboard.press("ControlOrMeta+Home");
    await page.waitForTimeout(2000);
    await phase("idle, 3k-line file focused", async () => {
      await page.waitForTimeout(PHASE_MS);
      return { openMs: openMedium };
    });
    await phase("idle, 3k-line file traced", () =>
      mainThread(cdp, () => page.waitForTimeout(3000)),
    );
    await page
      .locator(".files-main")
      .getByText("export function total2(")
      .first()
      .click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await phase("typing, 3k-line file", async () => {
      const keys = await typeAndMeasure(page, TYPED);
      return keys;
    });
    await phase("typing, 3k-line file traced", () =>
      mainThread(cdp, () =>
        profiled(cdp, out, "typing", () =>
          page.keyboard.type(TYPED, { delay: 90 }),
        ),
      ),
    );

    // The old editor asks before leaving unsaved edits; both save here so they run alike.
    await page.keyboard.press("ControlOrMeta+s");
    await page.waitForTimeout(1000);
    const openHuge = await openTimed(
      page,
      "src/huge.ts",
      "export interface Item0 ",
    );
    await editable(page).click();
    await page.waitForTimeout(2000);
    await markScroller(page);
    await phase("idle, 35k-line file focused", async () => {
      await page.waitForTimeout(PHASE_MS);
      return { openMs: openHuge };
    });
    await phase("scrolling, 35k-line file", () =>
      frames(page, () => scrollThrough(page)),
    );
    await phase("scrolling, 35k-line file traced", () =>
      mainThread(cdp, () =>
        profiled(cdp, out, "scrolling", () => scrollThrough(page)),
      ),
    );
    await page
      .locator(".files-main")
      .getByText("export interface Item0 ")
      .first()
      .click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await phase("typing, 35k-line file", () => typeAndMeasure(page, TYPED));

    await page.keyboard.press("ControlOrMeta+s");
    await page.waitForTimeout(1000);
    const openCpp = await openTimed(page, "src/main.cpp", "int total0(");
    await editable(page).click();
    await page.waitForTimeout(5000);
    await phase("idle, C++ file with clangd", async () => {
      await page.waitForTimeout(PHASE_MS);
      return { openMs: openCpp };
    });
    await page.locator(".files-main").getByText("int total2(").first().click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await phase("typing, C++ file with clangd", async () => {
      const keys = await typeAndMeasure(page, TYPED);
      await page.waitForTimeout(3000);
      return keys;
    });
    await phase("unfocused, C++ file open", async () => {
      await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
      // The test window counts as focused whatever happens, so mark it the way a real blur does.
      await page.evaluate(() =>
        document.documentElement.setAttribute("data-inactive", ""),
      );
      await page.waitForTimeout(PHASE_MS);
      return page.evaluate(() => ({
        inactive: document.documentElement.hasAttribute("data-inactive"),
        animations: document
          .getAnimations()
          .filter((a) => a.playState === "running")
          .map((a) =>
            `${(a as CSSAnimation).animationName ?? "?"} on ${(a.effect as KeyframeEffect)?.target?.className}`.slice(
              0,
              120,
            ),
          ),
      }));
    });

    await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await page.evaluate(() =>
      document.documentElement.removeAttribute("data-inactive"),
    );
    await changesAndHovers(page, cdp, join(root, "hover.md"));
  } finally {
    await writeFile(join(out, "phases.json"), JSON.stringify(phases, null, 2));
    sampler.kill();
    await app
      .evaluate(({ dialog }) => {
        dialog.showMessageBoxSync = () => 1;
      })
      .catch(() => {});
    await app.close().catch(() => {});
  }
});
