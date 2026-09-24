import {
  test,
  expect,
  _electron as electron,
  type Page,
  type CDPSession,
} from "@playwright/test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fixtureServer } from "../fixtures/gitea";

// A benchmark, not a check: how long a keystroke in the composer takes to
// reach the screen, and how busy the main thread is between keystrokes, with
// and without agent turns running in the sidebar. Opt in with RELAY_PERF=1.
// RELAY_PERF_VARIANTS='[["label", "css"], …]' tries CSS changes on the same
// running threads; RELAY_PERF_OUT picks where the JSON goes.
test.skip(process.env.RELAY_PERF !== "1", "benchmark; set RELAY_PERF=1");
test.setTimeout(240_000);

const TEXT = "the quick brown fox jumps over the lazy dog again";

interface TraceEvent {
  name: string;
  ph: string;
  dur?: number;
  pid: number;
  tid: number;
  args?: { name?: string };
}

/** Main-thread time spent while `run` goes, from a Chrome trace. */
async function mainThread<T>(cdp: CDPSession, run: () => Promise<T>) {
  const events: TraceEvent[] = [];
  const collect = (e: { value: unknown[] }) =>
    events.push(...(e.value as TraceEvent[]));
  cdp.on("Tracing.dataCollected", collect);
  await cdp.send("Tracing.start", {
    categories:
      "toplevel,devtools.timeline,disabled-by-default-devtools.timeline",
    transferMode: "ReportEvents",
  });
  const start = Date.now();
  const result = await run();
  const wall = Date.now() - start;
  const done = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.end");
  await done;
  cdp.off("Tracing.dataCollected", collect);
  const main = events.find(
    (e) => e.name === "thread_name" && e.args?.name === "CrRendererMain",
  )!;
  const ms = (names: string[]) =>
    events
      .filter(
        (e) =>
          e.pid === main.pid &&
          e.tid === main.tid &&
          e.ph === "X" &&
          names.includes(e.name),
      )
      .reduce((sum, e) => sum + (e.dur ?? 0) / 1000, 0);
  return {
    result,
    // Top-level tasks, so nothing is counted twice.
    busyPct: +((100 * ms(["ThreadControllerImpl::RunTask"])) / wall).toFixed(1),
    paintMs: +ms(["Paint", "PrePaint", "Layerize", "Commit"]).toFixed(1),
    styleLayoutMs: +ms(["UpdateLayoutTree", "Layout"]).toFixed(1),
  };
}

/** Types TEXT and reads the browser's own Event Timing for each keystroke. */
async function typeAndMeasure(page: Page, bare = false) {
  if (bare)
    await page.evaluate(() => {
      const area = document.createElement("textarea");
      area.id = "perf-bare";
      Object.assign(area.style, {
        position: "fixed",
        left: "40%",
        top: "40%",
        zIndex: "9999",
      });
      document.body.append(area);
    });
  const input = bare
    ? page.locator("#perf-bare")
    : page.getByLabel("Message project");
  await input.click();
  await page.evaluate(() => {
    const w = window as unknown as {
      perfKeys: PerformanceEventTiming[];
      perfObserver: PerformanceObserver;
    };
    w.perfKeys = [];
    w.perfObserver = new PerformanceObserver((list) =>
      w.perfKeys.push(...(list.getEntries() as PerformanceEventTiming[])),
    );
    w.perfObserver.observe({
      type: "event",
      durationThreshold: 0,
    } as PerformanceObserverInit);
  });
  await page.keyboard.type(TEXT, { delay: 90 });
  await page.waitForTimeout(400);
  const stats = await page.evaluate(() => {
    const w = window as unknown as {
      perfKeys: PerformanceEventTiming[];
      perfObserver: PerformanceObserver;
    };
    w.perfObserver.disconnect();
    // One interaction per keystroke: its slowest event to the next paint,
    // and the script time of all its handlers.
    const keys = new Map<number, { latency: number; js: number }>();
    for (const e of w.perfKeys) {
      if (
        !e.interactionId ||
        !["keydown", "keypress", "beforeinput", "input"].includes(e.name)
      )
        continue;
      const key = keys.get(e.interactionId) ?? { latency: 0, js: 0 };
      key.latency = Math.max(key.latency, e.duration);
      key.js += e.processingEnd - e.processingStart;
      keys.set(e.interactionId, key);
    }
    const all = [...keys.values()];
    const mean = (pick: (k: (typeof all)[0]) => number) =>
      +(all.reduce((s, k) => s + pick(k), 0) / all.length).toFixed(2);
    const latencies = all.map((k) => k.latency).sort((a, b) => a - b);
    return {
      keys: all.length,
      jsMean: mean((k) => k.js),
      // Event Timing rounds durations to 8ms; the mean over many keys is finer.
      latencyMean: mean((k) => k.latency),
      latencyP95: latencies[Math.floor(latencies.length * 0.95)],
    };
  });
  if (bare) {
    await expect(input).toHaveValue(TEXT);
    await input.evaluate((el) => el.remove());
  } else {
    await expect(input).toContainText(TEXT);
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
  }
  return stats;
}

