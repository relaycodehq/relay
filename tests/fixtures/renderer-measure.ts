// What the renderer spends while a benchmark drives it: frames, keystrokes,
// main-thread time and CPU profiles, read through the page and DevTools.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CDPSession, Page } from "@playwright/test";

/** Frame gaps and long animation frames while `body` runs. */
export async function frames(page: Page, body: () => Promise<void>) {
  await page.evaluate(() => {
    const w = window as unknown as {
      perf: { gaps: number[]; loaf: number; on: boolean };
    };
    w.perf = { gaps: [], loaf: 0, on: true };
    let last = performance.now();
    const tick = (now: number) => {
      w.perf.gaps.push(now - last);
      last = now;
      if (w.perf.on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.perf.loaf += e.duration;
    }).observe({
      type: "long-animation-frame",
      buffered: false,
    } as PerformanceObserverInit);
  });
  await body();
  return page.evaluate(() => {
    const w = window as unknown as {
      perf: { gaps: number[]; loaf: number; on: boolean };
    };
    w.perf.on = false;
    const gaps = w.perf.gaps.slice(1).sort((a, b) => a - b);
    const at = (q: number) => +gaps[Math.floor(gaps.length * q)].toFixed(1);
    return {
      frames: gaps.length,
      frameP50: at(0.5),
      frameP95: at(0.95),
      frameMax: +gaps[gaps.length - 1].toFixed(1),
      over20ms: gaps.filter((g) => g > 20).length,
      longFramesMs: +w.perf.loaf.toFixed(0),
    };
  });
}

/** Types `text` and reads the browser's own Event Timing for each keystroke. */
export async function typeAndMeasure(page: Page, text: string) {
  await page.evaluate(() => {
    const w = window as unknown as {
      keys: PerformanceEventTiming[];
      keyObserver: PerformanceObserver;
    };
    w.keys = [];
    w.keyObserver = new PerformanceObserver((list) =>
      w.keys.push(...(list.getEntries() as PerformanceEventTiming[])),
    );
    w.keyObserver.observe({
      type: "event",
      durationThreshold: 0,
    } as PerformanceObserverInit);
  });
  await page.keyboard.type(text, { delay: 90 });
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const w = window as unknown as {
      keys: PerformanceEventTiming[];
      keyObserver: PerformanceObserver;
    };
    w.keyObserver.disconnect();
    const byKey = new Map<number, { latency: number; js: number }>();
    for (const e of w.keys) {
      if (
        !e.interactionId ||
        !["keydown", "keypress", "beforeinput", "input"].includes(e.name)
      )
        continue;
      const key = byKey.get(e.interactionId) ?? { latency: 0, js: 0 };
      key.latency = Math.max(key.latency, e.duration);
      key.js += e.processingEnd - e.processingStart;
      byKey.set(e.interactionId, key);
    }
    const all = [...byKey.values()];
    const latencies = all.map((k) => k.latency).sort((a, b) => a - b);
    return {
      keys: all.length,
      keyLatencyMean: +(
        latencies.reduce((s, v) => s + v, 0) / all.length
      ).toFixed(1),
      keyLatencyP95: latencies[Math.floor(latencies.length * 0.95)],
      keyJsMean: +(all.reduce((s, k) => s + k.js, 0) / all.length).toFixed(2),
    };
  });
}

/** A CPU profile of `body`, saved as `<label>.cpuprofile` in `out` when RELAY_PERF_PROFILE=1. */
export async function profiled(
  cdp: CDPSession,
  out: string,
  label: string,
  body: () => Promise<void>,
) {
  if (process.env.RELAY_PERF_PROFILE !== "1") return body();
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  await body();
  const { profile } = await cdp.send("Profiler.stop");
  await writeFile(join(out, `${label}.cpuprofile`), JSON.stringify(profile));
}

/** Main-thread busy share from a Chrome trace while `body` runs. */
export async function mainThread(cdp: CDPSession, body: () => Promise<void>) {
  const events: {
    name: string;
    ph: string;
    dur?: number;
    pid: number;
    tid: number;
    args?: { name?: string };
  }[] = [];
  const collect = (e: { value: unknown[] }) =>
    events.push(...(e.value as typeof events));
  cdp.on("Tracing.dataCollected", collect);
  await cdp.send("Tracing.start", {
    categories:
      "toplevel,devtools.timeline,disabled-by-default-devtools.timeline",
    transferMode: "ReportEvents",
  });
  const started = Date.now();
  await body();
  const wall = Date.now() - started;
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
    mainBusyPct: +(
      (100 * ms(["ThreadControllerImpl::RunTask"])) /
      wall
    ).toFixed(1),
    paintMsPerS: +(
      (1000 * ms(["Paint", "PrePaint", "Layerize", "Commit"])) /
      wall
    ).toFixed(1),
    styleLayoutMsPerS: +(
      (1000 * ms(["UpdateLayoutTree", "Layout"])) /
      wall
    ).toFixed(1),
  };
}
