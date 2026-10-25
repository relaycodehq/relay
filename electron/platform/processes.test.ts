import { describe, expect, it } from "vitest";
import { CpuRates, parsePs, parseWindows, type ProcessRow } from "./processes";

describe("process tables", () => {
  it("reads ps's columns, a command line with spaces included", () => {
    const [row] = parsePs(
      "  812     1   812  204800  37.5 Wed Oct 14 09:30:01 2026     /Applications/Relay.app/Contents/MacOS/Relay --flag a b\n",
    );
    expect(row).toEqual({
      pid: 812,
      ppid: 1,
      pgid: 812,
      mb: 200,
      cpu: 37.5,
      started: Date.parse("Wed Oct 14 09:30:01 2026"),
      line: "/Applications/Relay.app/Contents/MacOS/Relay --flag a b",
    });
  });

  it("reads the PowerShell's rows, counters or not", () => {
    const rows = parseWindows(
      "\uFEFF" +
        [
          "4120\t880\t1760430000000\t12\t104857600\tnode.exe\t\"C:\\Program Files\\nodejs\\node.exe\" vite.js",
          "4\t0\t0\t\t\tSystem\t",
          "garbage",
        ].join("\r\n"),
    );
    expect(rows).toEqual([
      {
        pid: 4120,
        ppid: 880,
        pgid: 0,
        started: 1760430000000,
        line: '"C:\\Program Files\\nodejs\\node.exe" vite.js',
        name: "node",
        cpu: 12,
        mb: 100,
      },
      { pid: 4, ppid: 0, pgid: 0, started: 0, line: "System", name: "System" },
    ]);
  });
});

describe("CpuRates", () => {
  it("turns Linux's CPU time into a rate between two looks", () => {
    const rates = new CpuRates();
    const row = (cpuMs: number, started = 5): ProcessRow => ({
      pid: 7,
      ppid: 1,
      pgid: 7,
      started,
      line: "node",
      cpuMs,
    });
    const first = [row(1000)];
    rates.fill(first, 10_000);
    expect(first[0].cpu).toBeUndefined();
    // 1.5 s of CPU in 1 s: one and a half cores.
    const second = [row(2500)];
    rates.fill(second, 11_000);
    expect(second[0].cpu).toBe(150);
    // A new process under a reused pid starts over.
    const reused = [row(100, 9)];
    rates.fill(reused, 12_000);
    expect(reused[0].cpu).toBeUndefined();
  });
});