async function scenario(
  page: Page,
  cdp: CDPSession,
  name: string,
  bare = false,
) {
  const animations = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => (a as CSSAnimation).animationName)
      .filter(Boolean),
  );
  const idle = await mainThread(cdp, () => page.waitForTimeout(3000));
  const typing = await mainThread(cdp, () => typeAndMeasure(page, bare));
  return {
    name,
    animations,
    idle: {
      busyPct: idle.busyPct,
      paintMs: idle.paintMs,
      styleLayoutMs: idle.styleLayoutMs,
    },
    typing: { ...typing.result, busyPct: typing.busyPct },
  };
}

test("composer keystroke latency, quiet and with agents running", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "relay-typing-")));
  const repo = join(root, "project"),
    bin = join(root, "bin");
  const fixture = await fixtureServer();
  await mkdir(repo);
  await mkdir(bin);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  execFileSync("git", [
    "-C",
    repo,
    "remote",
    "add",
    "origin",
    fixture.serverUrl + "/Web/web-store.git",
  ]);
  await writeFile(
    join(bin, "codex"),
    `#!${process.execPath}\n` +
      (await readFile(resolve("tests/fixtures/room-agent.cjs"), "utf8")),
    { mode: 0o700 },
  );
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([k, v]) => k !== "ELECTRON_RUN_AS_NODE" && v !== undefined,
    ),
  ) as Record<string, string>;
  const app = await electron.launch({
    args: ["tests/fixtures/launch.cjs"],
    env: {
      ...env,
      PATH: bin + ":/usr/bin:/bin:/usr/sbin:/sbin",
      RELAY_TEST_DATA: join(root, "data"),
      RELAY_TEST_HEADED: "0",
      RELAY_TEST_NATIVE_STORAGE: "0",
    },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ dialog }, repo) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [repo],
      });
    }, repo);
    await page.evaluate(async (url) => {
      await window.relay.connect(url, "test-token");
      await window.relay.addProject();
    }, fixture.serverUrl);
    await page.reload();
    const cdp = await page.context().newCDPSession(page);
    const input = page.getByLabel("Message project");
    const stop = page.getByRole("button", { name: "Stop answer", exact: true });
    const newThread = async () => {
      await page
        .getByRole("button", { name: "New thread", exact: true })
        .first()
        .click();
      await expect(stop).toHaveCount(0);
      // The project ribbon plays once for 7s on a new thread.
      await page.waitForTimeout(8000);
    };
    const results = [];
    // Warm up, so first renders don't land in the first scenario.
    await typeAndMeasure(page);
    await newThread();
    results.push(await scenario(page, cdp, "quiet new thread"));
    results.push(await scenario(page, cdp, "floor: bare textarea", true));

    const running = 4;
    for (let i = 0; i < running; i++) {
      if (i > 0) await newThread();
      await input.fill(`wait for cancellation ${i + 1}`);
      await input.press("Enter");
      await expect(stop).toBeVisible();
    }
    const variants: [string, string][] = JSON.parse(
      process.env.RELAY_PERF_VARIANTS ??
        JSON.stringify([
          ["as shipped", ""],
          [
            "animations paused",
            "*, *::before, *::after { animation-play-state: paused !important; }",
          ],
        ]),
    );
    const measureVariants = async (where: string) => {
      for (const [variant, css] of variants) {
        const tag = css ? await page.addStyleTag({ content: css }) : undefined;
        results.push(
          await scenario(
            page,
            cdp,
            `${where}, ${running} running | ${variant}`,
          ),
        );
        await tag?.evaluate((el) => (el as Element).remove());
      }
    };
    await measureVariants("in a running thread");
    await newThread();
    await measureVariants("new thread");

    const out = process.env.RELAY_PERF_OUT ?? "test-results";
    await mkdir(out, { recursive: true });
    await writeFile(
      join(out, `typing-latency-${Date.now()}.json`),
      JSON.stringify(results, null, 2),
    );
    console.table(
      results.map((r) => ({
        scenario: r.name,
        "js/key ms": r.typing.jsMean,
        "key→paint ms": r.typing.latencyMean,
        "p95 ms": r.typing.latencyP95,
        "idle busy %": r.idle.busyPct,
      })),
    );
  } finally {
    await app.close();
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
