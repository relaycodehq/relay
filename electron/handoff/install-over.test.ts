import { expect, it } from "vitest";
import { installOutput, installRelayOver } from "./install-over";

const box = { kind: "ssh", host: "box" } as const;
/** Runs the line here, as ssh would there. */
const here = (_route: unknown, line: string): [string, string[]] => [
  "sh",
  ["-c", line],
];

it("runs the installer it's given there from stdin, without setup, and keeps what it printed", async () => {
  await installRelayOver(box, {
    command: here,
    script:
      'echo "Downloading Relay 1.2.3…"; echo "setup off: $RELAY_NO_SETUP"',
  });
  expect(installOutput(box)).toBe("Downloading Relay 1.2.3…\nsetup off: 1\n");
});

it("fails with the installer's last line", async () => {
  await expect(
    installRelayOver(box, {
      command: here,
      script:
        'echo "Downloading…"; echo "Relay needs Node.js 22 or newer: https://nodejs.org" >&2; exit 1',
    }),
  ).rejects.toThrow("Relay needs Node.js 22 or newer: https://nodejs.org");
});
