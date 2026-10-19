import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRoute } from "./pipe-route";

const box = { kind: "ssh", host: "box" } as const;

/** Runs the line here, as ssh would there, with `home` as its home folder and nothing else on PATH. */
async function at(relay?: string) {
  const home = await mkdtemp(join(tmpdir(), "relay-check-"));
  if (relay !== undefined) {
    await mkdir(join(home, ".local/bin"), { recursive: true });
    await writeFile(join(home, ".local/bin/relay"), `#!/bin/sh\n${relay}\n`, {
      mode: 0o755,
    });
  }
  return (_route: unknown, line: string): [string, string[]] => [
    "/bin/sh",
    ["-c", `HOME='${home}'; PATH=/usr/bin:/bin; ${line}`],
  ];
}

it("says which Relay is there", async () => {
  const found = await checkRoute(
    box,
    await at('echo "Welcome!" >&2; echo 0.18.0'),
  );
  expect(found.relay).toBe("0.18.0");
  expect(found.ms).toBeGreaterThanOrEqual(0);
});

it("says when there's none", async () => {
  expect((await checkRoute(box, await at())).relay).toBeNull();
});

it("tells a Relay that doesn't start from one that isn't there", async () => {
  const found = await checkRoute(
    box,
    await at(
      'echo "Relay needs Node.js 22 or newer: https://nodejs.org" >&2; exit 1',
    ),
  );
  expect(found).toMatchObject({
    relay: "",
    broken: "Relay needs Node.js 22 or newer: https://nodejs.org",
  });
});

it("reads the answer past what a shell startup file printed", async () => {
  const shell = await at("echo 0.18.0");
  const noisy = (route: unknown, line: string) =>
    shell(route, `echo "Have a nice day"; ${line}`);
  expect((await checkRoute(box, noisy)).relay).toBe("0.18.0");
});

it("fails in words when the route itself does", async () => {
  const refused = (): [string, string[]] => [
    "/bin/sh",
    ["-c", "echo 'Host key verification failed.' >&2; exit 255"],
  ];
  await expect(checkRoute(box, refused)).rejects.toThrow(
    "This computer doesn't know box's host key yet",
  );
  const gone = (): [string, string[]] => ["relay-no-such-ssh", []];
  await expect(checkRoute(box, gone)).rejects.toThrow("There's no ssh");
});
