import { expect, it } from "vitest";
import { parseSamples, type PerfSample } from "./perf-log";
import { machineText, performanceFacts } from "./summary";

const t0 = Date.parse("2026-10-14T10:00:00Z");
const sample = (i: number, cpu: number, machineCpu: number): PerfSample => ({
  t: t0 + i * 30_000,
  p: {
    main: { cpu: 1, mb: 200, n: 1 },
    window: { cpu, mb: 500 + i, n: 1 },
  },
  s: {
    cores: 8,
    machineCpu,
    memory: { totalMb: 16384, freeMb: 4096, pressure: "normal" },
    onBattery: i % 2 === 0,
  },
});

it("puts Relay's peak next to how busy the machine was then", () => {
  const samples = [sample(0, 2, 10), sample(1, 80, 97), sample(2, 3, 12)];
  const facts = Object.fromEntries(
    performanceFacts(samples, undefined).map((f) => [f.id, f.value]),
  );
  expect(facts["perf-cpu"]).toContain(
    "peak 81% at 2026-10-14 10:00 UTC, mostly the window, machine 97% busy then",
  );
  expect(facts["perf-memory"]).toMatch(/^702 MB in 2 processes now, peak 702 MB/);
  expect(facts["perf-machine"]).toBe(
    "over 80% busy 33%, memory under pressure 0%, running hot unknown, on battery 67%, in low power mode unknown of the time",
  );
});

it("says unknown for what the OS can't tell instead of guessing", () => {
  expect(
    machineText({
      at: t0,
      cores: 12,
      machineCpu: 40,
      memory: { totalMb: 32768, freeMb: 20000 },
    }),
  ).toBe(
    "12 cores 40% busy · 32 GB memory, 19.5 GB free, pressure unknown · thermal unknown · power source unknown, low power mode unknown",
  );
});

it("skips lines cut short by a crash and samples older than a day", () => {
  const now = t0 + 25 * 3600_000;
  const text = [
    JSON.stringify(sample(0, 1, 1)),
    JSON.stringify({ ...sample(1, 1, 1), t: now - 60_000 }),
    '{"t":17604',
  ].join("\n");
  expect(parseSamples(text, now).map((s) => s.t)).toEqual([now - 60_000]);
});
