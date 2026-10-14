import { describe, expect, it } from "vitest";
import { parsePs, parseWindows } from "./processes";

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
