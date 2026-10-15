import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { recordPerformance, withoutImages, type Tracing } from "./recording";
import type { SystemSnapshot } from "./snapshot";

const snapshot: SystemSnapshot = {
  at: 0,
  cores: 8,
  memory: { totalMb: 16_000, freeMb: 8_000 },
};
// The first look at the machine, held while a test says so.
const look = vi.hoisted(() => ({
  held: false,
  release: undefined as undefined | (() => void),
}));
vi.mock("./snapshot", async (actual) => ({
  ...(await actual<typeof import("./snapshot")>()),
  fullSnapshot: () =>
    new Promise<SystemSnapshot>((ok) => {
      if (look.held) look.release = () => ok({ ...snapshot });
      else ok({ ...snapshot });
    }),
  quickSnapshot: async () => ({ ...snapshot }),
}));

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "relay-recording-"));
  look.held = false;
  look.release = undefined;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

it("leaves the window's images out of a trace and keeps it valid JSON", () => {
  const png = "data:image/png;base64," + "iVBORw0KGgo".repeat(20);
  const svg = `data:image/svg+xml,<svg title="${"x".repeat(80)}"></svg>`;
  const trace = JSON.stringify({
    traceEvents: [{ args: { data: { url: png } } }, { args: { url: svg } }],
    small: "data:,",
  });
  const out = withoutImages(trace);
  expect(out).not.toContain("iVBORw0KGgo");
  expect(out).not.toContain("<svg");
  expect(JSON.parse(out).small).toBe("data:,");
});

it("leaves out a picture of many megabytes without running out of stack", () => {
  const plain = "data:image/png;base64," + "A".repeat(20_000_000);
  // An SVG's quotes come escaped, a few to every few characters.
  const svg = "data:image/svg+xml," + '<a b="c">'.repeat(1_000_000);
  const trace = JSON.stringify({ a: plain, b: svg, c: "data:,kept" });
  const out = withoutImages(trace);
  expect(JSON.parse(out)).toEqual({
    a: "data:(left out)",
    b: "data:(left out)",
    c: "data:,kept",
  });
});

/** What `withoutImages` was, while it could: it overflowed past ~8 MB. */
const before = (trace: string) =>
  trace.replace(/"data:(?:[^"\\]|\\.){64,}"/g, '"data:(left out)"');

it("leaves out exactly what the regex it replaces did", () => {
  const cases = [
    `"data:${"x".repeat(63)}"`,
    `"data:${"x".repeat(64)}"`,
    `"data:${"x".repeat(62)}\\""`,
    `"data:${"x".repeat(63)}\\""`,
    `"data:${"\\\\".repeat(64)}"`,
    `"data:${"\\\\".repeat(63)}\\"`,
    `"data:${"x".repeat(70)}`,
    `"data:${"x".repeat(70)}\\`,
    `"data:${"x".repeat(70)}\\\n${"x".repeat(5)}"`,
    `"data:${"x".repeat(70)}\\ "`,
    `"data:${"x".repeat(70)}\n"`,
    `"data:${"é😀".repeat(40)}"`,
    `"data:${"x".repeat(70)}\\😀"`,
    `["data:ab","data:${"y".repeat(80)}","data:${"z".repeat(64)}"]`,
    `"data:ab"data:${"y".repeat(80)}"`,
    `"data:${"x".repeat(70)}\\"data:${"y".repeat(80)}"`,
    `x"data:"data:${"y".repeat(64)}""`,
    `no data here`,
    ``,
  ];
  for (const trace of cases) expect(withoutImages(trace)).toBe(before(trace));

  // And on many made of the pieces that matter, at random but repeatably.
  const pieces = ['"data:', '"', "\\", "\n", "x".repeat(9), "é", "😀", ","];
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
  for (let n = 0; n < 5000; n++) {
    let trace = "";
    const length = Math.floor(random() * 40);
    for (let i = 0; i < length; i++)
      trace += pieces[Math.floor(random() * pieces.length)];
    expect(withoutImages(trace)).toBe(before(trace));
  }
});

function fakeTracing(over: Partial<Tracing> = {}) {
  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(async (path: string) => {
      writeFileSync(path, '{"traceEvents":[]}');
      return path;
    }),
    ...over,
  } satisfies Tracing;
}

const deps = (tracing: Tracing, metrics = () => []) => ({
  dir,
  tracing,
  metrics,
  power: {},
  anonymize: (text: string) => text,
  log: async () => "",
});

it("starts nothing when stopped while it first looks at the machine", async () => {
  const tracing = fakeTracing();
  const stop = new AbortController();
  look.held = true;
  const recording = recordPerformance(
    deps(tracing),
    { seconds: 60, others: true },
    stop.signal,
  );
  await vi.waitFor(() => expect(look.release).toBeDefined());
  stop.abort();
  look.release?.();
  await expect(recording).rejects.toBe(stop.signal.reason);
  expect(tracing.start).not.toHaveBeenCalled();
});

it("stops the trace when stopped while it starts", async () => {
  const stop = new AbortController();
  const tracing = fakeTracing({
    start: vi.fn(async () => {
      await Promise.resolve();
      stop.abort();
    }),
  });
  const stopped = await recordPerformance(
    deps(tracing),
    { seconds: 60, others: true },
    stop.signal,
  ).catch((e: unknown) => e);
  expect(stopped).toBe(stop.signal.reason);
  expect(tracing.stop).toHaveBeenCalledOnce();
  expect(existsSync(join(dir, "trace.tmp.json"))).toBe(false);
  expect(existsSync(join(dir, "performance.zip"))).toBe(false);
});

it("ends at once, keeping what it caught, when stopped as it begins", async () => {
  const stop = new AbortController();
  const tracing = fakeTracing();
  // Its first reading is taken just as the recording begins.
  const recorded = await recordPerformance(
    deps(tracing, () => (stop.abort(), [])),
    { seconds: 60, others: true },
    stop.signal,
  );
  expect(recorded.seconds).toBe(0);
  expect(tracing.stop).toHaveBeenCalledOnce();
  expect(existsSync(join(dir, "performance.zip"))).toBe(true);
  expect(existsSync(join(dir, "trace.tmp.json"))).toBe(false);
});
